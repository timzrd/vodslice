// Parallel HLS range downloader.
// Fetches only the media segments that overlap [start, end] with many connections at once and writes them
// in order into one file (MPEG-TS or fMP4). Far faster than ffmpeg's sequential HLS reader for long VODs.
const fs = require('node:fs');

function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const segs = [];
  let t = 0;
  let dur = 0;
  let map = null;
  let byterange = null;
  let lastRangeEnd = 0;
  let encrypted = false;
  let variants = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8));
    else if (l.startsWith('#EXT-X-MAP:')) {
      const uri = /URI="([^"]+)"/.exec(l);
      const br = /BYTERANGE="(\d+)(?:@(\d+))?"/.exec(l);
      map = uri ? { url: new URL(uri[1], baseUrl).href, range: br ? [Number(br[2] || 0), Number(br[1])] : null } : null;
    } else if (l.startsWith('#EXT-X-BYTERANGE:')) {
      const m = /(\d+)(?:@(\d+))?/.exec(l.slice(17));
      const len = Number(m[1]);
      const off = m[2] !== undefined ? Number(m[2]) : lastRangeEnd;
      byterange = [off, len];
      lastRangeEnd = off + len;
    } else if (l.startsWith('#EXT-X-KEY:')) {
      if (!/METHOD=NONE/.test(l)) encrypted = true;
    } else if (l.startsWith('#EXT-X-STREAM-INF')) {
      const bw = Number((/BANDWIDTH=(\d+)/.exec(l) || [])[1] || 0);
      const next = (lines[i + 1] || '').trim();
      if (next && !next.startsWith('#')) variants.push({ bw, url: new URL(next, baseUrl).href });
    } else if (!l.startsWith('#')) {
      segs.push({ url: new URL(l, baseUrl).href, t, dur, range: byterange });
      t += dur;
      byterange = null;
    }
  }
  return { segs, map, encrypted, total: t, variants };
}

async function fetchText(url, headers, signal) {
  const r = await fetch(url, { headers, signal });
  if (!r.ok) throw new Error(`Playlist HTTP ${r.status}`);
  return r.text();
}

async function loadPlaylist(url, headers, signal) {
  let text = await fetchText(url, headers, signal);
  let pl = parsePlaylist(text, url);
  if (!pl.segs.length && pl.variants.length) {
    const best = pl.variants.sort((a, b) => b.bw - a.bw)[0];
    text = await fetchText(best.url, headers, signal);
    pl = parsePlaylist(text, best.url);
  }
  return pl;
}

function selectSegments(pl, start, end) {
  return pl.segs.filter((s) => s.t + s.dur > start + 0.001 && s.t < end - 0.001);
}

async function fetchSegment(seg, headers, signal) {
  const h = { ...headers };
  if (seg.range) h.Range = `bytes=${seg.range[0]}-${seg.range[0] + seg.range[1] - 1}`;
  let url = seg.url;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal?.aborted) throw new Error('Canceled');
    try {
      const r = await fetch(url, { headers: h, signal });
      if (r.status === 403 && /-unmuted\.ts/.test(url)) {
        // Twitch: unmuted variants of muted segments are not public.
        url = url.replace('-unmuted.ts', '-muted.ts');
        continue;
      }
      if (!r.ok) throw new Error(`Segment HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) throw new Error('Canceled');
      lastErr = e;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) ** 2));
    }
  }
  throw lastErr || new Error('Segment failed');
}

/**
 * Download [start,end] of an HLS media playlist into outFile.
 * @returns {Promise<{fileStart:number, fileEnd:number, bytes:number, segments:number, fmp4:boolean}>}
 */
async function downloadRange({ url, headers = {}, start, end, outFile, connections = 16, signal, onProgress, playlist }) {
  const pl = playlist || (await loadPlaylist(url, headers, signal));
  if (pl.encrypted) throw new Error('ENCRYPTED');
  const sel = selectSegments(pl, start, end);
  if (!sel.length) throw new Error('No segments in range');
  const out = fs.createWriteStream(outFile);
  const writeBuf = (b) => new Promise((res, rej) => out.write(b, (e) => (e ? rej(e) : res())));
  if (pl.map) {
    const init = await fetchSegment(pl.map, headers, signal);
    await writeBuf(init);
  }
  const results = new Map();
  let next = 0;
  let written = 0;
  let bytes = 0;
  let completed = 0;
  const window =Math.max(connections * 2, 8);
  let waiters = [];
  const wake = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  let failed = null;

  const flush = async () => {
    while (results.has(written)) {
      const b = results.get(written);
      results.delete(written);
      await writeBuf(b);
      written++;
      wake();
    }
  };
  let flushing = Promise.resolve();

  const worker = async () => {
    while (!failed) {
      const k = next;
      if (k >= sel.length) return;
      if (k - written >= window) {
        await new Promise((r) => waiters.push(r));
        continue;
      }
      next++;
      const buf = await fetchSegment(sel[k], headers, signal);
      bytes += buf.length;
      completed++;
      results.set(k, buf);
      onProgress?.({ bytes, done: completed, count: sel.length });
      flushing = flushing.then(flush);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(connections, sel.length) }, () =>
        worker().catch((e) => {
          failed = failed || e;
          wake();
        })
      )
    );
    if (failed) throw failed;
    await flushing;
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (failed) throw failed;
  return { fileStart: sel[0].t, fileEnd: sel.at(-1).t + sel.at(-1).dur, bytes, segments: sel.length, fmp4: !!pl.map };
}

module.exports = { parsePlaylist, loadPlaylist, selectSegments, downloadRange };
