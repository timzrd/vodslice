// Hidden window (#capsrender): renders overlay frames for the Premiere export with the same drawing code as the
// Studio preview.
//   kind 'captions': only the horizontal band the captions can reach is rendered (ffmpeg pads it back to the full
//                    frame); identical frames (no animation running) are sent once, with their real duration.
//   kind 'edge':     one full-frame image of the facecam edge (line / shadow / glow / frame).
import { captionState, effectMargin } from '../electron/layout.mjs';
import { drawCaption, ensureFont, measureCaption } from './lib/captionDraw.js';
import { drawEdge } from './lib/deco.js';

async function renderCaptions(job) {
  const { id, cap, width: W, height: H, chunks, duration } = job;
  const fps = job.fps || 30;
  const u = H / 1920; // frame px per style px
  const layer = { x: job.layer.x / u, y: job.layer.y / u, w: job.layer.w / u }; // in style units
  await ensureFont(cap);
  await document.fonts.ready;

  // band of rows the captions can reach
  const probe = new OffscreenCanvas(64, 64).getContext('2d');
  let lines = 1;
  for (const c of chunks) lines = Math.max(lines, measureCaption(probe, c, cap, layer, 1).lines);
  const half = ((lines * cap.size * (cap.lineHeight || 1.08)) / 2 + effectMargin(cap)) * u;
  const cy = layer.y * u;
  const y0 = Math.max(0, Math.floor((cy - half) / 2) * 2);
  const y1 = Math.min(H, Math.ceil((cy + half) / 2) * 2);
  const bandH = Math.max(2, y1 - y0);

  // pass 1: which frames differ from the previous one
  const n = Math.max(1, Math.ceil(duration * fps));
  const times = [];
  let prev;
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const st = captionState(chunks, t, cap);
    if (i > 0 && st.key && st.key === prev) continue;
    prev = st.key;
    times.push(t);
  }
  window.api.chatRenderStart(id, times.length);

  // pass 2: draw + encode (a few PNG encodes in flight)
  const canvas = new OffscreenCanvas(W, bandH);
  const ctx = canvas.getContext('2d');
  const inflight = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, bandH);
    drawCaption(ctx, captionState(chunks, t, cap), cap, layer, { k: u, oy: -y0 });
    const blob = canvas.convertToBlob({ type: 'image/png' });
    inflight.push(
      blob.then(async (b) => {
        window.api.chatRenderFrame(id, i, t, new Uint8Array(await b.arrayBuffer()));
      })
    );
    if (inflight.length >= 6) await inflight.shift();
  }
  await Promise.all(inflight);
  return { bandY: y0, bandH };
}

async function renderEdge(job) {
  const { id, width: W, height: H, edge, rect } = job;
  window.api.chatRenderStart(id, 1);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawEdge(ctx, edge, rect, { x: rect.x * W, y: rect.y * H, w: rect.w * W, h: rect.h * H }, 1, H / 1920);
  const b = await canvas.convertToBlob({ type: 'image/png' });
  window.api.chatRenderFrame(id, 0, 0, new Uint8Array(await b.arrayBuffer()));
  return { bandY: 0, bandH: H };
}

window.api.onChatRenderJob((job) => {
  (job.kind === 'edge' ? renderEdge(job) : renderCaptions(job))
    .then((r) => window.api.capsRenderBand(job.id, r))
    .then(() => window.api.chatRenderDone(job.id))
    .catch((e) => window.api.chatRenderError(job.id, e.message || String(e)));
});
window.api.chatRenderReady();
