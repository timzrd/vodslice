// Automatic facecam detection.
// 1) MediaPipe BlazeFace finds faces in frames sampled across the VOD (full frame + zoomed tiles for small faces).
// 2) The face that sits in the same spot in most frames is the streamer's cam.
// 3) The cam's rectangle is found where a persistent edge (overlay border) meets the change from
//    "static room background" (inside) to "constantly changing gameplay" (outside).
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { analyze, findRect, fallbackRect } from './camrect.js';

let detectorP = null;
function getDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      const base = new URL('./mediapipe', location.href).href;
      const fileset = await FilesetResolver.forVisionTasks(base);
      const make = (model, delegate) =>
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL(`./models/${model}.tflite`, location.href).href, delegate },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5,
          minSuppressionThreshold: 0.3,
        });
      for (const [m, d] of [
        ['blaze_face_full_range', 'GPU'],
        ['blaze_face_full_range', 'CPU'],
        ['blaze_face_short_range', 'GPU'],
        ['blaze_face_short_range', 'CPU'],
      ]) {
        try {
          return await make(m, d);
        } catch (e) {
          console.warn('face model failed', m, d, e);
        }
      }
      throw new Error('Face detector could not be loaded');
    })();
    detectorP.catch(() => (detectorP = null));
  }
  return detectorP;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Detect faces in one image (normalized coords). Uses tiles so small cam faces are found. */
async function facesIn(detector, img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const found = [];
  const run = (sx, sy, sw, sh) => {
    const c = document.createElement('canvas');
    const scale = Math.min(2.5, 640 / sw);
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const r = detector.detect(c);
    for (const d of r.detections || []) {
      const b = d.boundingBox;
      const score = (d.categories && d.categories[0] && d.categories[0].score) || 0.5;
      found.push({
        x: (sx + b.originX / scale) / W,
        y: (sy + b.originY / scale) / H,
        w: b.width / scale / W,
        h: b.height / scale / H,
        score,
      });
    }
  };
  run(0, 0, W, H);
  for (const n of [2, 3]) {
    const tw = W / n;
    const th = H / n;
    const ox = tw * 0.25;
    const oy = th * 0.25;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const sx = Math.max(0, i * tw - ox);
        const sy = Math.max(0, j * th - oy);
        run(sx, sy, Math.min(W - sx, tw + 2 * ox), Math.min(H - sy, th + 2 * oy));
      }
  }
  // NMS
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of found) if (f.w > 0.004 && !keep.some((k) => iou(k, f) > 0.3)) keep.push(f);
  return keep;
}

function grayOf(img, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  return g;
}

/**
 * @param {{dataUrl:string}[]} frames
 * @returns {Promise<{rect, confidence:'high'|'medium'|'low', message:string}|null>}
 */
export async function detectFacecam(frames, onStatus) {
  onStatus?.('Loading face model…');
  const detector = await getDetector();
  const imgs = [];
  for (const f of frames) {
    try {
      imgs.push(await loadImage(f.dataUrl));
    } catch {}
  }
  if (!imgs.length) return null;
  onStatus?.('Finding faces…');
  const all = [];
  for (let i = 0; i < imgs.length; i++) {
    const faces = await facesIn(detector, imgs[i]);
    faces.forEach((f) => all.push({ ...f, frame: i }));
  }
  // Cluster faces by position: the cam face sits still across samples.
  const clusters = [];
  for (const f of [...all].sort((a, b) => b.score - a.score)) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const c = clusters.find((k) => Math.abs(k.cx - cx) < Math.max(0.05, k.w * 0.9) && Math.abs(k.cy - cy) < Math.max(0.06, k.h * 0.9));
    if (c) {
      c.items.push(f);
      c.frames.add(f.frame);
    } else clusters.push({ cx, cy, w: f.w, h: f.h, items: [f], frames: new Set([f.frame]) });
  }
  const N = imgs.length;
  const scored = clusters
    .map((c) => {
      const med = (k) => {
        const v = c.items.map(k).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)];
      };
      const face = { x: med((f) => f.x), y: med((f) => f.y), w: med((f) => f.w), h: med((f) => f.h) };
      const meanScore = c.items.reduce((a, f) => a + f.score, 0) / c.items.length;
      // Cam faces are smallish and not dead-center (that's usually in-game characters / full cam scenes)
      return { face, presence: c.frames.size / N, score: c.frames.size * meanScore, meanScore };
    })
    .filter((c) => c.presence >= Math.min(0.3, 2 / N))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const best = scored[0];
  onStatus?.('Measuring cam border…');
  const W = 480;
  const H = Math.round((W * imgs[0].naturalHeight) / imgs[0].naturalWidth);
  const grays = imgs.map((im) => grayOf(im, W, H));
  const maps = analyze(grays, W, H);
  const { rect, strong } = findRect(maps, W, H, best.face);
  const aspect = W / H;
  const sane =
    !!rect &&
    rect.w > best.face.w * 1.4 &&
    rect.h > best.face.h * 1.3 &&
    rect.w < 0.75 &&
    rect.h < 0.9 &&
    (rect.w * aspect) / rect.h > 0.45 &&
    (rect.w * aspect) / rect.h < 3.2;
  if (strong >= 3 && sane) {
    return { rect, confidence: 'high', presence: best.presence, message: 'Facecam detected' };
  }
  if (strong >= 2 && sane) {
    return { rect, confidence: 'medium', presence: best.presence, message: 'Facecam detected — check the box edges' };
  }
  return { rect: fallbackRect(best.face, aspect), confidence: 'low', presence: best.presence, message: 'Face found, no clear cam border — box estimated' };
}

/** Pick sample times: some inside the clips, the rest spread over the VOD. */
export function sampleTimes(duration, segments, n = 14) {
  const times = [];
  const segs = segments.filter((s) => s.end > s.start);
  // Frames from the same minute make gameplay look static and hide the cam border, so for VODs longer than
  // ~10 minutes sample across the whole video (cam layouts rarely change within a stream).
  const inSeg = segs.length && duration < 600 ? Math.min(4, n - 6) : 0;
  const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
  for (let i = 0; i < inSeg; i++) {
    let t = ((i + 0.5) / inSeg) * total;
    for (const s of segs) {
      const len = s.end - s.start;
      if (t <= len) {
        times.push(s.start + t);
        break;
      }
      t -= len;
    }
  }
  const rest = n - times.length;
  for (let i = 0; i < rest; i++) times.push(duration * (0.04 + (0.92 * (i + 0.5)) / rest));
  return times.map((t) => Math.max(0, Math.min(duration - 1, Math.round(t))));
}
