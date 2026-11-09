// Same chunking rules as electron/captions.cjs (preview in the caption editor).
export function chunk(words, { maxWords = 3, maxChars = 18, maxDur = 1.5, pause = 0.3, offsetMs = 0 } = {}) {
  const off = (offsetMs || 0) / 1000;
  const out = [];
  let cur = null;
  words.forEach((w0, idx) => {
    const w = { ...w0, idx, start: Math.max(0, w0.start + off), end: Math.max(0, w0.end + off) };
    if (!w.w) return;
    if (cur) {
      const last = cur.words.at(-1);
      const chars = cur.words.reduce((a, x) => a + x.w.length, 0) + cur.words.length - 1;
      if (cur.words.length >= maxWords || chars + 1 + w.w.length > maxChars || w.start - last.end > pause || w.end - cur.start > maxDur || /[.!?…]$/.test(last.w)) {
        out.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(w);
    cur.end = w.end;
  });
  if (cur) out.push(cur);
  return out;
}

export function fmtTc(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
