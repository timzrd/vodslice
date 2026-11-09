// Word timing refinement against the actual audio, so captions appear exactly when someone talks.
//
// Whisper's word times are good to ~0.1–0.4 s but the first word of a phrase is often early. Here:
//   1. find speech "islands" in the 16 kHz WAV (voice-band energy, split at >=120 ms of quiet)
//   2. assign every word to the island it belongs to (keeping order)
//   3. inside an island, spread its words over the voiced time by length and move each boundary to the
//      nearest energy dip — the first word starts exactly at the island start, the last ends at its end.
// Pure JS, no extra tools or models.
const fs = require('node:fs');

const HOP = 160; // 10 ms at 16 kHz

function readPcm(wavPath) {
  const b = fs.readFileSync(wavPath);
  let off = 12;
  while (off < b.length - 8 && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
  off += 8;
  return new Int16Array(b.buffer, b.byteOffset + off, Math.floor((b.length - off) / 2));
}

/** Voice-band (≈150–3500 Hz) energy per 10 ms, in dB. */
function envelope(pcm) {
  const env = new Float32Array(Math.floor(pcm.length / HOP));
  // one-pole high-pass (~150 Hz) + low-pass (~3.5 kHz)
  const aH = Math.exp((-2 * Math.PI * 150) / 16000);
  const aL = Math.exp((-2 * Math.PI * 3500) / 16000);
  let hpPrevIn = 0;
  let hpPrevOut = 0;
  let lp = 0;
  for (let i = 0; i < env.length; i++) {
    let e = 0;
    for (let k = 0; k < HOP; k++) {
      const x = pcm[i * HOP + k];
      const hp = aH * (hpPrevOut + x - hpPrevIn);
      hpPrevIn = x;
      hpPrevOut = hp;
      lp = (1 - aL) * hp + aL * lp;
      e += lp * lp;
    }
    env[i] = 10 * Math.log10(e / HOP + 1);
  }
  // light smoothing
  const sm = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) sm[i] = (env[Math.max(0, i - 1)] + 2 * env[i] + env[Math.min(env.length - 1, i + 1)]) / 4;
  return sm;
}

function threshold(env) {
  const s = Array.from(env).sort((a, b) => a - b);
  const floor = s[Math.floor(s.length * 0.12)] || 0;
  const peak = s[Math.floor(s.length * 0.92)] || 0;
  const median = s[Math.floor(s.length * 0.5)] || 0;
  // digital silence drags the floor down; background noise must stay below the line too
  return Math.max(floor + (peak - floor) * 0.42, median - 14, peak - 26);
}

/** Speech islands [{start, end}] in seconds. */
function islands(env, thr, minQuiet = 12, minLen = 6) {
  const out = [];
  let i = 0;
  while (i < env.length) {
    while (i < env.length && env[i] < thr) i++;
    if (i >= env.length) break;
    const s = i;
    let lastLoud = i;
    while (i < env.length) {
      if (env[i] >= thr) lastLoud = i;
      else if (i - lastLoud >= minQuiet) break;
      i++;
    }
    if (lastLoud - s + 1 >= minLen) out.push({ start: s / 100, end: (lastLoud + 1) / 100 });
  }
  return out;
}

function dipNear(env, t, radius = 0.09) {
  const c = Math.round(t * 100);
  const r = Math.round(radius * 100);
  let best = c;
  for (let k = Math.max(1, c - r); k <= Math.min(env.length - 2, c + r); k++) if (env[k] < env[best]) best = k;
  return best / 100;
}

function snapWords(words, wavPath) {
  if (!words.length) return words;
  const env = envelope(readPcm(wavPath));
  const thr = threshold(env);
  const isl = islands(env, thr);
  if (!isl.length) return words;
  const out = words.map((w) => ({ ...w }));

  // 2. assign words to islands, monotonic
  const dist = (w, I) => {
    const mid = (w.start + Math.max(w.start, w.end)) / 2;
    return mid < I.start ? I.start - mid : mid > I.end ? mid - I.end : 0;
  };
  let cur = 0;
  const groups = new Map();
  for (let i = 0; i < out.length; i++) {
    let best = -1;
    let bd = Infinity;
    for (let k = cur; k < isl.length; k++) {
      const d = dist(out[i], isl[k]);
      if (d < bd) {
        bd = d;
        best = k;
      }
      if (isl[k].start > out[i].end + 1) break;
    }
    if (best < 0 || bd > 0.7) continue; // no speech nearby: keep whisper's time
    cur = best;
    if (!groups.has(best)) groups.set(best, []);
    groups.get(best).push(i);
  }

  // 3. distribute words inside each island by length, boundaries at energy dips
  for (const [k, idxs] of groups) {
    const I = isl[k];
    const len = I.end - I.start;
    const weights = idxs.map((i) => Math.max(2, out[i].w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.5);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    const bounds = [I.start];
    for (let j = 0; j < idxs.length - 1; j++) {
      acc += weights[j];
      const prop = I.start + (len * acc) / total;
      // blend with whisper's own boundary when it is plausible, then snap to a dip
      const wb = out[idxs[j + 1]].start;
      const guess = wb > bounds[j] + 0.08 && wb < I.end - 0.05 && Math.abs(wb - prop) < 0.35 ? (prop + wb) / 2 : prop;
      bounds.push(Math.max(bounds[j] + 0.08, Math.min(I.end - 0.05, dipNear(env, guess))));
    }
    bounds.push(I.end);
    idxs.forEach((i, j) => {
      out[i].start = bounds[j];
      out[i].end = bounds[j + 1];
      out[i].aligned = true;
    });
  }
  // keep global order sane
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].start + 0.05) out[i].start = out[i - 1].start + 0.05;
  for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = out[i + 1].start;
  return out;
}

module.exports = { snapWords, envelope, islands, threshold, readPcm };
