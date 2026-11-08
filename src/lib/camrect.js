// Pure geometry for facecam rectangle detection (no browser APIs, testable in Node).

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Edge persistence + temporal stability maps. */
export function analyze(grays, W, H) {
  const N = grays.length;
  const pv = new Float32Array(W * H); // persistent vertical edges
  const ph = new Float32Array(W * H); // persistent horizontal edges
  const mean = new Float32Array(W * H);
  const sq = new Float32Array(W * H);
  const T = 40;
  for (const g of grays) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1];
        const gy = g[i + W - 1] + 2 * g[i + W] + g[i + W + 1] - g[i - W - 1] - 2 * g[i - W] - g[i - W + 1];
        if (Math.abs(gx) > T && Math.abs(gx) > Math.abs(gy)) pv[i]++;
        if (Math.abs(gy) > T && Math.abs(gy) > Math.abs(gx)) ph[i]++;
      }
    }
    for (let i = 0; i < g.length; i++) {
      mean[i] += g[i];
      sq[i] += g[i] * g[i];
    }
  }
  const stable = new Float32Array(W * H); // 1 = pixel barely changes across samples
  for (let i = 0; i < W * H; i++) {
    pv[i] /= N;
    ph[i] /= N;
    const m = mean[i] / N;
    const sd = Math.sqrt(Math.max(0, sq[i] / N - m * m));
    stable[i] = sd < 14 ? 1 : sd < 28 ? 0.5 : 0;
  }
  return { pv, ph, stable };
}

/** Border candidates for one side, scanning outward from the face. Returns [{pos, score}] best first. */
function scanSide(maps, W, H, side, face, span) {
  const { pv, ph, stable } = maps;
  const vertical = side === 'left' || side === 'right';
  const [a0, a1] = span; // pixel range along the border
  const lineScore = (pos) => {
    let e = 0;
    let n = 0;
    const m = vertical ? pv : ph;
    for (let a = a0; a <= a1; a++) {
      const i = vertical ? a * W + pos : pos * W + a;
      const i2 = vertical ? a * W + Math.min(W - 1, pos + 1) : Math.min(H - 1, pos + 1) * W + a;
      const i0 = vertical ? a * W + Math.max(0, pos - 1) : Math.max(0, pos - 1) * W + a;
      e += Math.max(m[i], m[i2], m[i0]);
      n++;
    }
    return n ? e / n : 0;
  };
  const bandStable = (from, to) => {
    let s = 0;
    let n = 0;
    const lo = Math.max(0, Math.min(from, to));
    const hi = Math.min(vertical ? W - 1 : H - 1, Math.max(from, to));
    for (let p = lo; p <= hi; p++)
      for (let a = a0; a <= a1; a += 2) {
        s += stable[vertical ? a * W + p : p * W + a];
        n++;
      }
    return n ? s / n : 0;
  };
  const limit = vertical ? W : H;
  const fStart = side === 'left' ? Math.floor(face.x * W) : side === 'right' ? Math.ceil((face.x + face.w) * W) : side === 'top' ? Math.floor(face.y * H) : Math.ceil((face.y + face.h) * H);
  const margin = Math.round((vertical ? face.w * W : face.h * H) * 0.3);
  const dir = side === 'left' || side === 'top' ? -1 : 1;
  const edgePos = dir < 0 ? 0 : limit - 1;
  const raw = [];
  for (let pos = fStart + dir * margin; dir < 0 ? pos > 2 : pos < limit - 3; pos += dir) {
    const ls = lineScore(pos);
    if (ls < 0.2) continue;
    const inside = bandStable(pos - dir * 2, pos - dir * 8);
    const outside = bandStable(pos + dir * 2, pos + dir * 8);
    raw.push({ pos, score: ls * 0.7 + Math.max(0, inside - outside) * 0.6 });
  }
  // non-max suppression
  raw.sort((a, b) => b.score - a.score);
  const cands = [];
  for (const c of raw) if (!cands.some((k) => Math.abs(k.pos - c.pos) < 5)) cands.push(c);
  const top = cands.slice(0, 5);
  // Frame edge is always a candidate. Lines hugging the edge (cam flush with the frame) snap to it.
  const nearEdge = Math.round(limit * 0.035);
  const out = [];
  for (const c of top) {
    if (Math.abs(c.pos - edgePos) <= nearEdge) out.push({ pos: edgePos, score: c.score, edge: true });
    else out.push(c);
  }
  out.push({ pos: edgePos, score: 0.25 + 0.2 * bandStable(edgePos - dir * 2, edgePos - dir * 10), edge: true });
  return out;
}

