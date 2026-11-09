// Video info extraction (yt-dlp -J) and format/quality selection.
const { spawn } = require('node:child_process');

const CACHE = new Map(); // cacheId -> { info, fetchedAt, url }

function codecFamily(vcodec = '') {
  const v = vcodec.toLowerCase();
  if (v.startsWith('avc') || v.startsWith('h264')) return 'H.264';
  if (v.startsWith('av01')) return 'AV1';
  if (v.startsWith('vp09') || v.startsWith('vp9')) return 'VP9';
  if (v.startsWith('hev') || v.startsWith('hvc') || v.startsWith('h265')) return 'HEVC';
  return vcodec.split('.')[0].toUpperCase() || '?';
}

const isHls = (f) => /m3u8/.test(f.protocol || '');
const hasV = (f) => f.vcodec && f.vcodec !== 'none';
const hasA = (f) => f.acodec && f.acodec !== 'none';

function parseStartHint(url) {
  try {
    const u = new URL(url);
    const t = u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([^&]+)/) || [])[1];
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  } catch {
    return null;
  }
}

const isAudioOnly = (f) =>
  !hasV(f) && !/storyboard/.test(f.format_note || '') && f.ext !== 'mhtml' && (hasA(f) || f.resolution === 'audio only');

function pickAudio(formats, wantHls) {
  const audios = formats.filter(isAudioOnly);
  const score = (f) => {
    let s = 0;
    if (/drc/i.test(f.format_id)) s -= 1000;
    if (wantHls === isHls(f)) s += 5000;
    if ((f.acodec || 'mp4a').startsWith('mp4a')) s += 2000; // AAC is editor-friendly (HLS audio is AAC)
    if (/high/i.test(f.format_note || '')) s += 400;
    if (/default|original/i.test(f.format_note || '')) s += 500;
    if (f.language_preference > 0) s += 300;
    s += (f.abr || f.tbr || 0);
    return s;
  };
  return audios.sort((a, b) => score(b) - score(a))[0] || null;
}

/** Build the quality options list (one per height/fps/codec), best first. */
function buildQualities(info) {
  const formats = (info.formats || []).filter((f) => hasV(f) && f.height && !/storyboard|mhtml/.test(f.ext + (f.format_note || '')));
  const groups = new Map();
  for (const f of formats) {
    const fps = Math.round(f.fps || 30);
    const codec = codecFamily(f.vcodec);
    const key = `${f.height}|${fps > 30 ? 60 : 30}|${codec}`;
    const g = groups.get(key) || { height: f.height, width: f.width, fps: fps > 30 ? fps : 30, codec, hls: null, http: null };
    if (isHls(f)) {
      if (!g.hls || (f.tbr || 0) > (g.hls.tbr || 0)) g.hls = f;
    } else if ((f.protocol || '').startsWith('http')) {
      if (!g.http || (f.tbr || 0) > (g.http.tbr || 0)) g.http = f;
    }
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const v = g.hls || g.http;
    if (!v) continue;
    const muxed = hasA(v);
    const audio = muxed ? null : pickAudio(info.formats, !!g.hls);
    const label = `${g.height}p${g.fps > 30 ? g.fps : ''}`;
    out.push({
      key: `${g.height}-${g.fps}-${g.codec}`,
      label,
      codec: g.codec,
      height: g.height,
      width: g.width || Math.round((g.height * 16) / 9),
      fps: g.fps,
      hls: !!g.hls && (muxed || !audio || isHls(audio)),
      video: v.format_id,
      videoHttp: g.http ? g.http.format_id : null,
      audio: audio ? audio.format_id : null,
      muxed,
      tbr: v.tbr || 0,
    });
  }
  const codecRank = { 'H.264': 4, AV1: 3, VP9: 2, HEVC: 1 };
  out.sort((a, b) => b.height - a.height || b.fps - a.fps || (codecRank[b.codec] || 0) - (codecRank[a.codec] || 0));
  return out;
}

function defaultQuality(qualities, prefs) {
  let list = qualities.filter((q) => !prefs.maxHeight || q.height <= prefs.maxHeight);
  if (!list.length) list = qualities;
  if (prefs.codec === 'h264') {
    const h = list.filter((q) => q.codec === 'H.264');
    if (h.length) return h[0].key;
  }
  return list[0] ? list[0].key : null;
}

const px = (url) => (/googlevideo\.com/.test(url || '') ? `vsproxy://media/?u=${encodeURIComponent(url)}` : url);

