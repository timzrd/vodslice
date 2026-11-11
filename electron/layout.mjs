// Shared between the main process (Premiere XML, caption chunks) and the renderer (Studio, previews, caption
// rendering): vertical frame sizes, layout presets, layer geometry, caption chunking and caption animation state.
// Pure functions only — no DOM, no Node APIs.

export const RATIOS = { '9:16': [1080, 1920], '3:4': [1440, 1920], '4:5': [1536, 1920], '1:1': [1920, 1920] };
/** Sequence resolution: frame height. Caption sizes etc. are stored "per 1920 px" and scale with it. */
export const QUALITIES = { hd: { label: 'HD', h: 1920 }, '2k': { label: '2K', h: 2560 }, '4k': { label: '4K', h: 3840 } };
export function frameSize(ratio, quality = 'hd') {
  const [w, h] = RATIOS[ratio] || RATIOS['3:4'];
  const H = (QUALITIES[quality] || QUALITIES.hd).h;
  return [Math.round((w * H) / h / 2) * 2, H];
}
export const presetSize = (p) => frameSize(p.ratio, p.quality);
/** frame px per style px (styles are defined for a 1920 px high frame) */
export const unitOf = (p) => presetSize(p)[1] / 1920;
export const EDGES = ['none', 'line', 'shadow', 'glow', 'frame'];
export const DEFAULT_EDGE = { type: 'none', color: '#ffffff', size: 8, opacity: 1 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let seq = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- captions: style model

export const ANIM_IN = ['none', 'fade', 'pop', 'bounce', 'rise', 'slide', 'zoom', 'blur'];
export const ANIM_OUT = ['none', 'fade', 'sink', 'shrink', 'blur'];
export const ACTIVE_STYLES = ['none', 'color', 'box', 'grow'];
export const EFFECTS = {
  stroke: { label: 'Stroke', defaults: { width: 10, color: '#000000' } },
  shadow: { label: 'Drop shadow', defaults: { color: '#000000', opacity: 0.6, blur: 14, distance: 7, angle: 90 } },
  glow: { label: 'Deep glow', defaults: { color: '#ffd23f', radius: 60, intensity: 1 } },
  box: { label: 'Background box', defaults: { color: '#000000', opacity: 0.7, pad: 0.22, radius: 0.28 } },
  extrude: { label: '3D extrude', defaults: { color: '#000000', depth: 10, angle: 120 } },
};
export const newEffect = (type, over = {}) => ({ id: uid('e'), type, on: true, ...clone(EFFECTS[type].defaults), ...over });

export const DEFAULT_CAPTIONS = {
  enabled: true,
  mode: 'overlay',         // 'overlay' = animated look as video track | 'editable' = text (SRT caption track + After Effects script)
  words: 3,
  maxChars: 18,
  font: 'Montserrat',
  weight: 900,
  italic: false,
  size: 92,                // px in a 1920 px high frame
  caps: 'upper',           // 'upper' | 'none' | 'lower'
  punct: false,            // keep , . ! ? in the captions
  tracking: 0,             // letter spacing, 1/100 em
  lineHeight: 1.08,
  color: '#ffffff',
  active: { style: 'color', color: '#ffd23f', scale: 1.1 },
  effects: [
    { id: 'stroke1', type: 'stroke', on: true, width: 10, color: '#000000' },
    { id: 'shadow1', type: 'shadow', on: true, color: '#000000', opacity: 0.55, blur: 16, distance: 7, angle: 90 },
  ],
  anim: { in: 'pop', out: 'none', mode: 'caption', speed: 1 },
};

/** Ready-made caption looks (font + colors + effects + motion); applying one keeps words, size and position. */
export const LOOKS = [
  {
    id: 'punch', name: 'Punch',
    style: { font: 'Montserrat', weight: 900, caps: 'upper', color: '#ffffff', active: { style: 'color', color: '#ffd23f', scale: 1.1 },
      effects: [newEffect('stroke', { width: 10 }), newEffect('shadow', { opacity: 0.55, blur: 16, distance: 7 })], anim: { in: 'pop', out: 'none', mode: 'caption', speed: 1 } },
  },
  {
    id: 'clean', name: 'Clean',
    style: { font: 'Poppins', weight: 800, caps: 'none', color: '#ffffff', active: { style: 'none', color: '#ffffff', scale: 1 },
      effects: [newEffect('shadow', { opacity: 0.7, blur: 22, distance: 4 })], anim: { in: 'rise', out: 'fade', mode: 'word', speed: 1 } },
  },
  {
    id: 'neon', name: 'Neon',
    style: { font: 'Montserrat', weight: 800, caps: 'upper', color: '#ffffff', active: { style: 'color', color: '#7dffb0', scale: 1.06 },
      effects: [newEffect('stroke', { width: 3, color: '#0b5d33' }), newEffect('glow', { color: '#2bff88', radius: 70, intensity: 1.1 })], anim: { in: 'zoom', out: 'fade', mode: 'caption', speed: 1 } },
  },
  {
    id: 'boxed', name: 'Boxed',
    style: { font: 'Poppins', weight: 800, caps: 'none', color: '#ffffff', active: { style: 'color', color: '#ffd23f', scale: 1 },
      effects: [newEffect('box', { opacity: 0.78, pad: 0.26, radius: 0.3 })], anim: { in: 'fade', out: 'fade', mode: 'caption', speed: 1 } },
  },
  {
    id: 'highlight', name: 'Highlight',
    style: { font: 'Montserrat', weight: 900, caps: 'upper', color: '#ffffff', active: { style: 'box', color: '#8b5cf6', scale: 1.04 },
      effects: [newEffect('stroke', { width: 8 }), newEffect('shadow', { opacity: 0.5, blur: 12, distance: 5 })], anim: { in: 'pop', out: 'none', mode: 'caption', speed: 1 } },
  },
  {
    id: 'comic', name: 'Comic',
    style: { font: 'Bangers', weight: 400, caps: 'upper', color: '#ffe14d', active: { style: 'color', color: '#ffffff', scale: 1.08 }, tracking: 4,
      effects: [newEffect('stroke', { width: 9 }), newEffect('extrude', { depth: 12, angle: 120 })], anim: { in: 'bounce', out: 'none', mode: 'caption', speed: 1 } },
  },
  {
    id: 'gamer', name: 'Gamer',
    style: { font: 'Luckiest Guy', weight: 400, caps: 'upper', color: '#ffffff', active: { style: 'color', color: '#4ade80', scale: 1.12 },
      effects: [newEffect('stroke', { width: 11 }), newEffect('extrude', { depth: 8, angle: 100 })], anim: { in: 'pop', out: 'none', mode: 'word', speed: 1 } },
  },
  {
    id: 'soft', name: 'Soft',
    style: { font: 'Rubik', weight: 700, caps: 'lower', color: '#ffffff', active: { style: 'none', color: '#ffffff', scale: 1 },
      effects: [newEffect('shadow', { opacity: 0.8, blur: 26, distance: 0 })], anim: { in: 'blur', out: 'blur', mode: 'word', speed: 1 } },
  },
];

// ---------------------------------------------------------------- presets (layout + caption style)

const L = (type, extra) => ({ id: type, type, on: true, ...extra });
const view0 = () => ({ zoom: 1, cx: 0.5, cy: 0.5 });

function basePreset(id, name, ratio, layers, capOver = {}) {
  return { id, name, ratio, quality: 'hd', builtIn: true, layers, captions: { ...clone(DEFAULT_CAPTIONS), ...capOver } };
}

/** Built-in starting points. `old` = the pre-Studio premiere settings, so the first preset looks like before. */
export function builtInPresets(old = {}) {
  const s = clamp(Number(old.split) || 1 / 3, 0.15, 0.6);
  const oc = old.captions || {};
  const capsOn = oc.enabled !== false;
  const capFromOld = {
    words: oc.maxWords || 3,
    maxChars: oc.maxChars || 18,
    size: oc.size || 92,
    caps: oc.uppercase === false ? 'none' : 'upper',
    color: oc.color || '#ffffff',
    active: { style: 'color', color: oc.highlight || '#ffd23f', scale: 1.1 },
  };
  return [
    basePreset('split', 'Split', '3:4', [
      L('gameplay', { rect: { x: 0, y: s, w: 1, h: 1 - s }, view: view0() }),
      L('facecam', { rect: { x: 0, y: 0, w: 1, h: s }, view: view0() }),
      L('chat', { on: false, rect: { x: 0.03, y: 0.62, w: 0.36, h: 0.34 } }),
      L('captions', { on: capsOn, x: 0.5, y: oc.posY != null ? oc.posY : s, w: 0.88 }),
    ], capFromOld),
    basePreset('overlap', 'Cam over gameplay', '3:4', [
      L('gameplay', { rect: { x: 0, y: 0.27, w: 1, h: 0.73 }, view: view0() }),
      L('facecam', { rect: { x: 0, y: 0, w: 1, h: 0.36 }, view: view0() }),
      L('chat', { on: false, rect: { x: 0.03, y: 0.62, w: 0.36, h: 0.34 } }),
      L('captions', { on: capsOn, x: 0.5, y: 0.6, w: 0.88 }),
    ], capFromOld),
    basePreset('bubble', 'Full gameplay + cam', '3:4', [
      L('gameplay', { rect: { x: 0, y: 0, w: 1, h: 1 }, view: view0() }),
      L('facecam', { rect: { x: 0.04, y: 0.03, w: 0.46, h: 0.26 }, view: view0() }),
      L('chat', { on: false, rect: { x: 0.6, y: 0.05, w: 0.36, h: 0.3 } }),
      L('captions', { on: capsOn, x: 0.5, y: 0.68, w: 0.88 }),
    ], { ...capFromOld, words: 2 }),
    basePreset('focus', 'Big cam', '3:4', [
      L('gameplay', { rect: { x: 0, y: 0.55, w: 1, h: 0.45 }, view: view0() }),
      L('facecam', { rect: { x: 0, y: 0, w: 1, h: 0.55 }, view: view0() }),
      L('chat', { on: false, rect: { x: 0.03, y: 0.62, w: 0.36, h: 0.34 } }),
      L('captions', { on: capsOn, x: 0.5, y: 0.55, w: 0.88 }),
    ], capFromOld),
    basePreset('shorts', 'Shorts split', '9:16', [
      L('gameplay', { rect: { x: 0, y: 0.4, w: 1, h: 0.6 }, view: view0() }),
      L('facecam', { rect: { x: 0, y: 0, w: 1, h: 0.4 }, view: view0() }),
      L('chat', { on: false, rect: { x: 0.04, y: 0.6, w: 0.44, h: 0.26 } }),
      L('captions', { on: capsOn, x: 0.5, y: 0.4, w: 0.9 }),
    ], { ...capFromOld, size: 80 }),
  ];
}

const LAYER_TYPES = ['gameplay', 'facecam', 'chat', 'captions'];

/** Fill in anything missing (older / hand-edited presets) so the rest of the code can rely on the shape. */
export function normalizePreset(p) {
  const base = builtInPresets()[0];
  const out = { ...clone(base), ...clone(p || {}) };
  out.ratio = RATIOS[out.ratio] ? out.ratio : '3:4';
  out.quality = QUALITIES[out.quality] ? out.quality : 'hd';
  const have = new Map((Array.isArray(out.layers) ? out.layers : []).filter((l) => l && LAYER_TYPES.includes(l.type)).map((l) => [l.type, l]));
  const layers = (Array.isArray(out.layers) ? out.layers : []).filter((l) => l && have.get(l.type) === l);
  for (const t of LAYER_TYPES) if (!have.has(t)) layers.splice(t === 'captions' ? layers.length : 0, 0, clone(base.layers.find((l) => l.type === t)));
  out.layers = layers.map((l) => {
    const d = base.layers.find((b) => b.type === l.type);
    const x = { ...clone(d), ...l, id: l.type };
    if (x.rect) x.rect = { ...d.rect, ...x.rect };
    if (l.type === 'gameplay' || l.type === 'facecam') x.view = { ...view0(), ...(l.view || {}) };
    if (l.type === 'facecam') x.edge = { ...DEFAULT_EDGE, ...(l.edge || {}) };
    return x;
  });
  const c = { ...clone(DEFAULT_CAPTIONS), ...(out.captions || {}) };
  if (c.mode !== 'editable') c.mode = 'overlay';
  c.active = { ...DEFAULT_CAPTIONS.active, ...(c.active || {}) };
  c.anim = { ...DEFAULT_CAPTIONS.anim, ...(c.anim || {}) };
  c.effects = (Array.isArray(c.effects) ? c.effects : []).filter((e) => e && EFFECTS[e.type]).map((e) => ({ ...EFFECTS[e.type].defaults, on: true, ...e, id: e.id || uid('e') }));
  out.captions = c;
  return out;
}

export const layerOf = (preset, type) => preset.layers.find((l) => l.type === type);

// ---------------------------------------------------------------- geometry

/**
 * Visible window of a source for a target aspect: the largest window of that aspect inside `box`, zoomed in by
 * view.zoom and centered at view.cx/cy (relative to the box), kept inside the box. All in source pixels.
 */
export function coverWindow(box, aspect, view = {}) {
  const zoom = Math.max(1, Number(view.zoom) || 1);
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  w /= zoom;
  h /= zoom;
  const cx = box.x + (view.cx == null ? 0.5 : view.cx) * box.w;
  const cy = box.y + (view.cy == null ? 0.5 : view.cy) * box.h;
  return { x: clamp(cx - w / 2, box.x, box.x + box.w - w), y: clamp(cy - h / 2, box.y, box.y + box.h - h), w, h };
}

/** Window center back to view.cx/cy (used when the user pans the content). */
export function viewFromWindow(box, win, zoom) {
  return { zoom, cx: (win.x + win.w / 2 - box.x) / box.w, cy: (win.y + win.h / 2 - box.y) / box.h };
}

/**
 * Where every visible layer lands in the W×H frame and which part of its media it shows.
 * media = { gameplay: {w, h, box?}, facecam: {w, h, box?}, chat: {w, h} } — box is a normalized region of the media
 * (the facecam box inside the stream; omitted = whole frame).
 * Returns layers bottom-first: {type, dst:{x,y,w,h}, src:{x,y,w,h}|null (media px), mw, mh} and captions {type, x, y, w}.
 */
export function resolveLayers(preset, media = {}) {
  const [W, H] = presetSize(preset);
  const out = [];
  for (const l of preset.layers) {
    if (!l.on) continue;
    if (l.type === 'captions') {
      out.push({ type: 'captions', x: l.x * W, y: l.y * H, w: l.w * W });
      continue;
    }
    const dst = { x: l.rect.x * W, y: l.rect.y * H, w: l.rect.w * W, h: l.rect.h * H };
    if (dst.w < 2 || dst.h < 2) continue;
    const m = media[l.type];
    if (!m || !m.w || !m.h) {
      out.push({ type: l.type, dst, src: null });
      continue;
    }
    if (l.type === 'chat') {
      // the chat video keeps its proportions: fit into the box, bottom-left (messages grow from the bottom)
      const s = Math.min(dst.w / m.w, dst.h / m.h);
      out.push({ type: 'chat', dst: { x: dst.x, y: dst.y + dst.h - m.h * s, w: m.w * s, h: m.h * s }, src: { x: 0, y: 0, w: m.w, h: m.h }, mw: m.w, mh: m.h });
      continue;
    }
    const b = m.box || { x: 0, y: 0, w: 1, h: 1 };
    const box = { x: b.x * m.w, y: b.y * m.h, w: b.w * m.w, h: b.h * m.h };
    out.push({ type: l.type, dst, src: coverWindow(box, dst.w / dst.h, l.view), box, mw: m.w, mh: m.h });
  }
  return out;
}

/** Chat render size that maps 1:1 onto the preset's chat box (even numbers for the encoder). */
export function chatSizeFor(preset) {
  const l = layerOf(preset, 'chat');
  if (!l || !l.on) return null;
  const [W, H] = presetSize(preset);
  const even = (v) => Math.max(120, Math.round(v / 2) * 2);
  return { width: even(l.rect.w * W), height: even(l.rect.h * H), scale: H / 1920 };
}

/** Which edge of the facecam box gets the line / shadow / glow (the one inside the frame, bottom first). */
export function edgeSide(rect) {
  if (rect.y + rect.h < 0.995) return 'bottom';
  if (rect.y > 0.005) return 'top';
  return null;
}

// ---------------------------------------------------------------- sharing presets

/** Preset without ids/flags that only matter locally (for share codes and files). */
export function shareable(p) {
  const { id, builtIn, ...rest } = normalizePreset(p); // eslint-disable-line no-unused-vars
  return { v: 1, app: 'vodslice', preset: rest };
}
/** Accepts the object from shareable() (or a bare preset) and returns a new local preset. */
export function fromShared(obj, name) {
  const raw = obj && obj.preset ? obj.preset : obj;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) throw new Error('This is not a Vodslice preset');
  const p = normalizePreset(raw);
  return { ...p, id: uid('p'), builtIn: false, name: (name || p.name || 'Imported').slice(0, 60) };
}

