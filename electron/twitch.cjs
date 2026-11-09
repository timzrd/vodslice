// Twitch: channel pages, VOD/clip lists, seek-preview storyboards and chat activity (public web GQL, no login).
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // the public twitch.tv web client
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const q = (s) => JSON.stringify(String(s));

async function gql(query, signal) {
  const r = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!r.ok) throw new Error(`Twitch answered ${r.status}`);
  const j = await r.json();
  if (!j.data && j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

const VIDEO_FIELDS = 'id title lengthSeconds viewCount publishedAt status previewThumbnailURL(width: 640, height: 360) game { displayName }';
const CLIP_FIELDS = 'slug title viewCount durationSeconds createdAt thumbnailURL game { displayName } curator { displayName }';

function videoItem(n, login) {
  const processing = /404_processing/.test(n.previewThumbnailURL || '');
  return {
    id: n.id,
    url: `https://www.twitch.tv/videos/${n.id}`,
    title: (n.title || '').trim(),
    thumbnail: processing ? null : n.previewThumbnailURL,
    duration: n.lengthSeconds || 0,
    views: n.viewCount != null ? `${n.viewCount.toLocaleString('en-US')} views` : '',
    publishedAt: n.publishedAt,
    game: n.game ? n.game.displayName : '',
    live: n.status === 'RECORDING',
    login,
  };
}
function clipItem(n, login) {
  return {
    id: n.slug,
    url: `https://www.twitch.tv/${login}/clip/${n.slug}`,
    title: (n.title || '').trim(),
    thumbnail: n.thumbnailURL,
    duration: n.durationSeconds || 0,
    views: n.viewCount != null ? `${n.viewCount.toLocaleString('en-US')} views` : '',
    publishedAt: n.createdAt,
    game: n.game ? n.game.displayName : '',
    by: n.curator ? n.curator.displayName : '',
    clip: true,
    login,
  };
}

const TABS = [
  { id: 'archive', label: 'Past broadcasts' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'clips-week', label: 'Clips Â· 7 days' },
  { id: 'clips-all', label: 'Clips Â· all time' },
];

async function list(login, tab, cursor) {
  const after = cursor ? `, after: ${q(cursor)}` : '';
  if (tab.startsWith('clips')) {
    const period = tab === 'clips-week' ? 'LAST_WEEK' : 'ALL_TIME';
    const d = await gql(`query { user(login: ${q(login)}) { clips(first: 30${after}, criteria: { period: ${period} }) { edges { cursor node { ${CLIP_FIELDS} } } pageInfo { hasNextPage } } } }`);
    const c = d.user && d.user.clips;
    if (!c) return { items: [], next: null };
    const last = c.edges.at(-1);
    return { items: c.edges.map((e) => clipItem(e.node, login)), next: c.pageInfo.hasNextPage && last && last.cursor ? last.cursor : null };
  }
  const type = tab === 'highlight' ? 'HIGHLIGHT' : tab === 'upload' ? 'UPLOAD' : 'ARCHIVE';
  // Twitch keeps ~60 days of VODs; 100 per page covers a channel (its "after" cursors are unreliable for videos)
  const d = await gql(`query { user(login: ${q(login)}) { videos(first: 100${after}, type: ${type}, sort: TIME) { edges { cursor node { ${VIDEO_FIELDS} } } pageInfo { hasNextPage } } } }`);
  const v = d.user && d.user.videos;
  if (!v) return { items: [], next: null };
  const last = v.edges.at(-1);
  return { items: v.edges.map((e) => videoItem(e.node, login)), next: v.pageInfo.hasNextPage && last && last.cursor ? last.cursor : null };
}

async function channel(login, tab = 'archive') {
  const d = await gql(
    `query { user(login: ${q(login)}) { id login displayName description profileImageURL(width: 300) bannerImageURL followers { totalCount } stream { id viewersCount } } }`
  );
  const u = d.user;
  if (!u) throw new Error(`No Twitch channel "${login}"`);
  const first = await list(u.login, tab);
  return {
    channel: {
      site: 'twitch',
      id: u.id,
      ref: u.login,
      name: u.displayName,
      handle: u.login,
      avatar: u.profileImageURL,
      banner: u.bannerImageURL,
      subscribers: u.followers ? `${fmtCount(u.followers.totalCount)} followers` : '',
      videoCount: '',
      description: (u.description || '').slice(0, 220),
      live: u.stream ? { viewers: u.stream.viewersCount } : null,
      url: `https://www.twitch.tv/${u.login}`,
      tabs: TABS,
    },
    tab,
    ...first,
  };
}

async function search(text) {
  const d = await gql(`query { searchUsers(userQuery: ${q(text)}, first: 8) { edges { node { login displayName profileImageURL(width: 70) followers { totalCount } } } } }`);
  const list = ((d.searchUsers && d.searchUsers.edges) || []).map((e) => ({
    site: 'twitch',
    ref: e.node.login,
    name: e.node.displayName,
    handle: e.node.login,
    avatar: e.node.profileImageURL,
    subscribers: `${fmtCount(e.node.followers.totalCount)} followers`,
    followers: e.node.followers.totalCount,
  }));
  // exact login first, then by followers
  const t = text.toLowerCase().replace(/\s+/g, '');
  return list.sort((a, b) => (b.ref === t) - (a.ref === t) || b.followers - a.followers);
}

function fmtCount(n) {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** VOD seek-preview sprites -> the storyboard format used by the renderer. */
async function storyboard(videoId) {
  const d = await gql(`query { video(id: ${q(videoId)}) { seekPreviewsURL } }`);
  const url = d.video && d.video.seekPreviewsURL;
  if (!url) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const list = await r.json();
  const best = list.find((x) => x.quality === 'high') || list[0];
  if (!best || !best.images || !best.images.length) return null;
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const per = best.rows * best.cols * best.interval;
  return {
    width: best.width,
    height: best.height,
    rows: best.rows,
    columns: best.cols,
    interval: best.interval,
    fragments: best.images.map((img) => ({ url: base + img, duration: per })),
  };
}

// ---------------------------------------------------------------- chat activity

const emoteCache = new Map(); // channelId -> Map(name -> url)

async function getJson(url, signal) {
  try {
    const r = await fetch(url, { signal, headers: { 'User-Agent': UA } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Third-party emotes (7TV, BTTV, FFZ) of a channel + their global sets: name -> image url. */
async function thirdPartyEmotes(channelId, signal) {
  if (emoteCache.has(channelId)) return emoteCache.get(channelId);
  const map = new Map();
  const [stv, stvG, bttv, bttvG, ffz, ffzG] = await Promise.all([
    getJson(`https://7tv.io/v3/users/twitch/${channelId}`, signal),
    getJson('https://7tv.io/v3/emote-sets/global', signal),
    getJson(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`, signal),
    getJson('https://api.betterttv.net/3/cached/emotes/global', signal),
    getJson(`https://api.frankerfacez.com/v1/room/id/${channelId}`, signal),
    getJson('https://api.frankerfacez.com/v1/set/global', signal),
  ]);
  const ffzSets = (j) => Object.values((j && j.sets) || {}).flatMap((s) => s.emoticons || []);
  for (const e of ffzSets(ffzG)) map.set(e.name, e.urls['2'] || e.urls['1']);
  for (const e of ffzSets(ffz)) map.set(e.name, e.urls['2'] || e.urls['1']);
  for (const e of bttvG || []) map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
  for (const e of [...((bttv && bttv.channelEmotes) || []), ...((bttv && bttv.sharedEmotes) || [])]) map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
  for (const e of (stvG && stvG.emotes) || []) map.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`);
  for (const e of (stv && stv.emote_set && stv.emote_set.emotes) || []) map.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`);
  for (const k of [...map.keys()]) map.get(k) && map.get(k).startsWith('//') && map.set(k, `https:${map.get(k)}`);
  emoteCache.set(channelId, map);
  return map;
}

const twitchEmote = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

/**
 * Count the emotes / messages of one comment page inside [t, t + step).
 * Returns {n, extrapolated, emotes: {name: [count, url]}}.
 */
function countPage(edges, hasNext, t, step, emoteMap) {
  const nodes = edges.map((e) => e.node).filter((n) => n && n.contentOffsetSeconds >= t && n.contentOffsetSeconds < t + step);
  const emotes = {};
  for (const n of nodes) {
    const seen = new Set(); // one vote per message and emote
    for (const f of (n.message && n.message.fragments) || []) {
      if (f.emote && f.emote.emoteID) {
        const name = f.text.trim();
        if (!seen.has(name)) {
          seen.add(name);
          const e = emotes[name] || (emotes[name] = [0, twitchEmote(f.emote.emoteID)]);
          e[0]++;
        }
        continue;
      }
      for (const w of (f.text || '').split(/\s+/)) {
        if (!w || seen.has(w) || !emoteMap.has(w)) continue;
        seen.add(w);
        const e = emotes[w] || (emotes[w] = [0, emoteMap.get(w)]);
        e[0]++;
      }
    }
  }
  const last = edges.length ? edges.at(-1).node.contentOffsetSeconds : t;
  // the page ended inside the window: scale the count up to the whole window
  if (hasNext && last < t + step && nodes.length) {
    const k = step / Math.max(1, last - t + 1);
    for (const e of Object.values(emotes)) e[0] = Math.round(e[0] * k);
    return { n: Math.round(nodes.length * k), emotes, extrapolated: true };
  }
  return { n: nodes.length, emotes, extrapolated: false };
}

/** Local maxima of the chat rate, each with its most spammed emote. */
function findPeaks(counts, emoteWin, step, maxPeaks = 40) {
  if (!counts.length) return [];
  const sm = counts.map((_, i) => {
    let a = 0;
    let n = 0;
    for (let k = -1; k <= 1; k++) if (counts[i + k] != null) (a += counts[i + k]), n++;
    return a / n;
  });
  const sorted = [...sm].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const minGap = Math.max(2, Math.round(90 / step));
  const cand = sm
    .map((v, i) => ({ i, v }))
    .filter(({ i, v }) => v > median * 1.6 && v >= 3 && (sm[i - 1] == null || v >= sm[i - 1]) && (sm[i + 1] == null || v >= sm[i + 1]))
    // the smoothed maximum can sit next to the real one (edges): move to the busiest raw window around it
    .map(({ i, v }) => {
      let j = i;
      for (const k of [i - 1, i + 1]) if (counts[k] != null && counts[k] > counts[j]) j = k;
      return { i: j, v };
    })
    .sort((a, b) => b.v - a.v);
  const picked = [];
  for (const c of cand) {
    if (picked.length >= maxPeaks) break;
    if (picked.some((p) => Math.abs(p.i - c.i) < minGap)) continue;
    picked.push(c);
  }
  return picked
    .map(({ i, v }) => {
      const agg = {};
      for (let k = i - 1; k <= i + 1; k++)
        for (const [name, [n, url]] of Object.entries(emoteWin[k] || {})) {
          const e = agg[name] || (agg[name] = [0, url]);
          e[0] += n;
        }
      const top = Object.entries(agg).sort((a, b) => b[1][0] - a[1][0])[0];
      const msgs = (counts[i - 1] || 0) + counts[i] + (counts[i + 1] || 0);
      const emote = top && top[1][0] >= 3 && top[1][0] >= msgs * 0.12 ? { name: top[0], url: top[1][1], count: top[1][0] } : null;
      return { t: i * step + step / 2, value: v, emote };
    })
    .sort((a, b) => a.t - b.t);
}

/**
 * Chat activity of a VOD. Twitch only allows offset-based comment requests without an integrity token,
 * so the chat is sampled: one page per window (enough for a heatmap + emote peaks, ~30 s for an 8 h VOD).
 */
async function chatActivity(videoId, duration, { cacheDir, onProgress, signal, growing } = {}) {
  const file = cacheDir ? path.join(cacheDir, `${videoId}.json`) : null;
  if (file && fs.existsSync(file)) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (c.v === 3) return c;
    } catch {}
  }
  const meta = await gql(`query { video(id: ${q(videoId)}) { lengthSeconds owner { id login } } }`, signal);
  if (!meta.video) throw new Error('VOD not found');
  const D = duration || meta.video.lengthSeconds;
  const emoteMap = await thirdPartyEmotes(meta.video.owner.id, signal);
  const step = Math.max(10, Math.min(60, Math.round(D / 1200)));
  const n = Math.ceil(D / step);
  const counts = new Array(n).fill(0);
  const emoteWin = new Array(n).fill(null);
  let done = 0;
  let next = 0;
  let failures = 0;
  const fetchOne = async (i) => {
    const t = i * step;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await gql(
          `query { video(id: ${q(videoId)}) { comments(contentOffsetSeconds: ${Math.floor(t)}) { edges { node { contentOffsetSeconds message { fragments { text emote { emoteID } } } } } pageInfo { hasNextPage } } } }`,
          signal
        );
        const c = d.video && d.video.comments;
        if (!c) return;
        const r = countPage(c.edges || [], c.pageInfo && c.pageInfo.hasNextPage, t, step, emoteMap);
        counts[i] = r.n;
        emoteWin[i] = r.emotes;
        return;
      } catch (e) {
        if (signal && signal.aborted) throw e;
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
      }
    }
    failures++;
  };
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < n) {
        const i = next++;
        await fetchOne(i);
        done++;
        if (onProgress && done % 20 === 0) onProgress(done / n);
      }
    })
  );
  if (failures > n * 0.3) throw new Error('Twitch chat could not be read');
  const peaks = findPeaks(counts, emoteWin, step);
  const out = { v: 3, videoId, step, counts, peaks, max: Math.max(1, ...counts), total: counts.reduce((a, b) => a + b, 0), at: Date.now() };
  if (file && !growing) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
  }
  return out;
}

module.exports = { gql, channel, list, search, storyboard, chatActivity, countPage, findPeaks, fmtCount, TABS };
