// Chat messages for a time range of a source (for the transparent chat overlay):
//   Twitch VODs (offset-paged comments), Twitch clips (the clip's VOD), YouTube streams (live chat replay).
// Message = { t (seconds, source time), name, color, parts: [{ text } | { emote: url, name }] }
const twitch = require('./twitch.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const YT_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };

// Twitch's default name colors (used when a user never picked one, and for YouTube)
const NAME_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
function colorFor(name) {
  let h = 0;
  for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/** Split plain text into text / emote parts using a name -> url map (7TV, BTTV, FFZ). */
function splitText(text, emoteMap, out) {
  let buf = '';
  for (const w of String(text || '').split(/(\s+)/)) {
    if (w && emoteMap && emoteMap.has(w)) {
      if (buf) out.push({ text: buf });
      buf = '';
      out.push({ emote: emoteMap.get(w), name: w });
    } else buf += w;
  }
  if (buf) out.push({ text: buf });
  return out;
}

function* walk(o, key) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) {
    for (const x of o) yield* walk(x, key);
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === key) yield v;
    else yield* walk(v, key);
  }
}

// ---------------------------------------------------------------- Twitch

/**
 * All comments of a VOD between start and end (seconds). Twitch only allows offset requests without an
 * integrity token, so we hop from the last offset of each page; same-second messages are spread over the second.
 */