const CAM_ASPECTS = [
  [16 / 9, 0.55],
  [4 / 3, 0.4],
  [1, 0.3],
  [9 / 16, 0.3],
];

function pickBest(L, R, T, B, W, H, face) {
  let best = null;
  const fx0 = face.x * W;
  const fx1 = (face.x + face.w) * W;
  const fy0 = face.y * H;
  const fy1 = (face.y + face.h) * H;
  for (const l of L)
    for (const r of R) {
      const w = r.pos - l.pos;
      if (l.pos > fx0 || r.pos < fx1 || w < (fx1 - fx0) * 1.4) continue;
      for (const t of T)
        for (const b of B) {
          const h = b.pos - t.pos;
          if (t.pos > fy0 || b.pos < fy1 || h < (fy1 - fy0) * 1.3) continue;
          const a = w / h;
          let bonus = 0;
          for (const [ca, wgt] of CAM_ASPECTS) bonus = Math.max(bonus, wgt * Math.max(0, 1 - Math.abs(Math.log(a / ca)) / 0.05));
          // a face fills a cam reasonably: penalize huge boxes
          const areaPen = Math.max(0, (w * h) / (W * H) - 0.35) * 2;
          const score = l.score + r.score + t.score + b.score + bonus - areaPen;
          if (!best || score > best.score) best = { score, l, r, t, b };
        }
    }
  return best;
}

export function findRect(maps, W, H, face) {
  const fx0 = Math.round(face.x * W);
  const fx1 = Math.round((face.x + face.w) * W);
  const fy0 = Math.round(face.y * H);
  const fy1 = Math.round((face.y + face.h) * H);
  let vSpan = [Math.max(1, fy0), Math.min(H - 2, fy1)];
  let hSpan = [Math.max(1, fx0), Math.min(W - 2, fx1)];
  let best = null;
  for (let it = 0; it < 2; it++) {
    const L = scanSide(maps, W, H, 'left', face, vSpan);
    const R = scanSide(maps, W, H, 'right', face, vSpan);
    const T = scanSide(maps, W, H, 'top', face, hSpan);
    const B = scanSide(maps, W, H, 'bottom', face, hSpan);
    const b = pickBest(L, R, T, B, W, H, face);
    if (!b) break;
    best = b;
    // refine: measure each border along the full extent of the other two
    vSpan = [Math.max(1, b.t.pos + 3), Math.min(H - 2, b.b.pos - 3)];
    hSpan = [Math.max(1, b.l.pos + 3), Math.min(W - 2, b.r.pos - 3)];
  }
  if (!best) return { rect: null, strong: 0 };
  const sides = [best.l, best.r, best.t, best.b];
  const rect = { x: best.l.pos / W, y: best.t.pos / H, w: (best.r.pos - best.l.pos + 1) / W, h: (best.b.pos - best.t.pos + 1) / H };
  const strong = sides.filter((s) => s.score > 0.4 || s.edge).length;
  return { rect, strong, sides };
}

export function fallbackRect(face, frameAspect) {
  // 16:9 cam around the face, face slightly above center.
  const w = Math.min(0.45, face.w * 3.6);
  const h = Math.min(0.6, (w * frameAspect * 9) / 16);
  const cx = face.x + face.w / 2;
  const x = clamp01(cx - w / 2);
  const y = clamp01(face.y + face.h * 0.45 - h * 0.45);
  return { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
}

