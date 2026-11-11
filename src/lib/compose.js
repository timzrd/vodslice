// Draws the vertical Premiere composition (gameplay, facecam, chat, captions) of a preset onto a canvas.
// Geometry comes from electron/layout.mjs — the same numbers the Premiere XML is built from.
import { resolveLayers, presetSize, captionState } from '../../electron/layout.mjs';
import { drawCaption } from './captionDraw.js';
import { drawEdge } from './deco.js';

const SAMPLE_CHAT = [
  ['nightbot', '#7c3aed', 'clip it!!'],
  ['Lukas_07', '#ff6fae', 'NO WAY 😂'],
  ['blockfan', '#39c6ff', 'he actually did it'],
  ['minty', '#3ddc84', 'KEKW KEKW'],
  ['Sven', '#ff9f43', 'thats insane bro'],
  ['ella', '#ffd23f', 'W streamer'],
  ['donutlover', '#f87171', 'LETS GOOO'],
];

function drawChatSample(ctx, r, fontPx) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const lh = fontPx * 1.35;
  ctx.font = `700 ${fontPx}px "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let y = r.y + r.h - lh * 0.6;
  for (let i = SAMPLE_CHAT.length - 1; i >= 0 && y > r.y; i--) {
    const [name, color, msg] = SAMPLE_CHAT[i];
    let x = r.x + fontPx * 0.4;
    ctx.lineWidth = Math.max(1, fontPx * 0.18);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.font = `800 ${fontPx}px "Segoe UI", sans-serif`;
    ctx.strokeText(name + ':', x, y);
    ctx.fillStyle = color;
    ctx.fillText(name + ':', x, y);
    x += ctx.measureText(name + ': ').width;
    ctx.font = `600 ${fontPx}px "Segoe UI", sans-serif`;
    ctx.strokeText(msg, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(msg, x, y);
    y -= lh;
  }
  ctx.restore();
}

function placeholder(ctx, r, label, color) {
  ctx.save();
  ctx.fillStyle = '#16181d';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(10, Math.min(r.w, r.h) * 0.09)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

const overlays = new Map(); // one transparent canvas per size (Premiere tab, player preview, thumbnails)
function overlayCanvas(w, h) {
  const key = w + 'x' + h;
  let c = overlays.get(key);
  if (!c) {
    if (overlays.size > 12) overlays.clear();
    c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    overlays.set(key, c);
  }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  return [c, x];
}

/**
 * o.preset; o.k = canvas px per frame px; o.media = {gameplay:{el,box?}, facecam:{el,box?}} (video elements);
 * o.chunks + o.t for captions; o.chatFont (px in the chat render).
 * Returns {layers, captionBox} in canvas px for the Studio overlay.
 */
export function drawComposition(ctx, o) {
  const { preset, k } = o;
  const [W, H] = presetSize(preset);
  const u = H / 1920; // frame px per style px
  const cw = Math.round(W * k);
  const ch = Math.round(H * k);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  const dims = {};
  for (const key of ['gameplay', 'facecam']) {
    const m = o.media && o.media[key];
    if (m && m.el && m.el.videoWidth) dims[key] = { w: m.el.videoWidth, h: m.el.videoHeight, box: m.box || null };
  }
  dims.chat = { w: 520, h: 820 };
  const layers = resolveLayers(preset, dims);
  let captionBox = null;
  for (const l of layers) {
    if (l.type === 'captions') {
      const cap = preset.captions;
      if (!cap.enabled || !o.chunks) continue;
      const st = captionState(o.chunks, o.t || 0, cap);
      const [oc, ox] = overlayCanvas(cw, ch);
      captionBox = drawCaption(ox, st, cap, { x: l.x / u, y: l.y / u, w: l.w / u }, { k: k * u });
      ctx.drawImage(oc, 0, 0);
      l.box = captionBox;
      continue;
    }
    const d = { x: l.dst.x * k, y: l.dst.y * k, w: l.dst.w * k, h: l.dst.h * k };
    if (l.type === 'chat') {
      const box = preset.layers.find((x) => x.type === 'chat').rect;
      drawChatSample(ctx, { x: box.x * W * k, y: box.y * H * k, w: box.w * W * k, h: box.h * H * k }, Math.max(6, (o.chatFont || 26) * k * u));
      continue;
    }
    const m = o.media && o.media[l.type];
    if (!l.src || !m || !m.el) {
      placeholder(ctx, d, l.type === 'facecam' ? (o.noFacecam || 'Facecam') : 'Gameplay', l.type === 'facecam' ? '#39c6ff' : '#3ddc84');
      if (l.type === 'facecam') {
        const fl = preset.layers.find((x) => x.type === 'facecam');
        drawEdge(ctx, fl.edge, fl.rect, l.dst, k, u);
      }
      continue;
    }
    try {
      ctx.drawImage(m.el, l.src.x, l.src.y, l.src.w, l.src.h, d.x, d.y, d.w, d.h);
    } catch {
      placeholder(ctx, d, l.type, '#888');
    }
    if (l.type === 'facecam') {
      const fl = preset.layers.find((x) => x.type === 'facecam');
      drawEdge(ctx, fl.edge, fl.rect, l.dst, k, u);
    }
  }
  ctx.restore();
  return { layers, captionBox };
}
