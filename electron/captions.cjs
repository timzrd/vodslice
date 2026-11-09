// Shorts captions from word timestamps: chunks -> SRT, animated ASS (current word highlighted), alpha overlay video.
const fs = require('node:fs');

/**
 * Group words into short one-line captions.
 * Rules: max words, max characters, max duration, new caption after a pause.
 */
function chunk(words, { maxWords = 3, maxChars = 18, maxDur = 1.5, pause = 0.3, offsetMs = 0 } = {}) {
  const off = (offsetMs || 0) / 1000;
  const ws = words.map((w) => ({ ...w, start: Math.max(0, w.start + off), end: Math.max(0, w.end + off) }));
  const out = [];
  let cur = null;
  for (const w of ws) {
    const text = w.w;
    if (cur) {
      const last = cur.words.at(-1);
      const chars = cur.words.reduce((a, x) => a + x.w.length, 0) + cur.words.length - 1;
      const tooMany = cur.words.length >= maxWords;
      const tooLong = chars + 1 + text.length > maxChars;
      const gap = w.start - last.end > pause;
      const tooSlow = w.end - cur.start > maxDur;
      // a sentence end also closes a caption
      const sentence = /[.!?…]$/.test(last.w);
      if (tooMany || tooLong || gap || tooSlow || sentence) {
        out.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(w);
    cur.end = w.end;
  }
  if (cur) out.push(cur);
  // close tiny gaps so captions don't flicker, keep a minimum display time
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    if (next && next.start - c.end < 0.25) c.end = next.start;
    if (c.end - c.start < 0.3) c.end = next ? Math.min(next.start, c.start + 0.3) : c.start + 0.3;
  }
  return out;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');
function srtTime(t) {
  const ms = Math.round(t * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
function assTime(t) {
  const cs = Math.round(t * 100);
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}
const clean = (s, upper) => (upper ? s.toLocaleUpperCase('de-DE') : s).replace(/[{}\\]/g, '');

function toSrt(chunks, { uppercase = false } = {}) {
  return chunks.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${clean(c.words.map((w) => w.w).join(' '), uppercase)}\n`).join('\n');
}

/** "#RRGGBB" -> ASS "&HBBGGRR&" */
function assColor(hex, alpha = '00') {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#ffffff') || [0, 'ff', 'ff', 'ff'];
  return `&H${alpha}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

/**
 * Animated captions: one event per word while its caption is visible; the spoken word gets the highlight color
 * and a small pop. Positioned centered at y (pixels) of a W×H canvas.
 */
function toAss(chunks, { width, height, y, font = 'Arial Black', size = 84, color = '#ffffff', highlight = '#ffd23f', outline = 7, uppercase = true } = {}) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${size},${assColor(color)},${assColor(highlight)},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},2,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const hi = assColor(highlight);
  const lines = [];
  const pos = `{\\an5\\pos(${Math.round(width / 2)},${Math.round(y)})}`;
  for (const c of chunks) {
    for (let i = 0; i < c.words.length; i++) {
      const w = c.words[i];
      const s = i === 0 ? c.start : w.start;
      const e = i === c.words.length - 1 ? c.end : c.words[i + 1].start;
      if (e - s < 0.01) continue;
      const text = c.words
        .map((x, k) => (k === i ? `{\\c${hi}\\fscx108\\fscy108}${clean(x.w, uppercase)}{\\r}` : clean(x.w, uppercase)))
        .join(' ');
      // first word of a caption pops in
      const pop = i === 0 ? '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}' : '';
      lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Cap,,0,0,0,,${pos}${pop}${text}`);
    }
  }
  return head + lines.join('\n') + '\n';
}

function writeAll(dir, base, words, opts) {
  const chunks = chunk(words, opts);
  const srt = `${dir}/${base}.srt`;
  fs.writeFileSync(srt, '﻿' + toSrt(chunks, opts));
  const ass = `${dir}/${base}.ass`;
  fs.writeFileSync(ass, toAss(chunks, opts));
  return { chunks, srt, ass };
}

module.exports = { chunk, toSrt, toAss, writeAll, srtTime };