function previewSource(info) {
  const src = previewSourceRaw(info);
  if (!src) return null;
  return { ...src, url: px(src.url), audio: src.audio ? { ...src.audio, url: px(src.audio.url) } : null };
}

function previewSourceRaw(info) {
  const f = info.formats || [];
  const muxedHttp = f.filter((x) => hasV(x) && hasA(x) && !isHls(x) && (x.protocol || '').startsWith('http') && x.height && x.height <= 720);
  const muxedHls = f.filter((x) => hasV(x) && hasA(x) && isHls(x) && x.height);
  const byClosest = (arr, target) => arr.sort((a, b) => Math.abs(a.height - target) - Math.abs(b.height - target))[0];
  // Twitch: muxed HLS variants
  if (muxedHls.length) {
    const p = byClosest(muxedHls, 480);
    return { type: 'hls', url: p.url, height: p.height };
  }
  // Video-only + audio (YouTube without format 18)
  const vHls = f.filter((x) => hasV(x) && !hasA(x) && isHls(x) && codecFamily(x.vcodec) === 'H.264' && x.height);
  const vHttp = f.filter((x) => hasV(x) && !hasA(x) && !isHls(x) && codecFamily(x.vcodec) === 'H.264' && x.height);
  if (vHls.length) {
    const v = byClosest(vHls, 480);
    const a = pickAudio(f, true);
    return { type: 'hls', url: v.url, height: v.height, audio: a ? { type: isHls(a) ? 'hls' : 'file', url: a.url } : null };
  }
  if (muxedHttp.length) {
    const p = byClosest(muxedHttp, 480);
    return { type: 'file', url: p.url, height: p.height };
  }
  if (vHttp.length) {
    const v = byClosest(vHttp, 480);
    const a = pickAudio(f, false);
    return { type: 'file', url: v.url, height: v.height, audio: a ? { type: isHls(a) ? 'hls' : 'file', url: a.url } : null };
  }
  if (info.url) return { type: isHls(info) ? 'hls' : 'file', url: info.url };
  return null;
}

/** Format used for frame grabs (facecam detection): mid-res video. */
function frameFormat(info) {
  const f = (info.formats || []).filter((x) => hasV(x) && x.height && x.height >= 360 && !/mhtml/.test(x.ext));
  const h264 = f.filter((x) => codecFamily(x.vcodec) === 'H.264');
  const list = h264.length ? h264 : f;
  const hls = list.filter(isHls);
  const pool = hls.length ? hls : list;
  return pool.sort((a, b) => Math.abs(a.height - 480) - Math.abs(b.height - 480))[0] || null;
}

function storyboard(info) {
  const sb = (info.formats || []).filter((f) => f.format_note === 'storyboard' && f.fragments && f.rows && f.columns);
  if (!sb.length) return null;
  const best = sb.sort((a, b) => b.width - a.width)[0];
  return {
    width: best.width,
    height: best.height,
    rows: best.rows,
    columns: best.columns,
    fragments: best.fragments.map((x) => ({ url: x.url, duration: x.duration })),
  };
}