// ---------------------------------------------------------------- caption chunks + animation state

/**
 * Words -> short captions. words: [{w, start, end}] ; o: {words (max), maxChars, maxDur, pause, offsetMs}.
 * Returns [{start, end, words: [{w, start, end, idx}]}] with small gaps closed.
 */
export function chunkWords(words, o = {}) {
  const maxWords = Math.max(1, o.words || o.maxWords || 3);
  const maxChars = o.maxChars || 18;
  const maxDur = o.maxDur || 1.5;
  const pause = o.pause == null ? 0.3 : o.pause;
  const off = (o.offsetMs || 0) / 1000;
  const out = [];
  let cur = null;
  (words || []).forEach((w0, idx) => {
    const text = String(w0.w || '').trim();
    if (!text) return;
    const w = { w: text, idx, start: Math.max(0, w0.start + off), end: Math.max(0, w0.end + off) };
    if (cur) {
      const last = cur.words.at(-1);
      const chars = cur.words.reduce((a, x) => a + x.w.length, 0) + cur.words.length - 1;
      if (cur.words.length >= maxWords || chars + 1 + text.length > maxChars || w.start - last.end > pause || w.end - cur.start > maxDur || /[.!?…]$/.test(last.w)) {
        out.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(w);
    cur.end = w.end;
  });
  if (cur) out.push(cur);
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    if (next && next.start - c.end < 0.25) c.end = next.start;
    if (c.end - c.start < 0.3) c.end = next ? Math.min(next.start, c.start + 0.3) : c.start + 0.3;
  }
  return out;
}

/** Sample words with a natural rhythm for previews without a transcript (loops). */
export function sampleWords(text, t0 = 0.3) {
  const out = [];
  let t = t0;
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    const d = 0.18 + Math.min(0.42, w.length * 0.045);
    out.push({ w, start: t, end: t + d });
    t += d + 0.06 + (/[.!?,]$/.test(w) ? 0.45 : 0);
  }
  return out;
}

