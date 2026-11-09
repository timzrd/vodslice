// YouTube channel browsing without an API key: the public channel page (ytInitialData) + innertube continuations.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// SOCS/CONSENT skip the EU cookie wall (consent.youtube.com) that would otherwise replace every page.
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' };
let ctx = null; // { ver, visitor } from the last page, needed for continuations

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
const first = (o, key) => walk(o, key).next().value;

function initialData(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) || html.match(/window\["ytInitialData"\] = (\{.*?\});/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function getPage(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`YouTube answered ${r.status}`);
  const html = await r.text();
  const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
  const visitor = (html.match(/"VISITOR_DATA":"([^"]+)"/) || [])[1];
  if (ver) ctx = { ver, visitor };
  const data = initialData(html);
  if (!data) throw new Error('Could not read the YouTube page');
  return { data, finalUrl: r.url };
}

/** "1:02:03" -> 3723 */
function parseDur(t) {
  if (!t || !/^\d+(:\d+)+$/.test(t.trim())) return 0;
  return t
    .trim()
    .split(':')
    .map(Number)
    .reduce((a, b) => a * 60 + b, 0);
}

const bestSrc = (sources, min = 0) => {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return null;
  const ok = list.filter((s) => (s.width || 0) >= min);
  const s = (ok.length ? ok.sort((a, b) => a.width - b.width)[0] : list.sort((a, b) => (b.width || 0) - (a.width || 0))[0]).url;
  return s.startsWith('//') ? `https:${s}` : s;
};
const clean = (t) => String(t || '').replace(/[​-‏⁠﻿]/g, '').trim();

function itemFromLockup(l) {
  if (!l || l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !l.contentId) return null;
  const m = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
  const parts = [...walk(m.metadata, 'metadataParts')].flat().map((p) => (p && p.text && p.text.content) || '');
  const badges = [...walk(l.contentImage, 'thumbnailBadgeViewModel')].map((b) => b.text || '');
  const durText = badges.find((b) => /^\d+(:\d+)+$/.test(b)) || '';
  const live = badges.some((b) => /live/i.test(b)) && !durText;
  const upcoming = badges.some((b) => /upcoming|premiere/i.test(b));
  const views = parts.find((p) => /\d/.test(p) && !/ago|streamed|scheduled|premier/i.test(p)) || '';
  const published = parts.find((p) => /ago|streamed|scheduled|premier/i.test(p)) || '';
  return {
    id: l.contentId,
    url: `https://www.youtube.com/watch?v=${l.contentId}`,
    title: clean(m.title && m.title.content),
    thumbnail: bestSrc(l.contentImage && l.contentImage.thumbnailViewModel && l.contentImage.thumbnailViewModel.image && l.contentImage.thumbnailViewModel.image.sources, 640),
    duration: parseDur(durText),
    durationText: durText,
    views: views ? `${views}${/view/i.test(views) ? '' : ' views'}` : '',
    published,
    live,
    upcoming,
  };
}

function itemFromRenderer(v) {
  if (!v || !v.videoId) return null;
  const text = (o) => (o ? o.simpleText || (o.runs || []).map((r) => r.text).join('') : '');
  const durText = text(v.lengthText);
  return {
    id: v.videoId,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    title: clean(text(v.title)),
    thumbnail: bestSrc(v.thumbnail && v.thumbnail.thumbnails, 640),
    duration: parseDur(durText),
    durationText: durText,
    views: text(v.shortViewCountText) || text(v.viewCountText),
    published: text(v.publishedTimeText),
    live: !durText && /watching/i.test(text(v.viewCountText)),
    upcoming: !!v.upcomingEventData,
  };
}