async function twitchRange(videoId, start, end, { signal, emoteMap } = {}) {
  const meta = await twitch.gql(`query { video(id: ${JSON.stringify(String(videoId))}) { owner { id } } }`, signal);
  if (!meta.video) throw new Error('Twitch VOD not found (deleted or sub-only)');
  const map = emoteMap || (await twitch.thirdPartyEmotes(meta.video.owner.id, signal));
  const seen = new Set();
  const raw = [];
  // walk [a, b) page by page; several chunks run in parallel (busy chats need ~3 pages per second)
  const walkChunk = async (a, b) => {
    let t = a;
    for (let guard = 0; guard < 300 && t < b; guard++) {
      const d = await twitch.gql(
        `query { video(id: ${JSON.stringify(String(videoId))}) { comments(contentOffsetSeconds: ${t}) { edges { node { id contentOffsetSeconds commenter { displayName login } message { userColor fragments { text emote { emoteID } } } } } pageInfo { hasNextPage } } } }`,
        signal
      );
      const c = d.video && d.video.comments;
      const edges = (c && c.edges) || [];
      let last = t;
      for (const e of edges) {
        const n = e.node;
        if (!n) continue;
        last = Math.max(last, n.contentOffsetSeconds);
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        raw.push(n);
      }
      if (!edges.length || !(c.pageInfo && c.pageInfo.hasNextPage)) break;
      t = last > t ? last : t + 1;
    }
  };
  const s0 = Math.max(0, Math.floor(start));
  const e0 = Math.ceil(end) + 1;
  const step = 8;
  const chunks = [];
  for (let a = s0; a < e0; a += step) chunks.push([a, Math.min(e0, a + step)]);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, chunks.length) }, async () => {
      while (next < chunks.length) {
        const [a, b] = chunks[next++];
        await walkChunk(a, b);
      }
    })
  );
  // spread messages of the same second evenly over that second
  const bySec = new Map();
  for (const n of raw) {
    const k = n.contentOffsetSeconds;
    if (!bySec.has(k)) bySec.set(k, []);
    bySec.get(k).push(n);
  }
  const out = [];
  for (const [sec, list] of bySec) {
    list.forEach((n, i) => {
      const tt = sec + i / list.length;
      if (tt < start || tt > end) return;
      const name = (n.commenter && (n.commenter.displayName || n.commenter.login)) || 'unknown';
      const parts = [];
      for (const f of (n.message && n.message.fragments) || []) {
        if (f.emote && f.emote.emoteID) parts.push({ emote: twitch.twitchEmote(f.emote.emoteID), name: f.text });
        else splitText(f.text, map, parts);
      }
      out.push({ t: tt, name, color: (n.message && n.message.userColor) || colorFor(name), parts });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

function clipSlug(url) {
  const m = /clips\.twitch\.tv\/([\w-]+)/i.exec(url || '') || /\/clip\/([\w-]+)/i.exec(url || '');
  return m ? m[1] : null;
}

/** A Twitch clip's chat = the chat of its VOD at the clip's offset. Times come back relative to the clip. */
async function twitchClipRange(url, start, end, opts = {}) {
  const slug = clipSlug(url);
  if (!slug) throw new Error('Unknown Twitch clip link');
  const d = await twitch.gql(`query { clip(slug: ${JSON.stringify(slug)}) { videoOffsetSeconds video { id } broadcaster { id } } }`, opts.signal);
  const c = d.clip;
  if (!c || !c.video) throw new Error('The VOD of this clip is gone — Twitch has no chat for it');
  const off = c.videoOffsetSeconds || 0;
  const list = await twitchRange(c.video.id, off + start, off + end, opts);
  return list.map((m) => ({ ...m, t: m.t - off }));
}

// ---------------------------------------------------------------- YouTube

const ytEmoteCache = new Map();
async function youtubeEmotes(channelId, signal) {
  if (!channelId) return new Map();
  if (ytEmoteCache.has(channelId)) return ytEmoteCache.get(channelId);
  const map = new Map();
  const [g, u] = await Promise.all([twitch.getJson('https://7tv.io/v3/emote-sets/global', signal), twitch.getJson(`https://7tv.io/v3/users/youtube/${channelId}`, signal)]);
  for (const e of (g && g.emotes) || []) map.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`);
  for (const e of (u && u.emote_set && u.emote_set.emotes) || []) map.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`);
  ytEmoteCache.set(channelId, map);
  return map;
}

function ytMessage(r, t, emoteMap) {
  const name = String((r.authorName && r.authorName.simpleText) || 'unknown').replace(/^@/, '');
  const parts = [];
  for (const run of (r.message && r.message.runs) || []) {
    if (run.emoji) {
      const th = (run.emoji.image && run.emoji.image.thumbnails) || [];
      const url = th.length ? th[th.length - 1].url : null;
      if (url) parts.push({ emote: url.startsWith('//') ? `https:${url}` : url, name: (run.emoji.shortcuts && run.emoji.shortcuts[0]) || run.emoji.emojiId });
      else parts.push({ text: run.emoji.emojiId || '' });
    } else if (run.text) splitText(run.text, emoteMap, parts);
  }
  const badges = JSON.stringify(r.authorBadges || []);
  const color = /OWNER/.test(badges) ? '#FFD600' : /MODERATOR/.test(badges) ? '#5E84F1' : /[Mm]ember/.test(badges) ? '#2BA640' : colorFor(name);
  if (r.purchaseAmountText) parts.unshift({ text: `${r.purchaseAmountText.simpleText} ` });
  return { t, name, color, parts };
}

/** Live chat replay of a finished YouTube stream between start and end (seconds). */
async function youtubeRange(videoId, start, end, { signal } = {}) {
  const r = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { headers: YT_HEADERS, signal });
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error('Could not read the YouTube page');
  const data = JSON.parse(m[1]);
  const lc = [...walk(data, 'liveChatRenderer')][0];
  const reload = lc && [...walk(lc, 'reloadContinuationData')][0];
  if (!reload) throw new Error('This video has no chat replay');
  const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
  const visitor = (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1];
  const channelId = (html.match(/"videoDetails":\{.*?"channelId":"(UC[\w-]{22})"/s) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
  const emoteMap = await youtubeEmotes(channelId, signal);
  let tok = reload.continuation;
  let offset = Math.max(0, start * 1000 - 3000);
  const out = [];
  const seen = new Set();
  for (let guard = 0; guard < 400 && tok; guard++) {
    const res = await fetch('https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay?prettyPrint=false', {
      method: 'POST',
      signal,
      headers: { ...YT_HEADERS, 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': ver, Origin: 'https://www.youtube.com' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en', gl: 'US', visitorData: visitor } }, continuation: tok, currentPlayerState: { playerOffsetMs: String(Math.round(offset)) } }),
    });
    if (!res.ok) throw new Error(`YouTube chat answered ${res.status}`);
    const j = await res.json();
    const cc = j.continuationContents && j.continuationContents.liveChatContinuation;
    if (!cc) break;
    let lastT = null;
    for (const a of cc.actions || []) {
      const rep = a.replayChatItemAction;
      if (!rep) continue;
      const t = Number(rep.videoOffsetTimeMsec) / 1000;
      lastT = t;
      for (const item of rep.actions || []) {
        const it = item.addChatItemAction && item.addChatItemAction.item;
        const msg = it && (it.liveChatTextMessageRenderer || it.liveChatPaidMessageRenderer);
        if (!msg || seen.has(msg.id)) continue;
        seen.add(msg.id);
        if (t >= start && t <= end) out.push(ytMessage(msg, t, emoteMap));
      }
    }
    if (lastT != null && lastT > end) break;
    const next = (cc.continuations || []).map((c) => c.liveChatReplayContinuationData).find(Boolean);
    tok = next && next.continuation;
    if (lastT != null) offset = lastT * 1000;
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- entry

/**
 * Messages of one source between start and end (seconds of that source).
 * src = the job spec source: { site, kind, vid, twitchId, url }
 */
async function fetchRange(src, start, end, opts = {}) {
  if (src.site === 'twitch' && src.kind === 'clip') return twitchClipRange(src.url, Math.max(0, start), end, opts);
  if (src.site === 'twitch') {
    const id = src.twitchId || String(src.vid || '').replace(/^v/, '');
    if (!id) throw new Error('Unknown Twitch VOD');
    return twitchRange(id, Math.max(0, start), end, opts);
  }
  if (src.site === 'youtube') {
    if (!src.vid) throw new Error('Unknown YouTube video');
    return youtubeRange(src.vid, Math.max(0, start), end, opts);
  }
  throw new Error('Chat is only available for Twitch and YouTube');
}

module.exports = { fetchRange, twitchRange, twitchClipRange, youtubeRange, splitText, colorFor, clipSlug };