export function captionText(word, cap) {
  let s = String(word);
  if (!cap.punct) s = s.replace(/^[„“"'«(]+|[,.;:…"'»“”)]+$/g, '').replace(/[,;:]$/, '');
  if (cap.caps === 'upper') s = s.toLocaleUpperCase('de-DE');
  else if (cap.caps === 'lower') s = s.toLocaleLowerCase('de-DE');
  return s || String(word);
}

const IN_DUR = { none: 0, fade: 0.16, pop: 0.24, bounce: 0.42, rise: 0.26, slide: 0.26, zoom: 0.24, blur: 0.24 };
const OUT_DUR = { none: 0, fade: 0.16, sink: 0.2, shrink: 0.18, blur: 0.2 };
export const inDuration = (cap) => (IN_DUR[cap.anim.in] || 0) / (cap.anim.speed || 1);
export const outDuration = (cap) => (OUT_DUR[cap.anim.out] || 0) / (cap.anim.speed || 1);

const easeOut = (p) => 1 - (1 - p) ** 3;
const backOut = (p, s = 2.2) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
function bounceOut(p) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/** Transform of an animation at progress p (0..1). Offsets and blur are in em. */
export function animIn(type, p) {
  p = clamp(p, 0, 1);
  switch (type) {
    case 'fade': return { a: easeOut(p), s: 1, dx: 0, dy: 0, b: 0 };
    case 'pop': return { a: Math.min(1, p * 4), s: 0.45 + 0.55 * backOut(p), dx: 0, dy: 0, b: 0 };
    case 'bounce': return { a: Math.min(1, p * 5), s: 1, dx: 0, dy: -0.7 * (1 - bounceOut(p)), b: 0 };
    case 'rise': return { a: easeOut(p), s: 1, dx: 0, dy: 0.45 * (1 - easeOut(p)), b: 0 };
    case 'slide': return { a: easeOut(p), s: 1, dx: -0.6 * (1 - easeOut(p)), dy: 0, b: 0 };
    case 'zoom': return { a: easeOut(p), s: 1.7 - 0.7 * easeOut(p), dx: 0, dy: 0, b: 0 };
    case 'blur': return { a: easeOut(p), s: 1.06 - 0.06 * p, dx: 0, dy: 0, b: 0.22 * (1 - p) };
    default: return { a: 1, s: 1, dx: 0, dy: 0, b: 0 };
  }
}
export function animOut(type, p) {
  p = clamp(p, 0, 1);
  switch (type) {
    case 'fade': return { a: 1 - p, s: 1, dx: 0, dy: 0, b: 0 };
    case 'sink': return { a: 1 - p, s: 1, dx: 0, dy: 0.4 * p * p, b: 0 };
    case 'shrink': return { a: 1 - p, s: 1 - 0.45 * p, dx: 0, dy: 0, b: 0 };
    case 'blur': return { a: 1 - p, s: 1, dx: 0, dy: 0, b: 0.22 * p };
    default: return { a: 1, s: 1, dx: 0, dy: 0, b: 0 };
  }
}
const mul = (a, b) => ({ a: a.a * b.a, s: a.s * b.s, dx: a.dx + b.dx, dy: a.dy + b.dy, b: a.b + b.b });
const ID = { a: 1, s: 1, dx: 0, dy: 0, b: 0 };

/**
 * What is on screen at time t: the visible caption, a transform for the whole caption (group) and one per word.
 * `key` is identical for identical frames (static moments) so the exporter can skip duplicate images.
 */
export function captionState(chunks, t, cap) {
  const inD = inDuration(cap);
  const outD = outDuration(cap);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const next = chunks[i + 1];
    // the out animation only plays when the caption is followed by a pause
    const hasOut = outD > 0 && (!next || next.start - c.end > 0.001);
    const until = hasOut ? c.end + Math.min(outD, next ? next.start - c.end : outD) : c.end;
    if (t < c.start || t >= until) continue;
    let animating = false;
    let group = ID;
    if (t >= c.end) {
      group = animOut(cap.anim.out, (t - c.end) / outD);
      animating = true;
    }
    let active = -1;
    for (let k = 0; k < c.words.length; k++) {
      const ws = k === 0 ? c.start : c.words[k].start;
      const we = k + 1 < c.words.length ? c.words[k + 1].start : c.end;
      if (t >= ws && t < we) active = k;
    }
    let revealed = c.words.length;
    const words = c.words.map((w, k) => {
      if (cap.anim.mode === 'word') {
        const ws = k === 0 ? c.start : w.start;
        if (t < ws) {
          revealed = Math.min(revealed, k);
          return { visible: false, tf: ID };
        }
        if (inD > 0 && t < ws + inD) {
          animating = true;
          return { visible: true, tf: animIn(cap.anim.in, (t - ws) / inD) };
        }
        return { visible: true, tf: ID };
      }
      return { visible: true, tf: ID };
    });
    if (cap.anim.mode !== 'word' && inD > 0 && t < c.start + inD) {
      group = mul(group, animIn(cap.anim.in, (t - c.start) / inD));
      animating = true;
    }
    const key = animating ? null : `${i}:${revealed}:${t >= c.end ? -1 : active}`;
    return { index: i, chunk: c, group, words, active: t >= c.end ? -1 : active, animating, key };
  }
  return { index: -1, chunk: null, key: 'empty' };
}

/** Largest extra room (px at 1920 high) the effects + animations need around the text. */
export function effectMargin(cap) {
  let m = 0;
  for (const e of cap.effects || []) {
    if (!e.on) continue;
    if (e.type === 'stroke') m = Math.max(m, e.width);
    if (e.type === 'shadow') m = Math.max(m, e.blur * 2 + e.distance);
    if (e.type === 'glow') m = Math.max(m, e.radius * 1.6);
    if (e.type === 'box') m = Math.max(m, e.pad * cap.size + 4);
    if (e.type === 'extrude') m = Math.max(m, e.depth + 4);
  }
  return m + cap.size * 0.8;
}