function itemsOf(node) {
  const out = [];
  const seen = new Set();
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (o.lockupViewModel || o.videoRenderer || o.gridVideoRenderer) {
      const it = o.lockupViewModel ? itemFromLockup(o.lockupViewModel) : itemFromRenderer(o.videoRenderer || o.gridVideoRenderer);
      if (it && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
      return;
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(node);
  return out.filter((x) => !x.upcoming);
}

function nextToken(node) {
  const c = [...walk(node, 'continuationItemRenderer')].pop();
  return (c && c.continuationEndpoint && c.continuationEndpoint.continuationCommand && c.continuationEndpoint.continuationCommand.token) || null;
}

function headerOf(data, ref) {
  const meta = first(data, 'channelMetadataRenderer') || {};
  const ph = first(data, 'pageHeaderViewModel') || {};
  const rows = [...walk(ph.metadata, 'metadataParts')].flat().map((p) => (p && p.text && p.text.content) || '');
  const avatarSrc = first(ph.image, 'sources') || (meta.avatar && meta.avatar.thumbnails);
  const banner = first(data, 'imageBannerViewModel');
  const tabs = [...walk(data, 'tabRenderer')]
    .map((t) => {
      const url = (t.endpoint && t.endpoint.commandMetadata && t.endpoint.commandMetadata.webCommandMetadata && t.endpoint.commandMetadata.webCommandMetadata.url) || '';
      const id = url.split('/').pop();
      return { id, label: t.title, selected: !!t.selected };
    })
    .filter((t) => t.id === 'videos' || t.id === 'streams');
  const handle = rows.find((r) => r.startsWith('@')) || (ref.startsWith('@') ? ref : '');
  return {
    site: 'youtube',
    id: meta.externalId || '',
    ref: handle || (meta.externalId ? `channel/${meta.externalId}` : ref),
    name: clean(meta.title) || clean(first(ph.title, 'content')) || handle,
    handle,
    avatar: bestSrc(avatarSrc, 160),
    banner: banner ? bestSrc(banner.image && banner.image.sources, 1500) : null,
    subscribers: rows.find((r) => /subscriber/i.test(r)) || '',
    videoCount: rows.find((r) => /video/i.test(r)) || '',
    description: clean(meta.description).split('\n')[0].slice(0, 220),
    url: meta.vanityChannelUrl || `https://www.youtube.com/${handle || ref}`,
    tabs: tabs.map(({ id, label }) => ({ id, label: id === 'streams' ? 'Streams' : label })),
  };
}

/** First page of a channel tab ('streams' | 'videos'). Falls back to videos when there is no streams tab. */
async function channel(ref, tab) {
  const want = tab || 'streams';
  let { data } = await getPage(`https://www.youtube.com/${ref}/${want}`);
  let header = headerOf(data, ref);
  let sel = [...walk(data, 'tabRenderer')].find((t) => t.selected);
  let selId = sel && sel.endpoint ? sel.endpoint.commandMetadata.webCommandMetadata.url.split('/').pop() : '';
  if (selId !== want) {
    const other = want === 'streams' ? 'videos' : 'streams';
    if (header.tabs.some((t) => t.id === other)) {
      ({ data } = await getPage(`https://www.youtube.com/${ref}/${other}`));
      header = headerOf(data, ref);
      selId = other;
    }
  }
  const grid = first(data, 'richGridRenderer') || data;
  return { channel: header, tab: selId || want, items: itemsOf(grid), next: nextToken(grid) };
}

async function more(token) {
  if (!ctx) throw new Error('Open the channel again');
  const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': ctx.ver,
      ...(ctx.visitor ? { 'X-Goog-Visitor-Id': ctx.visitor } : {}),
    },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ctx.ver, hl: 'en', gl: 'US', visitorData: ctx.visitor } }, continuation: token }),
  });
  if (!r.ok) throw new Error(`YouTube answered ${r.status}`);
  const j = await r.json();
  return { items: itemsOf(j.onResponseReceivedActions || j), next: nextToken(j.onResponseReceivedActions || j) };
}

/** Channel search by name. */
async function search(q) {
  const { data } = await getPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`);
  const text = (o) => (o ? o.simpleText || (o.runs || []).map((r) => r.text).join('') : '');
  return [...walk(data, 'channelRenderer')].slice(0, 8).map((c) => {
    // YouTube now puts the @handle into subscriberCountText and the subscriber count into videoCountText
    const a = text(c.subscriberCountText);
    const b = text(c.videoCountText);
    const handle = [a, b].find((x) => x.startsWith('@')) || '';
    const subs = [a, b].find((x) => /subscriber/i.test(x)) || '';
    const be = (c.navigationEndpoint && c.navigationEndpoint.browseEndpoint) || {};
    return {
      site: 'youtube',
      ref: (be.canonicalBaseUrl || '').replace(/^\//, '') || handle || `channel/${c.channelId}`,
      name: clean(text(c.title)),
      handle,
      avatar: bestSrc(c.thumbnail && c.thumbnail.thumbnails, 88),
      subscribers: subs,
    };
  });
}

module.exports = { channel, more, search, parseDur, itemsOf, headerOf };
