import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, Seg, Toggle, Popover, Spinner } from '../ui.jsx';
import { useMenu } from '../ContextMenu.jsx';
import { frameSize, chunkWords, sampleWords, resolveLayers, coverWindow, viewFromWindow, newEffect, EFFECTS, uid, builtInPresets, normalizePreset } from '../../../electron/layout.mjs';
import { drawComposition } from '../../lib/compose.js';
import { fmt } from '../../lib/time.js';
import Inspector from './Inspector.jsx';
import { presetsOf, savePresets, clipSources } from './presetStore.js';

export const LAYER_META = {
  gameplay: { label: 'Gameplay', icon: 'film', color: '#3ddc84' },
  facecam: { label: 'Facecam', icon: 'user', color: '#39c6ff' },
  chat: { label: 'Chat', icon: 'chat', color: '#ff9f43' },
  captions: { label: 'Captions', icon: 'type', color: '#d4ff3f' },
};
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
// areas the platform UI covers (fractions of a 9:16 frame): right action column, bottom text, top bar
const SAFE = {
  tiktok: [
    { x: 0.84, y: 0.4, w: 0.16, h: 0.46, label: 'Buttons' },
    { x: 0, y: 0.8, w: 0.82, h: 0.2, label: 'Caption + sound' },
    { x: 0, y: 0, w: 1, h: 0.08, label: 'Tabs' },
  ],
  shorts: [
    { x: 0.85, y: 0.5, w: 0.15, h: 0.4, label: 'Buttons' },
    { x: 0, y: 0.82, w: 0.84, h: 0.18, label: 'Title + channel' },
    { x: 0, y: 0, w: 1, h: 0.07, label: 'Search' },
  ],
  reels: [
    { x: 0.85, y: 0.5, w: 0.15, h: 0.38, label: 'Buttons' },
    { x: 0, y: 0.8, w: 0.82, h: 0.2, label: 'Caption + audio' },
    { x: 0, y: 0, w: 1, h: 0.07, label: 'Header' },
  ],
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/** Small live thumbnail of a preset (current video frame + its layout). */
function PresetThumb({ preset, mediaRef, chunksRef, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const [W] = frameSize(preset.ratio);
      const ch = chunksRef.current || [];
      const mid = ch[1] || ch[0];
      drawComposition(c.getContext('2d'), { preset, k: c.width / W, media: mediaRef.current ? mediaRef.current() : {}, chunks: ch, t: mid ? (mid.start + mid.end) / 2 : 0, noFacecam: '' });
    };
    draw();
    if (!active) return;
    const id = setInterval(draw, 1500);
    return () => clearInterval(id);
  }, [preset, active, mediaRef, chunksRef]);
  const [W, H] = frameSize(preset.ratio);
  const h = 84;
  const w = Math.round((h * W) / H);
  return <canvas ref={ref} width={w * 2} height={h * 2} style={{ width: w, height: h }} />;
}

/**
 * The Premiere tab: design the vertical video once (layout + captions), save it as presets.
 * Every Premiere sequence is built from the active preset — the canvas here is drawn with the same code.
 */
