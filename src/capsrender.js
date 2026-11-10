// Hidden window (#capsrender): renders the caption overlay frame by frame with the same drawing code as the
// Studio preview. Only the horizontal band the captions can reach is rendered (ffmpeg pads it back to the full
// frame); identical frames (no animation running) are sent once, with their real duration.
import { captionState, effectMargin } from '../electron/layout.mjs';
import { drawCaption, ensureFont, measureCaption } from './lib/captionDraw.js';

async function renderJob(job) {
  const { id, cap, layer, width: W, height: H, chunks, duration } = job;
  const fps = job.fps || 30;
  await ensureFont(cap);
  await document.fonts.ready;

  // band of rows the captions can reach (frames are 1920 high for every ratio → 1 px = 1 style px)
  const probe = new OffscreenCanvas(W, 64).getContext('2d');
  let lines = 1;
  for (const c of chunks) lines = Math.max(lines, measureCaption(probe, c, cap, layer, 1).lines);
  const half = (lines * cap.size * (cap.lineHeight || 1.08)) / 2 + effectMargin(cap);
  const y0 = Math.max(0, Math.floor((layer.y - half) / 2) * 2);
  const y1 = Math.min(H, Math.ceil((layer.y + half) / 2) * 2);
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
    drawCaption(ctx, captionState(chunks, t, cap), cap, layer, { k: 1, oy: -y0 });
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

window.api.onChatRenderJob((job) => {
  renderJob(job)
    .then((r) => window.api.capsRenderBand(job.id, r))
    .then(() => window.api.chatRenderDone(job.id))
    .catch((e) => window.api.chatRenderError(job.id, e.message || String(e)));
});
window.api.chatRenderReady();
