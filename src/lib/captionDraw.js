// Draws one caption frame onto a TRANSPARENT 2D canvas. Used by the Studio preview, the Premiere preview in the
// editor and the exporter window (#capsrender) — so the preview is exactly what lands in Premiere.
// Units: everything in the caption style is in px of a 1920 px high frame; `k` scales to the canvas.
import { captionText } from '../../electron/layout.mjs';

export const fontString = (cap, px) => `${cap.italic ? 'italic ' : ''}${cap.weight || 400} ${Math.max(1, px).toFixed(2)}px "${cap.font}", "Arial Black", sans-serif`;

/** Wait until the caption font is usable (bundled fonts load on demand). */
export function ensureFont(cap) {
  try {
    return document.fonts.load(fontString(cap, 48), 'AÄg').catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

const work = new Map();
function canvasFor(name, w, h) {
  let c = work.get(name);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    work.set(name, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d');
  // state survives between frames on a reused canvas — reset everything that changes how pixels combine
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  return [c, ctx];
}

function setFont(ctx, cap, px) {
  ctx.font = fontString(cap, px);
  try {
    ctx.letterSpacing = `${((cap.tracking || 0) / 100) * px}px`;
  } catch {}
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
}

const layoutCache = new Map();
// measurements taken with a fallback font are wrong once the real font arrives
try {
  document.fonts.addEventListener('loadingdone', () => layoutCache.clear());
} catch {}
/**
 * Word positions of a caption (unanimated), in canvas px. lay = {x, y, w} of the captions layer in frame px.
 * Lines wrap at the layer width; the block is centered on (x, y).
 */
export function layoutCaption(ctx, chunk, cap, lay, k) {
  const key = `${chunk.start}|${chunk.words.map((w) => w.w).join(' ')}|${cap.font}|${cap.weight}|${cap.italic}|${cap.size}|${cap.tracking}|${cap.caps}|${cap.punct}|${cap.lineHeight}|${lay.x}|${lay.y}|${lay.w}|${k}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const px = cap.size * k;
  setFont(ctx, cap, px);
  const space = ctx.measureText(' ').width;
  const maxW = Math.max(px * 2, lay.w * k);
  const words = chunk.words.map((w) => {
    const text = captionText(w.w, cap);
    return { text, w: ctx.measureText(text).width };
  });
  const lines = [];
  let line = [];
  let lw = 0;
  for (const w of words) {
    const add = line.length ? space + w.w : w.w;
    if (line.length && lw + add > maxW) {
      lines.push({ words: line, width: lw });
      line = [];
      lw = 0;
    }
    line.push(w);
    lw += line.length > 1 ? space + w.w : w.w;
  }
  if (line.length) lines.push({ words: line, width: lw });
  const lh = px * (cap.lineHeight || 1.08);
  const cx = lay.x * k;
  const top = lay.y * k - (lines.length * lh) / 2;
  lines.forEach((ln, li) => {
    let x = cx - ln.width / 2;
    ln.y = top + lh * (li + 0.5);
    for (const w of ln.words) {
      w.x = x + w.w / 2;
      w.y = ln.y;
      x += w.w + space;
    }
  });
  const out = { words, lines, px, lh, cx, cy: lay.y * k, width: Math.max(...lines.map((l) => l.width)), height: lines.length * lh };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the caption state `st` (from captionState) onto ctx. oy shifts everything vertically (export bands).
 * Returns the caption's bounding box in canvas px (for the Studio's selection frame), or null.
 */
export function drawCaption(ctx, st, cap, lay, { k = 1, oy = 0 } = {}) {
  if (!st || !st.chunk) return null;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const L = layoutCaption(ctx, st.chunk, cap, { ...lay, y: lay.y + oy / k }, k);
  const em = L.px;
  const g = st.group;
  const act = cap.active || {};
  const strokes = (cap.effects || []).filter((e) => e.on && e.type === 'stroke');
  const maxStroke = strokes.reduce((m, e) => Math.max(m, e.width), 0) * k;

  /** Run fn for every visible word with its full transform applied (group around the caption center, then word). */
  const eachWord = (c, fn, { blur = true } = {}) => {
    setFont(c, cap, em);
    L.words.forEach((w, i) => {
      const ws = st.words[i];
      if (!ws || !ws.visible) return;
      const tf = ws.tf;
      const isActive = i === st.active && act.style !== 'none';
      const grow = isActive && (act.style === 'grow' || act.style === 'color' || act.style === 'box') ? act.scale || 1 : 1;
      const a = g.a * tf.a;
      if (a <= 0.003) return;
      c.save();
      c.globalAlpha *= a;
      c.translate(L.cx + g.dx * em, L.cy + g.dy * em);
      c.scale(g.s, g.s);
      c.translate(-L.cx, -L.cy);
      c.translate(w.x + tf.dx * em, w.y + tf.dy * em);
      c.scale(tf.s * grow, tf.s * grow);
      const b = (g.b + tf.b) * em;
      if (blur && b > 0.4) c.filter = `blur(${b.toFixed(1)}px)`;
      fn(c, w, isActive);
      c.restore();
    });
  };

  // silhouette (text + widest stroke) for shadow / glow / extrude, built once and tinted per effect
  let sil = null;
  const silhouette = () => {
    if (sil) return sil;
    const [c, x] = canvasFor('sil', W, H);
    x.fillStyle = '#fff';
    x.strokeStyle = '#fff';
    eachWord(x, (cc, w) => {
      if (maxStroke > 0) {
        cc.lineWidth = maxStroke * 2;
        cc.strokeText(w.text, 0, 0);
      }
      cc.fillText(w.text, 0, 0);
    });
    sil = c;
    return sil;
  };
  const tinted = (color, name) => {
    const [c, x] = canvasFor(name, W, H);
    x.drawImage(silhouette(), 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, W, H);
    return c;
  };

  // effects: the first one in the list sits right under the text, so draw from the last to the first
  const effects = (cap.effects || []).filter((e) => e.on);
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    ctx.save();
    if (e.type === 'box') {
      ctx.globalAlpha = g.a * (e.opacity == null ? 0.7 : e.opacity);
      ctx.fillStyle = e.color;
      const pad = (e.pad || 0.2) * em;
      for (const ln of L.lines) {
        const vis = ln.words.filter((w) => st.words[L.words.indexOf(w)] && st.words[L.words.indexOf(w)].visible);
        if (!vis.length) continue;
        const x0 = Math.min(...vis.map((w) => w.x - w.w / 2)) - pad;
        const x1 = Math.max(...vis.map((w) => w.x + w.w / 2)) + pad;
        const h = L.lh * 0.92 + pad * 0.8;
        ctx.save();
        ctx.translate(L.cx + g.dx * em, L.cy + g.dy * em);
        ctx.scale(g.s, g.s);
        ctx.translate(-L.cx, -L.cy);
        roundRect(ctx, x0, ln.y - h / 2, x1 - x0, h, (e.radius || 0.25) * em);
        ctx.fill();
        ctx.restore();
      }
    } else if (e.type === 'shadow') {
      const ang = ((e.angle == null ? 90 : e.angle) * Math.PI) / 180;
      const d = (e.distance || 0) * k;
      ctx.globalAlpha = e.opacity == null ? 0.6 : e.opacity;
      if (e.blur > 0) ctx.filter = `blur(${(e.blur * k * 0.5).toFixed(1)}px)`;
      ctx.drawImage(tinted(e.color, 'tint'), Math.cos(ang) * d, Math.sin(ang) * d);
    } else if (e.type === 'glow') {
      // Deep-glow style: the same shape blurred at growing radii, added up — bright core, long soft falloff
      const t = tinted(e.color, 'tint');
      const r = (e.radius || 60) * k;
      const I = e.intensity == null ? 1 : e.intensity;
      ctx.globalCompositeOperation = 'lighter';
      for (const [f, a] of [[0.06, 0.85], [0.18, 0.7], [0.4, 0.5], [0.75, 0.35], [1.25, 0.22]]) {
        ctx.filter = `blur(${Math.max(0.5, r * f).toFixed(1)}px)`;
        ctx.globalAlpha = Math.min(1, a * I);
        ctx.drawImage(t, 0, 0);
      }
    } else if (e.type === 'extrude') {
      const t = tinted(e.color, 'tint');
      const ang = ((e.angle == null ? 120 : e.angle) * Math.PI) / 180;
      const depth = (e.depth || 10) * k;
      const step = Math.max(0.75, depth / 40);
      for (let s = depth; s > 0; s -= step) ctx.drawImage(t, Math.cos(ang) * s, Math.sin(ang) * s);
    } else if (e.type === 'stroke') {
      ctx.strokeStyle = e.color;
      eachWord(ctx, (c, w) => {
        c.lineWidth = e.width * k * 2;
        c.strokeText(w.text, 0, 0);
      });
    }
    ctx.restore();
  }

  // the spoken word on a colored box
  if (act.style === 'box' && st.active >= 0) {
    ctx.save();
    ctx.fillStyle = act.color || '#8b5cf6';
    eachWord(
      ctx,
      (c, w, isActive) => {
        if (!isActive) return;
        const px = em * 0.2;
        const h = em * 1.08;
        roundRect(c, -w.w / 2 - px, -h / 2, w.w + px * 2, h, em * 0.22);
        c.fill();
      },
      { blur: false }
    );
    ctx.restore();
  }

  // fill
  eachWord(ctx, (c, w, isActive) => {
    c.fillStyle = isActive && (act.style === 'color' || act.style === 'grow') ? act.color || cap.color : cap.color;
    c.fillText(w.text, 0, 0);
  });

  const pad = maxStroke + em * 0.1;
  return { x: L.cx - L.width / 2 - pad, y: L.cy - L.height / 2 - pad, w: L.width + pad * 2, h: L.height + pad * 2 };
}

/** Lines of the caption for a chunk without drawing (Studio selection box / export band). */
export function measureCaption(ctx, chunk, cap, lay, k = 1) {
  const L = layoutCaption(ctx, chunk, cap, lay, k);
  return { lines: L.lines.length, width: L.width, height: L.height, cx: L.cx, cy: L.cy };
}