export default function Studio({ settings, active, getLive, jobs, history, toast, modalOpen, onGoEdit, openClip }) {
  const openMenu = useMenu();
  const [presets, setPresets] = useState(() => presetsOf(settings));
  const [activeId, setActiveId] = useState(() => settings.studio.active || 'split');
  const [sel, setSel] = useState('captions');
  const [framing, setFraming] = useState(false);
  const [source, setSource] = useState('live');
  const [clipWords, setClipWords] = useState(null);
  const [tab, setTab] = useState('look');
  const [guides, setGuides] = useState([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [clock, setClock] = useState({ t: 0, d: 0, playing: false });
  const [building, setBuilding] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [fontPreview, setFontPreview] = useState(null);
  const [dropHint, setDropHint] = useState(false);

  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const undoS = useRef([]);
  const redoS = useRef([]);
  const gesture = useRef(null);
  const dirty = useRef(false);
  const saveT = useRef(0);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const gpVid = useRef(null);
  const fcVid = useRef(null);

  // outside changes (export panel, caption editor) are adopted while nothing is pending here
  useEffect(() => {
    if (dirty.current) return;
    const ext = presetsOf(settings);
    if (JSON.stringify(ext) !== JSON.stringify(presetsRef.current)) setPresets(ext);
    if (settings.studio.active && settings.studio.active !== activeId) setActiveId(settings.studio.active);
  }, [settings.studio]); // eslint-disable-line

  const preset = presets.find((p) => p.id === activeId) || presets[0];
  const [W, H] = frameSize(preset.ratio);

  // ---------- edits, undo ----------
  const persist = (list) => {
    dirty.current = true;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => savePresets(list).finally(() => (dirty.current = false)), 250);
  };
  const setList = (list, record) => {
    if (record) {
      undoS.current.push(presetsRef.current);
      if (undoS.current.length > 100) undoS.current.shift();
      redoS.current = [];
    }
    presetsRef.current = list;
    setPresets(list);
    persist(list);
  };
  /** fn gets a deep copy of the active preset and returns the new one. record=false while dragging. */
  const patch = useCallback(
    (fn, record = true) => {
      const cur = presetsRef.current;
      const a = cur.find((p) => p.id === activeId) || cur[0];
      const next = fn(JSON.parse(JSON.stringify(a))) || a;
      setList(
        cur.map((p) => (p.id === a.id ? next : p)),
        record && !gesture.current
      );
    },
    [activeId] // eslint-disable-line
  );
  const begin = useCallback(() => {
    gesture.current = presetsRef.current;
  }, []);
  const end = useCallback(() => {
    if (gesture.current && gesture.current !== presetsRef.current) {
      undoS.current.push(gesture.current);
      redoS.current = [];
    }
    gesture.current = null;
  }, []);
  const undo = () => {
    const prev = undoS.current.pop();
    if (!prev) return;
    redoS.current.push(presetsRef.current);
    presetsRef.current = prev;
    setPresets(prev);
    persist(prev);
  };
  const redo = () => {
    const next = redoS.current.pop();
    if (!next) return;
    undoS.current.push(presetsRef.current);
    presetsRef.current = next;
    setPresets(next);
    persist(next);
  };
  const activate = (id) => {
    setActiveId(id);
    window.api.setSettings({ studio: { active: id } });
  };
  const layer = (type) => preset.layers.find((l) => l.type === type);
  const patchLayer = (type, fn, record) =>
    patch((p) => {
      const l = p.layers.find((x) => x.type === type);
      if (l) fn(l, p);
      return p;
    }, record);

  // ---------- presets ----------
  const duplicate = (src = preset) => {
    const copy = { ...JSON.parse(JSON.stringify(src)), id: uid('p'), name: `${src.name} copy`, builtIn: false };
    setList([...presetsRef.current, copy], true);
    activate(copy.id);
    setRenaming({ id: copy.id, name: copy.name });
  };
  const removePreset = (p) => {
    if (presetsRef.current.length <= 1) return toast('Keep at least one preset', 'warn');
    const list = presetsRef.current.filter((x) => x.id !== p.id);
    setList(list, true);
    if (p.id === activeId) activate(list[0].id);
  };
  const resetPreset = (p) => {
    const orig = builtInPresets(settings.premiere).find((b) => b.id === p.id);
    if (!orig) return;
    setList(
      presetsRef.current.map((x) => (x.id === p.id ? normalizePreset(orig) : x)),
      true
    );
  };
  const rename = (id, name) => {
    const n = (name || '').trim();
    if (n) setList(presetsRef.current.map((x) => (x.id === id ? { ...x, name: n } : x)), true);
    setRenaming(null);
  };
  const presetMenu = (e, p) =>
    openMenu(e, [
      { label: 'Rename', icon: 'edit', onClick: () => setRenaming({ id: p.id, name: p.name }) },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(p) },
      p.builtIn ? { label: 'Reset to original', icon: 'refresh', onClick: () => resetPreset(p) } : null,
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => removePreset(p) },
    ]);

  // ---------- media ----------
  const clips = useMemo(() => clipSources(jobs, history, settings), [jobs, history, settings.output]); // eslint-disable-line
  const clip = source !== 'live' ? clips.find((c) => c.key === source) || null : null;
  useEffect(() => {
    if (openClip && openClip.key) setSource(openClip.key);
  }, [openClip && openClip.n]); // eslint-disable-line
  const clipRef = useRef(clip);
  clipRef.current = clip;
  useEffect(() => {
    setClipWords(null);
    if (!clip || !clip.words) return;
    let alive = true;
    window.api.premiereWords(clip.words).then((d) => alive && setClipWords(d && d.words ? d.words : []));
    return () => {
      alive = false;
    };
  }, [clip && clip.key, clip && clip.words]); // eslint-disable-line

  const mediaNow = useCallback(() => {
    const c = clipRef.current;
    if (c) return { gameplay: gpVid.current ? { el: gpVid.current } : null, facecam: c.facecam && fcVid.current ? { el: fcVid.current } : null };
    const live = getLive && getLive();
    if (!live || !live.video) return {};
    return { gameplay: { el: live.video }, facecam: live.facecamRect ? { el: live.video, box: live.facecamRect } : null };
  }, [getLive]);
  const mediaRef = useRef(mediaNow);
  mediaRef.current = mediaNow;

  // ---------- captions to show ----------
  const cap = fontPreview ? { ...preset.captions, ...fontPreview } : preset.captions;
  const realWords = clip && clipWords && clipWords.length ? clipWords : null;
  const chunks = useMemo(
    () => chunkWords(realWords || sampleWords(settings.studio.sample || 'this is how your captions will look'), { words: cap.words, maxChars: cap.maxChars, offsetMs: realWords ? settings.premiere.captions.offsetMs : 0 }),
    [realWords, settings.studio.sample, cap.words, cap.maxChars, settings.premiere.captions.offsetMs]
  );
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const view = useMemo(() => ({ ...preset, captions: cap }), [preset, cap]);

  // ---------- stage size ----------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const kd = box.w ? Math.max(0.05, Math.min((box.w - 48) / W, (box.h - 40) / H)) : 0.3;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.round(W * kd);
  const cssH = Math.round(H * kd);

  // ---------- draw loop ----------
  const drawState = useRef({});
  drawState.current = { view, chunks, framing, sel, realWords: !!realWords };
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = canvasRef.current;
      if (!c) return;
      const d = drawState.current;
      const [FW] = frameSize(d.view.ratio);
      const k = c.width / FW;
      const ctx = c.getContext('2d');
      const media = mediaRef.current();
      const ch = d.chunks;
      const loopLen = ch.length ? ch.at(-1).end + 1.4 : 3;
      const t = d.realWords && gpVid.current ? gpVid.current.currentTime : (performance.now() / 1000) % loopLen;
      const r = drawComposition(ctx, { preset: d.view, k, media, chunks: ch, t, chatFont: settingsRef.current.chat.fontSize, noFacecam: clipRef.current ? 'No facecam file' : 'Draw the facecam box in Edit' });
      // framing: show the whole source around the window, dimmed
      if (d.framing && (d.sel === 'gameplay' || d.sel === 'facecam')) {
        const l = r.layers.find((x) => x.type === d.sel);
        const m = media[d.sel];
        if (l && l.src && m && m.el) {
          const s = l.dst.w / l.src.w;
          const g = { x: l.dst.x - (l.src.x - l.box.x) * s, y: l.dst.y - (l.src.y - l.box.y) * s, w: l.box.w * s, h: l.box.h * s };
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.drawImage(m.el, l.box.x, l.box.y, l.box.w, l.box.h, g.x * k, g.y * k, g.w * k, g.h * k);
          ctx.globalAlpha = 1;
          ctx.drawImage(m.el, l.src.x, l.src.y, l.src.w, l.src.h, l.dst.x * k, l.dst.y * k, l.dst.w * k, l.dst.h * k);
          ctx.restore();
        }
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // ---------- transport ----------
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const c = clipRef.current;
      if (c && gpVid.current) {
        const g = gpVid.current;
        const f = fcVid.current;
        if (f && Math.abs(f.currentTime - g.currentTime) > 0.12) f.currentTime = g.currentTime;
        if (f && f.paused !== g.paused) g.paused ? f.pause() : f.play().catch(() => {});
        setClock({ t: g.currentTime, d: g.duration || 0, playing: !g.paused });
      } else {
        const live = getLive && getLive();
        setClock(live ? { t: live.time || 0, d: live.duration || 0, playing: !!live.playing } : { t: 0, d: 0, playing: false });
      }
    }, 200);
    return () => clearInterval(id);
  }, [active, getLive]);
  useEffect(() => {
    // leaving the tab pauses the clip preview
    if (!active && gpVid.current) gpVid.current.pause();
  }, [active]);
  const togglePlay = () => {
    if (clipRef.current && gpVid.current) {
      const g = gpVid.current;
      if (g.paused) g.play().catch(() => {});
      else g.pause();
      return;
    }
    const live = getLive && getLive();
    if (live && live.toggle) live.toggle();
  };
  const seek = (t) => {
    if (clipRef.current && gpVid.current) {
      gpVid.current.currentTime = t;
      if (fcVid.current) fcVid.current.currentTime = t;
    } else {
      const live = getLive && getLive();
      if (live && live.seek) live.seek(t);
    }
    setClock((c) => ({ ...c, t }));
  };

  // ---------- geometry for the overlay ----------
  const dims = (() => {
    const m = mediaNow();
    const out = {};
    for (const key of ['gameplay', 'facecam']) if (m[key] && m[key].el && m[key].el.videoWidth) out[key] = { w: m[key].el.videoWidth, h: m[key].el.videoHeight, box: m[key].box || null };
    return out;
  })();
  const geo = resolveLayers(view, dims);
  const capH = (l) => Math.max(40, cap.size * (cap.lineHeight || 1.08) * (cap.words > 2 ? 1.9 : 1.25));

  const snapTargets = (exclude) => {
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const l of preset.layers) {
      if (!l.on || l.type === exclude) continue;
      if (l.rect) {
        xs.push(l.rect.x * W, (l.rect.x + l.rect.w) * W, (l.rect.x + l.rect.w / 2) * W);
        ys.push(l.rect.y * H, (l.rect.y + l.rect.h) * H, (l.rect.y + l.rect.h / 2) * H);
      } else if (l.type === 'captions') ys.push(l.y * H);
    }
    return { xs, ys };
  };
  /** Best snap of any of `vals` onto `cands` (frame px); returns {d, at} or null. */
  const snap = (vals, cands, thr) => {
    let best = null;
    for (const v of vals)
      for (const c of cands) {
        const d = c - v;
        if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c };
      }
    return best;
  };

  const startGesture = (e, type, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(type);
    const l0 = JSON.parse(JSON.stringify(layer(type)));
    const g0 = geo.find((x) => x.type === type);
    const sx = e.clientX;
    const sy = e.clientY;
    const thr = 7 / kd;
    const T = snapTargets(type);
    begin();
    const move = (ev) => {
      const dx = (ev.clientX - sx) / kd;
      const dy = (ev.clientY - sy) / kd;
      const free = ev.altKey;
      const gl = [];
      if (type === 'captions') {
        if (mode === 'move') {
          let cx = l0.x * W + dx;
          let cy = l0.y * H + dy;
          if (!free) {
            const a = snap([cx], [W / 2], thr);
            if (a) (cx += a.d), gl.push({ x: a.at });
            const b = snap([cy], T.ys, thr);
            if (b) (cy += b.d), gl.push({ y: b.at });
          }
          patchLayer('captions', (l) => ((l.x = clamp(cx / W, 0, 1)), (l.y = clamp(cy / H, 0, 1))), false);
        } else if (mode === 'e' || mode === 'w') {
          const half = Math.max(60, l0.w * W * 0.5 + (mode === 'e' ? dx : -dx));
          patchLayer('captions', (l) => (l.w = clamp((half * 2) / W, 0.1, 1.2)), false);
        } else {
          const sign = mode.includes('n') ? -1 : 1;
          const size = clamp(l0.size0 * (1 + (sign * dy * 2) / capH()), 24, 320);
          patch((p) => ((p.captions.size = Math.round(size)), p), false);
        }
      } else if (framing && (type === 'gameplay' || type === 'facecam') && g0 && g0.src) {
        const s = g0.dst.w / g0.src.w;
        const v0 = l0.view || { zoom: 1, cx: 0.5, cy: 0.5 };
        if (mode === 'move') {
          const win = { ...g0.src, x: g0.src.x - dx / s, y: g0.src.y - dy / s };
          const fixed = coverWindow(g0.box, g0.dst.w / g0.dst.h, viewFromWindow(g0.box, win, v0.zoom));
          const v = viewFromWindow(g0.box, fixed, v0.zoom);
          patchLayer(type, (l) => (l.view = v), false);
        } else {
          const cxs = (g0.dst.x + g0.dst.w / 2) * kd;
          const cys = (g0.dst.y + g0.dst.h / 2) * kd;
          const r = stageRef.current.querySelector('.st-overlay').getBoundingClientRect();
          const d0 = Math.hypot(sx - r.left - cxs, sy - r.top - cys) || 1;
          const d1 = Math.hypot(ev.clientX - r.left - cxs, ev.clientY - r.top - cys);
          patchLayer(type, (l) => (l.view = { ...v0, zoom: clamp(v0.zoom * (d1 / d0), 1, 6) }), false);
        }
      } else {
        const R = { x: l0.rect.x * W, y: l0.rect.y * H, w: l0.rect.w * W, h: l0.rect.h * H };
        let { x, y, w, h } = R;
        if (mode === 'move') {
          x += dx;
          y += dy;
          if (!free) {
            const a = snap([x, x + w / 2, x + w], T.xs, thr);
            if (a) (x += a.d), gl.push({ x: a.at });
            const b = snap([y, y + h / 2, y + h], T.ys, thr);
            if (b) (y += b.d), gl.push({ y: b.at });
          }
        } else {
          let x2 = x + w;
          let y2 = y + h;
          if (mode.includes('w')) x += dx;
          if (mode.includes('e')) x2 += dx;
          if (mode.includes('n')) y += dy;
          if (mode.includes('s')) y2 += dy;
          if (!free) {
            const sx2 = (v, set) => {
              const a = snap([v], T.xs, thr);
              if (a) gl.push({ x: a.at });
              return a ? set(v + a.d) : v;
            };
            const sy2 = (v, set) => {
              const a = snap([v], T.ys, thr);
              if (a) gl.push({ y: a.at });
              return a ? set(v + a.d) : v;
            };
            if (mode.includes('w')) x = sx2(x, (v) => v);
            if (mode.includes('e')) x2 = sx2(x2, (v) => v);
            if (mode.includes('n')) y = sy2(y, (v) => v);
            if (mode.includes('s')) y2 = sy2(y2, (v) => v);
          }
          w = Math.max(40, x2 - x);
          h = Math.max(40, y2 - y);
          if (ev.shiftKey && mode.length === 2) {
            const a = R.w / R.h;
            if (w / h > a) w = h * a;
            else h = w / a;
            if (mode.includes('w')) x = R.x + R.w - w;
            if (mode.includes('n')) y = R.y + R.h - h;
          }
        }
        patchLayer(type, (l) => (l.rect = { x: x / W, y: y / H, w: w / W, h: h / H }), false);
      }
      setGuides(gl);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
      end();
    };
    if (type === 'captions') l0.size0 = preset.captions.size;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (modalOpen || isTyping(document.activeElement)) return;
      const k = e.key;
      if (e.ctrlKey && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (e.ctrlKey && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        return redo();
      }
      if (e.ctrlKey || e.altKey) return;
      if (k === ' ' || k === 'k' || k === 'K') {
        e.preventDefault();
        return togglePlay();
      }
      if (k === 'Escape') return framing ? setFraming(false) : setSel(null);
      if (k === 'Enter' && (sel === 'gameplay' || sel === 'facecam')) return setFraming((f) => !f);
      if (k === 'Tab') {
        e.preventDefault();
        const order = [...preset.layers].reverse().filter((l) => l.on).map((l) => l.type);
        const i = order.indexOf(sel);
        setSel(order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length] || null);
        setFraming(false);
        return;
      }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[k] && sel) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [ax, ay] = arrows[k];
        patchLayer(sel, (l) => {
          if (l.rect) l.rect = { ...l.rect, x: l.rect.x + (ax * step) / W, y: l.rect.y + (ay * step) / H };
          else {
            l.x = clamp(l.x + (ax * step) / W, 0, 1);
            l.y = clamp(l.y + (ay * step) / H, 0, 1);
          }
        });
      }
      if ((k === 'Delete' || k === 'Backspace') && sel) patchLayer(sel, (l) => (l.on = false));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- effects dropped from the library ----------
  const addEffect = (type) => {
    patch((p) => {
      const e = newEffect(type);
      if (type === 'stroke') p.captions.effects.unshift(e);
      else p.captions.effects.push(e);
      const l = p.layers.find((x) => x.type === 'captions');
      if (l) l.on = true;
      return p;
    });
    setSel('captions');
    setTab('effects');
  };

  // ---------- rebuild a downloaded clip ----------
  const rebuild = async (open) => {
    if (!clip || building) return;
    setBuilding({ label: 'Preparing', p: 0 });
    const off = window.api.onPremiere((e) => e.dir === clip.dir && setBuilding({ label: e.label, p: e.p }));
    const r = await window.api.premiereBuild({ dir: clip.dir, name: clip.name, prefix: clip.prefix, preset, reuse: true });
    off();
    if (!r.ok) {
      setBuilding(null);
      return toast(`Premiere: ${r.error}`, 'err', 8000);
    }
    if (r.project.files.words && !clip.words) window.api.premiereWords(r.project.files.words).then((d) => setClipWords(d && d.words ? d.words : []));
    if (open) {
      setBuilding({ label: 'Opening in Premiere', p: 1 });
      const res = await window.api.premiereOpen(r.project.files.xml);
      toast(res.ok ? 'Imported into Premiere' : 'Premiere not ready — XML path copied (Ctrl+I → Ctrl+V)', res.ok ? 'ok' : 'warn', 5000);
    } else toast(`Premiere sequence updated · ${preset.name}`, 'ok', 2500);
    setBuilding(null);
  };

  const live = getLive && getLive();
  const liveTitle = live && live.info ? `${live.info.channel} · ${live.info.title}` : 'No video in Edit';
  const safe = settings.studio.safeZone && SAFE[settings.studio.safeZone];
  const zOrder = [...preset.layers].reverse();

  return (
    <div className="studio">
      {/* ---------------- left: presets, layers, effects ---------------- */}
      <aside className="st-left">
        <div className="st-sec">
          <div className="st-h">
            <span>Presets</span>
            <button className="icon-btn xs" title="New preset from the current one" onClick={() => duplicate()}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="st-presets">
            {presets.map((p) => (
              <div
                key={p.id}
                className={`st-preset ${p.id === preset.id ? 'on' : ''}`}
                onClick={() => p.id !== preset.id && activate(p.id)}
                onContextMenu={(e) => presetMenu(e, p)}
                onDoubleClick={() => setRenaming({ id: p.id, name: p.name })}
                title="Double-click to rename · right-click for more"
              >
                <PresetThumb preset={p.id === preset.id ? view : p} mediaRef={mediaRef} chunksRef={chunksRef} active={active} />
                <div className="sp-meta">
                  {renaming && renaming.id === p.id ? (
                    <input
                      className="input sm"
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                      onBlur={() => rename(p.id, renaming.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(p.id, renaming.name);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <b>{p.name}</b>
                  )}
                  <span>
                    {p.ratio} · {frameSize(p.ratio).join('×')}
                  </span>
                  {p.id === preset.id && <em>Used for Premiere</em>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="st-sec">
          <div className="st-h">
            <span>Layers</span>
            <span className="st-hint">top first</span>
          </div>
          <div className="st-layers">
            {zOrder.map((l) => {
              const m = LAYER_META[l.type];
              const i = preset.layers.indexOf(l);
              return (
                <div key={l.type} className={`st-layer ${sel === l.type ? 'on' : ''} ${l.on ? '' : 'off'}`} onClick={() => (setSel(l.type), setFraming(false))}>
                  <button className="icon-btn xs ghost" title={l.on ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), patchLayer(l.type, (x) => (x.on = !x.on)))}>
                    <Icon name={l.on ? 'eye' : 'eyeOff'} size={14} />
                  </button>
                  <span className="sl-dot" style={{ background: m.color }} />
                  <Icon name={m.icon} size={14} />
                  <span className="sl-name">{m.label}</span>
                  <div className="grow" />
                  <button
                    className="icon-btn xs ghost"
                    title="Bring forward"
                    disabled={i === preset.layers.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      patch((p) => {
                        const a = p.layers.splice(i, 1)[0];
                        p.layers.splice(i + 1, 0, a);
                        return p;
                      });
                    }}
                  >
                    <Icon name="arrowUp" size={13} />
                  </button>
                  <button
                    className="icon-btn xs ghost"
                    title="Send backward"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      patch((p) => {
                        const a = p.layers.splice(i, 1)[0];
                        p.layers.splice(i - 1, 0, a);
                        return p;
                      });
                    }}
                  >
                    <Icon name="arrowDown" size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="st-sec">
          <div className="st-h">
            <span>Text effects</span>
            <span className="st-hint">drag onto the video</span>
          </div>
          <div className="st-fxlib">
            {Object.entries(EFFECTS).map(([type, e]) => (
              <button
                key={type}
                className={`fx-chip fx-${type}`}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('text/vs-effect', type);
                  ev.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => addEffect(type)}
                title={`Add ${e.label} to the captions`}
              >
                <span className="fx-swatch" />
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ---------------- center: stage ---------------- */}
      <section className="st-center">
        <div className="st-bar">
          <Popover
            trigger={({ toggle }) => (
              <button className="st-source" onClick={toggle} title="What the preview shows">
                <Icon name={clip ? 'folder' : 'film'} size={14} />
                <span className="ss-k">{clip ? 'Clip' : 'Live'}</span>
                <span className="ss-v">{clip ? `${clip.name}${realWords ? '' : ' · no transcript yet'}` : liveTitle}</span>
                <Icon name="chevronDown" size={12} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="menu tall st-src-menu">
                <button className={`menu-item ${!clip ? 'on' : ''}`} onClick={() => (setSource('live'), close())}>
                  <Icon name="film" size={13} />
                  <span>
                    <b>Live video from Edit</b>
                    <em>{liveTitle} · sample captions</em>
                  </span>
                </button>
                {clips.length > 0 && <div className="menu-sep">Downloaded clips — real files + transcript</div>}
                {clips.map((c) => (
                  <button key={c.key} className={`menu-item ${clip && clip.key === c.key ? 'on' : ''}`} onClick={() => (setSource(c.key), close())}>
                    <Icon name="folder" size={13} />
                    <span>
                      <b>{c.name}</b>
                      <em>
                        {c.title}
                        {c.words ? ' · captions ready' : ''}
                        {c.enhanced ? ' · enhanced cam' : ''}
                      </em>
                    </span>
                  </button>
                ))}
                {!clips.length && <div className="menu-note">Download a clip to preview it here with its real transcript.</div>}
              </div>
            )}
          </Popover>
          <div className="grow" />
          <Seg
            size="sm"
            value={preset.ratio}
            onChange={(r) => patch((p) => ((p.ratio = r), p))}
            title="Sequence format"
            options={[
              { value: '9:16', label: '9:16' },
              { value: '3:4', label: '3:4' },
              { value: '4:5', label: '4:5' },
              { value: '1:1', label: '1:1' },
            ]}
          />
          <Popover
            align="right"
            trigger={({ toggle }) => (
              <button className={`icon-btn sm ${safe ? 'on' : ''}`} onClick={toggle} title="Show where TikTok / Shorts / Reels put their buttons">
                <Icon name="safe" size={15} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="menu">
                {[
                  ['off', 'No safe zones'],
                  ['tiktok', 'TikTok'],
                  ['shorts', 'YouTube Shorts'],
                  ['reels', 'Instagram Reels'],
                ].map(([v, label]) => (
                  <button key={v} className={`menu-item ${(settings.studio.safeZone || 'off') === v ? 'on' : ''}`} onClick={() => (window.api.setSettings({ studio: { safeZone: v } }), close())}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <button className="icon-btn sm" title="Undo (Ctrl+Z)" onClick={undo} disabled={!undoS.current.length}>
            <Icon name="undo" size={15} />
          </button>
          <button className="icon-btn sm" title="Redo (Ctrl+Y)" onClick={redo} disabled={!redoS.current.length}>
            <Icon name="redo" size={15} />
          </button>
        </div>

        <div
          className={`st-stage ${dropHint ? 'drop' : ''}`}
          ref={stageRef}
          onPointerDown={() => (setSel(null), setFraming(false))}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes('text/vs-effect')) {
              e.preventDefault();
              setDropHint(true);
            }
          }}
          onDragLeave={() => setDropHint(false)}
          onDrop={(e) => {
            const t = e.dataTransfer.getData('text/vs-effect');
            setDropHint(false);
            if (t && EFFECTS[t]) {
              e.preventDefault();
              addEffect(t);
              toast(`${EFFECTS[t].label} added to the captions`, 'ok', 1600);
            }
          }}
        >
          <div className="st-frame" style={{ width: cssW, height: cssH }}>
            <canvas ref={canvasRef} width={Math.round(cssW * dpr)} height={Math.round(cssH * dpr)} style={{ width: cssW, height: cssH }} />
            <div className="st-overlay" style={{ width: cssW, height: cssH }}>
              {safe &&
                safe.map((z, i) => (
                  <div key={i} className="st-safe" style={{ left: z.x * cssW, top: z.y * cssH, width: z.w * cssW, height: z.h * cssH }}>
                    <span>{z.label}</span>
                  </div>
                ))}
              {preset.layers.map((l) => {
                if (!l.on) return null;
                const m = LAYER_META[l.type];
                const isSel = sel === l.type;
                let r;
                if (l.type === 'captions') {
                  const h = capH(l);
                  r = { x: (l.x - l.w / 2) * W, y: l.y * H - h / 2, w: l.w * W, h };
                } else r = { x: l.rect.x * W, y: l.rect.y * H, w: l.rect.w * W, h: l.rect.h * H };
                const style = { left: r.x * kd, top: r.y * kd, width: r.w * kd, height: r.h * kd, '--lc': m.color };
                const g = geo.find((x) => x.type === l.type);
                const fr = isSel && framing && g && g.src && (l.type === 'gameplay' || l.type === 'facecam');
                let ghost = null;
                if (fr) {
                  const s = g.dst.w / g.src.w;
                  ghost = { left: (g.dst.x - (g.src.x - g.box.x) * s) * kd, top: (g.dst.y - (g.src.y - g.box.y) * s) * kd, width: g.box.w * s * kd, height: g.box.h * s * kd };
                }
                return (
                  <div key={l.type} className={`lbox lbox-${l.type} ${isSel ? 'sel' : ''} ${fr ? 'framing' : ''}`} style={style} onPointerDown={(e) => startGesture(e, l.type, 'move')} onDoubleClick={() => (l.type === 'gameplay' || l.type === 'facecam') && setFraming((f) => !f)}>
                    <span className="lbox-tag">
                      <Icon name={m.icon} size={11} /> {m.label}
                      {fr ? ' · drag to frame' : ''}
                    </span>
                    {isSel && !fr && (l.type === 'captions' ? ['nw', 'ne', 'e', 'se', 'sw', 'w'] : HANDLES).map((h) => <span key={h} className={`hdl hdl-${h}`} onPointerDown={(e) => startGesture(e, l.type, h)} />)}
                    {ghost && (
                      <div className="frame-ghost" style={{ left: ghost.left - style.left, top: ghost.top - style.top, width: ghost.width, height: ghost.height }}>
                        {['nw', 'ne', 'se', 'sw'].map((h) => (
                          <span key={h} className={`hdl zoom hdl-${h}`} title="Drag to zoom" onPointerDown={(e) => startGesture(e, l.type, 'zoom')} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {guides.map((g, i) => (g.x != null ? <div key={i} className="guide v" style={{ left: g.x * kd }} /> : <div key={i} className="guide h" style={{ top: g.y * kd }} />))}
            </div>
            {dropHint && <div className="st-drop">Drop to add to the captions</div>}
          </div>
        </div>

        <div className="st-transport">
          <button className="icon-btn play" onClick={togglePlay} title="Play / pause (Space)" disabled={!clip && !(live && live.info)}>
            <Icon name={clock.playing ? 'pause' : 'play'} size={15} />
          </button>
          <span className="clock">
            <b>{fmt(clock.t)}</b> / {fmt(clock.d)}
          </span>
          <input className="st-scrub" type="range" min="0" max={clock.d || 1} step="0.05" value={Math.min(clock.t, clock.d || 1)} onChange={(e) => seek(Number(e.target.value))} disabled={!clock.d} />
          {clip ? (
            <>
              <button className="btn sm" onClick={() => rebuild(false)} disabled={!!building} title="Build captions + Premiere sequence for this clip with the current preset">
                {building ? <Spinner size={12} /> : <Icon name="refresh" size={13} />} {building ? `${building.label}${building.p > 0 && building.p < 1 ? ` ${Math.round(building.p * 100)}%` : ''}` : 'Apply to clip'}
              </button>
              <button className="pr-btn ready" onClick={() => rebuild(true)} disabled={!!building}>
                <span className="pr-logo">Pr</span> Apply & open
              </button>
            </>
          ) : (
            <label className="row st-auto" title="Build the Premiere sequence (with this preset) after every download">
              <span>Premiere after download</span>
              <Toggle checked={settings.premiere.enabled} onChange={(v) => window.api.setSettings({ premiere: { enabled: v } })} />
            </label>
          )}
        </div>
        {clip && (
          <div className="st-videos" aria-hidden="true">
            <video ref={gpVid} key={clip.gameplay} src={window.api.mediaUrl(clip.gameplay)} crossOrigin="anonymous" preload="auto" playsInline onLoadedMetadata={() => setClock((c) => ({ ...c }))} />
            {clip.facecam && <video ref={fcVid} key={clip.facecam} src={window.api.mediaUrl(clip.facecam)} crossOrigin="anonymous" preload="auto" muted playsInline />}
          </div>
        )}
      </section>

      {/* ---------------- right: inspector ---------------- */}
      <Inspector
        preset={preset}
        sel={sel}
        setSel={setSel}
        patch={patch}
        patchLayer={patchLayer}
        begin={begin}
        end={end}
        settings={settings}
        tab={tab}
        setTab={setTab}
        framing={framing}
        setFraming={setFraming}
        onFontPreview={setFontPreview}
        clip={clip}
        realWords={!!realWords}
        onGoEdit={onGoEdit}
        hasFacecam={!!dims.facecam}
      />
    </div>
  );
}
