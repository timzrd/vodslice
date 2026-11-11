// Facecam edge decoration (line / shadow / glow / frame) — drawn in the previews and rendered as its own transparent
// track for Premiere ("Cam edge"). rect in frame px, k = canvas px per frame px, u = frame px per style px.
import { edgeSide } from '../../electron/layout.mjs';

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#ffffff');
  const n = parseInt(m ? m[1] : 'ffffff', 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** @param norm facecam rect in frame fractions (decides which edge) ; rect = same in frame px */
export function drawEdge(ctx, edge, norm, rect, k, u) {
  if (!edge || edge.type === 'none') return;
  const op = edge.opacity == null ? 1 : edge.opacity;
  const size = Math.max(1, (edge.size || 8) * u * k);
  const x = rect.x * k;
  const y = rect.y * k;
  const w = rect.w * k;
  const h = rect.h * k;
  ctx.save();
  if (edge.type === 'frame') {
    ctx.strokeStyle = hexA(edge.color, op);
    ctx.lineWidth = size;
    ctx.strokeRect(x + size / 2, y + size / 2, w - size, h - size);
    ctx.restore();
    return;
  }
  const side = edgeSide(norm);
  if (!side) return ctx.restore();
  const ey = side === 'bottom' ? y + h : y;
  const dir = side === 'bottom' ? 1 : -1;
  if (edge.type === 'line') {
    ctx.fillStyle = hexA(edge.color, op);
    ctx.fillRect(x, ey - size / 2, w, size);
  } else if (edge.type === 'shadow') {
    // soft shadow falling from the cam onto the gameplay
    const len = size * 8;
    const g = ctx.createLinearGradient(0, ey, 0, ey + dir * len);
    g.addColorStop(0, hexA(edge.color, 0.85 * op));
    g.addColorStop(0.35, hexA(edge.color, 0.4 * op));
    g.addColorStop(1, hexA(edge.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, dir > 0 ? ey : ey - len, w, len);
  } else if (edge.type === 'glow') {
    const core = Math.max(1, size / 3);
    ctx.globalCompositeOperation = 'lighter';
    for (const [b, a] of [[size * 3, 0.35], [size * 1.4, 0.55], [size * 0.5, 0.8]]) {
      ctx.filter = `blur(${b.toFixed(1)}px)`;
      ctx.fillStyle = hexA(edge.color, a * op);
      ctx.fillRect(x, ey - core / 2, w, core);
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = hexA('#ffffff', 0.9 * op);
    ctx.fillRect(x, ey - core / 4, w, core / 2);
    ctx.fillStyle = hexA(edge.color, op);
    ctx.fillRect(x, ey - core / 2, w, core);
  }
  ctx.restore();
}