function slim(cacheId, info, prefs, srcUrl) {
  const qualities = buildQualities(info);
  const extractor = (info.extractor_key || info.extractor || '').toLowerCase();
  const site = extractor.includes('twitch') ? 'twitch' : extractor.includes('youtube') ? 'youtube' : extractor;
  const channel = info.channel || info.uploader || info.uploader_id || 'Unknown';
  // Twitch: VODs and clips report different ids (login vs numeric), the display name matches both.
  const keyPart = site === 'twitch' ? info.channel || info.uploader || info.uploader_id : info.channel_id || info.uploader_id || channel;
  const channelKey = `${site}:${String(keyPart || channel).toLowerCase()}`;
  const clean = (t) => String(t || '').replace(/[​-‏⁠﻿]/g, '').trim();
  let title = clean(info.title) || clean(info.fulltitle) || clean(info.description).split('\n')[0].slice(0, 80);
  if (!title) {
    const d = info.upload_date || '';
    title = `${channel} stream${d ? ` ${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''}`;
  }
  let thumb = info.thumbnail || '';
  if (!thumb && Array.isArray(info.thumbnails) && info.thumbnails.length) thumb = info.thumbnails.at(-1).url;
  return {
    cacheId,
    url: info.webpage_url || srcUrl,
    id: info.id,
    site,
    title,
    channel,
    channelKey,
    duration: info.duration || 0,
    // Twitch VODs of a stream that is still running are fine (growing playlist); channel live URLs are not.
    isLive: (info.is_live || info.live_status === 'is_live') && !/vod|video/i.test(info.extractor_key || ''),
    growing: !!(info.is_live && /vod/i.test(info.extractor_key || '')),
    // short media (Twitch clips, shorts) get appended to the clip list instead of replacing the workspace
    kind: /clip/i.test(info.extractor_key || '') || (info.duration && info.duration <= 180) ? 'clip' : 'vod',
    uploadDate: info.upload_date || info.release_date || null,
    thumbnail: thumb,
    width: info.width || (qualities[0] && qualities[0].width) || 1920,
    height: info.height || (qualities[0] && qualities[0].height) || 1080,
    heatmap: (info.heatmap || []).map((h) => [h.start_time, h.end_time, h.value]),
    chapters: (info.chapters || []).map((c) => ({ start: c.start_time, end: c.end_time, title: c.title })),
    qualities,
    defaultQuality: defaultQuality(qualities, prefs),
    preview: previewSource(info),
    storyboard: storyboard(info),
    startHint: parseStartHint(srcUrl),
    userAgent: (info.http_headers || {})['User-Agent'] || null,
  };
}

/**
 * Twitch clips (and some other sites) report no codecs at all: treat such formats as muxed H.264/AAC.
 * Twitch's auto-cropped "portrait-*" clip variants are dropped.
 */
function normalize(info) {
  if (!Array.isArray(info.formats)) return info;
  info.formats = info.formats.filter((f) => !/^portrait/i.test(f.format_id || ''));
  for (const f of info.formats) {
    const unknown = (f.vcodec == null || f.vcodec === '') && (f.acodec == null || f.acodec === '');
    if (unknown && f.height && f.resolution !== 'audio only' && f.ext !== 'mhtml') {
      f.vcodec = 'avc1';
      f.acodec = 'mp4a';
    }
  }
  return info;
}

function runJson(tools, url, signal) {
  return new Promise((resolve, reject) => {
    const args = [...tools.ytdlpBaseArgs(), '-J', '--no-playlist', url];
    const p = tools.spawn('ytdlp', args);
    let out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    signal?.addEventListener('abort', () => p.kill());
    p.on('close', (code) => {
      if (code !== 0) {
        const line = err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() || err.trim().split(/\r?\n/).pop() || `yt-dlp exited ${code}`;
        // YouTube's "Sign in to confirm you're not a bot": a plain explanation + what the user can do
        if (/confirm you.{1,3}re not a bot|sign in to confirm/i.test(line))
          return reject(new Error('BOTCHECK: YouTube wants a sign-in for your connection right now (usually after a lot of requests). Wait a while, or let Vodslice use your YouTube login from the browser.'));
        return reject(new Error(line.replace(/^ERROR:\s*/, '')));
      }
      try {
        resolve(normalize(JSON.parse(Buffer.concat(out).toString('utf8'))));
      } catch (e) {
        reject(new Error('Could not parse yt-dlp output'));
      }
    });
  });
}

async function probe(tools, url, prefs) {
  const info = await runJson(tools, url);
  if (info._type === 'playlist') throw new Error('Playlists are not supported — paste a single video/VOD link.');
  const cacheId = `${info.extractor_key || 'x'}:${info.id}`;
  CACHE.set(cacheId, { info, fetchedAt: Date.now(), url });
  const ua = (info.http_headers || {})['User-Agent'];
  if (ua) module.exports.lastUserAgent = ua;
  const out = slim(cacheId, info, prefs, url);
  // Twitch VODs: yt-dlp has no storyboards, Twitch's own seek previews feed the filmstrip + scrub preview
  if (out.site === 'twitch' && out.kind === 'vod') out.twitchId = String(info.id || '').replace(/^v/, '');
  if (out.twitchId && !out.storyboard) {
    try {
      out.storyboard = await Promise.race([require('./twitch.cjs').storyboard(out.twitchId), new Promise((r) => setTimeout(() => r(null), 5000))]);
    } catch {}
  }
  return out;
}

/** Return full info, refreshing if the signed URLs might have expired. */
async function fullInfo(tools, cacheId, url, maxAgeMs = 30 * 60 * 1000) {
  const c = CACHE.get(cacheId);
  if (c && Date.now() - c.fetchedAt < maxAgeMs) return c.info;
  const info = await runJson(tools, url || (c && c.url));
  CACHE.set(cacheId, { info, fetchedAt: Date.now(), url: url || (c && c.url) });
  return info;
}

function cached(cacheId) {
  const c = CACHE.get(cacheId);
  return c ? c.info : null;
}

module.exports = { probe, fullInfo, cached, buildQualities, frameFormat, codecFamily, isHls, parseStartHint, normalize };
