import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Player from './components/Player.jsx';
import ScrubBar from './components/ScrubBar.jsx';
import Timeline from './components/Timeline.jsx';
import ClipList from './components/ClipList.jsx';
import Bin from './components/Bin.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import PremierePreview from './components/PremierePreview.jsx';
import Volume from './components/Volume.jsx';
import { useMenu } from './components/ContextMenu.jsx';
import { Icon, Seg, Popover, Spinner, Toggle } from './components/ui.jsx';
import { fmt } from './lib/time.js';
import { detectFacecam, sampleTimes } from './lib/facecam.js';

const PALETTE = ['#ffd23f', '#3ddc84', '#39c6ff', '#ff6fae', '#ff9f43', '#a78bfa', '#2dd4bf', '#f87171'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DEFAULT_BOX = { x: 0.7, y: 0.62, w: 0.28, h: 0.35 };
const ASPECTS = { '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };
const RATES = [1, 1.25, 1.5, 2, 3, 4, 8];
const PW = 1440;
const PH = 1920;

/** Largest box with the given pixel aspect inside a W×H frame, centered on (cx, cy). */
function fitCrop(aspect, W, H, cx = 0.5, cy = 0.5) {
  let w = W;
  let h = W / aspect;
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  const nw = w / W;
  const nh = h / H;
  return { x: Math.max(0, Math.min(1 - nw, cx - nw / 2)), y: Math.max(0, Math.min(1 - nh, cy - nh / 2)), w: nw, h: nh };
}

/** Facecam position active at time t (keys = [{id, t, rect}] sorted by t). */
function keyAt(keys, t) {
  if (!keys || !keys.length) return null;
  let k = keys[0];
  for (const x of keys) if (x.t <= t + 0.001) k = x;
  return k;
}
let uid = 0;
export const nid = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

function renderName(template, channel, n, title) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (template || '{channel} {n}')
    .replace(/\{channel\}/g, channel)
    .replace(/\{n\}/g, String(n))
    .replace(/\{date\}/g, date)
    .replace(/\{title\}/g, (title || '').slice(0, 40))
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
}

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.classList && el.classList.contains('tf-cell')));
const isTextInput = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
/** What gets stored for a source (signed media URLs expire, they are fetched again on open). */
const storable = (inf) => {
  const { preview, userAgent, stale, ...rest } = inf; // eslint-disable-line no-unused-vars
  return rest;
};

/**
 * The editing workspace: media bin | player | clips + export, timeline below.
 * Owns the project state (sources, per-source facecam/crop/Premiere boxes, clips) and autosaves it.
 */
const Editor = forwardRef(function Editor({ settings, active, toast, topazInfo, jobs, onProject, openSettings, onAddMedia, onChannel, channel, modalOpen, onRenameProject, onShowKeys }, ref) {
  const openMenu = useMenu();
  const [project, setProject] = useState(null); // {id, name, created}
  const [sources, setSources] = useState({});
  const [order, setOrder] = useState([]);
  const [activeSrc, setActiveSrc] = useState(null);
  const info = activeSrc ? sources[activeSrc] : null;
  const [srcState, setSrcState] = useState({});
  const ss = (activeSrc && srcState[activeSrc]) || {};
  const [pending, setPending] = useState(null);
  const [adding, setAdding] = useState(false);

  const [clips, setClipsRaw] = useState([]);
  const clipsRef = useRef([]);
  const [activeId, setActiveId] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(typeof settings.ui.volume === 'number' ? settings.ui.volume : 0.8);
  const [muted, setMutedState] = useState(!!settings.ui.muted);
  const [span, setSpan] = useState(180);
  const [center, setCenter] = useState(0);
  const [facecamOn, setFacecamOn] = useState(settings.facecam.enabled);
  const [cropOn, setCropOn] = useState(settings.gameplay.crop === 'crop' || settings.gameplay.crop === '9x16');
  const [cropAspect, setCropAspect] = useState(ASPECTS[settings.gameplay.aspect] ? settings.gameplay.aspect : '9:16');
  const [rate, setRate] = useState(1);
  const [detecting, setDetecting] = useState(null);
  const [aspectLock, setAspectLock] = useState(null);
  const [clipMode, setClipMode] = useState(settings.output.clipMode);
  const [startNumber, setStartNumber] = useState(null);
  const [peeks, setPeeks] = useState({});
  const [edge, setEdge] = useState(null);
  const [mark, setMark] = useState(null); // pending IN point (no clip selected)
  const [scrubT, setScrubT] = useState(null); // storyboard preview while dragging the progress bar
  const [chat, setChat] = useState({}); // cacheId -> {loading, progress, data, error}
  const [layout, setLayout] = useState({ playerW: 0 });

  const player = useRef(null);
  const colorIdx = useRef(0);
  const lastPh = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const volSave = useRef(null);
  const followLock = useRef(0);
  const freeView = useRef(false);
  const laneDrag = useRef(false);
  const edgeTimer = useRef(null);
  const undoS = useRef([]);
  const redoS = useRef([]);
  const lastRec = useRef({ key: null, t: 0 });
  const loadingUrl = useRef(null);
  const seekTimer = useRef({ t: 0, pending: null, timer: 0 });
  const centerRef = useRef(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const srcStateRef = useRef(srcState);
  srcStateRef.current = srcState;

  // ---------- layout: the player takes exactly 16:9 of the height, the bin gets the rest ----------
  useLayoutEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const controls = 46;
      const vh = Math.max(120, r.height - controls);
      const a = info && info.width && info.height ? info.width / info.height : 16 / 9;
      const maxW = r.width - 210; // keep room for the bin
      setLayout({ playerW: Math.floor(Math.max(320, Math.min(maxW, vh * a))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [info && info.width, info && info.height]); // eslint-disable-line

  // leaving the editor pauses the preview
  useEffect(() => {
    if (!active && player.current) player.current.pause();
  }, [active]);

  // ---------- volume ----------
  const persistVolume = useCallback((v, m) => {
    clearTimeout(volSave.current);
    volSave.current = setTimeout(() => window.api.setSettings({ ui: { volume: v, muted: m } }), 400);
  }, []);
  const setVolume = useCallback(
    (v) => {
      v = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
      setVolumeState(v);
      setMutedState(v === 0);
      persistVolume(v, v === 0);
    },
    [persistVolume]
  );
  const toggleMute = useCallback(() => {
    const nm = !muted;
    if (!nm && volume === 0) {
      setVolumeState(0.5);
      setMutedState(false);
      persistVolume(0.5, false);
    } else {
      setMutedState(nm);
      persistVolume(volume, nm);
    }
  }, [muted, volume, persistVolume]);

  // ---------- clips + undo ----------
  const setClips = useCallback((updater, key = null, opts = {}) => {
    const prev = clipsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    if (!opts.silent) {
      const t = Date.now();
      if (!(key && lastRec.current.key === key && t - lastRec.current.t < 900)) {
        undoS.current.push(prev);
        if (undoS.current.length > 200) undoS.current.shift();
        redoS.current = [];
      }
      lastRec.current = { key, t };
    }
    clipsRef.current = next;
    setClipsRaw(next);
  }, []);

  const restore = useCallback(
    (snap, label) => {
      clipsRef.current = snap;
      setClipsRaw(snap);
      lastRec.current = { key: null, t: 0 };
      const all = snap.flatMap((c) => c.segments.map((s) => ({ ...s, src: c.src })));
      if (activeId && !all.some((s) => s.id === activeId)) setActiveId(null);
      toast(label, 'info', 1200);
    },
    [activeId, toast]
  );
  const undo = useCallback(() => {
    if (!undoS.current.length) return toast('Nothing to undo', 'info', 1200);
    redoS.current.push(clipsRef.current);
    restore(undoS.current.pop(), 'Undo');
  }, [restore, toast]);
  const redo = useCallback(() => {
    if (!redoS.current.length) return toast('Nothing to redo', 'info', 1200);
    undoS.current.push(clipsRef.current);
    restore(redoS.current.pop(), 'Redo');
  }, [restore, toast]);

  const allSegs = useMemo(
    () =>
      clips.flatMap((c, ci) =>
        c.segments.map((s, si) => ({ ...s, src: c.src, clipId: c.id, clipIdx: ci, off: c.on === false, label: c.segments.length > 1 ? `${ci + 1}${LETTERS[si]}` : `${ci + 1}` }))
      ),
    [clips]
  );
  const flat = useMemo(() => allSegs.filter((s) => s.src === activeSrc), [allSegs, activeSrc]);
  const activeSeg = allSegs.find((s) => s.id === activeId) || null;
  const duration = info ? info.duration : 0;
  const durOf = (src) => (sources[src] ? sources[src].duration : 0) || 1e9;

  const newSeg = (start, end) => ({ id: nid('s'), start: Math.round(start), end: Math.round(end), color: PALETTE[colorIdx.current++ % PALETTE.length] });
  const sortSegs = (segs) => [...segs].sort((a, b) => a.start - b.start);

  // ---------- timeline window: follows the playhead unless the user scrolled it ----------
  const view = useMemo(() => {
    const D = duration || span;
    const sp = Math.min(Math.max(10, span), D);
    const st = Math.max(0, Math.min(D - sp, center - sp / 2));
    return { start: st, end: st + sp };
  }, [span, center, duration]);
  const onView = useCallback((v, opts = {}) => {
    setSpan(v.end - v.start);
    setCenter((v.start + v.end) / 2);
    if (opts.free) freeView.current = true;
    followLock.current = performance.now() + 400;
  }, []);
  const fitSpan = (len) => setSpan(Math.max(30, Math.min(duration || 1e9, len * 2.4)));

  // ---------- player ----------
  const onTime = useCallback((t) => {
    const now = performance.now();
    if (now - lastPh.current > 50) {
      lastPh.current = now;
      setPlayhead(t);
      if (!laneDrag.current && !freeView.current && now > followLock.current) setCenter(t);
    }
  }, []);
  const onPlayState = useCallback((p) => {
    setPlaying(p);
    if (p) freeView.current = false;
    else setRate(1); // any pause ends the L shuttle
  }, []);

  const seekScrub = useCallback((t) => {
    if (t == null || !player.current) return;
    followLock.current = 0;
    freeView.current = false;
    player.current.seek(t);
    setPlayhead(t);
    setCenter(t);
  }, []);
  /** Progress bar / ruler drags: instant storyboard frame, real seeks throttled (HLS can't keep up with 60/s). */
  const scrubTo = useCallback(
    (t, phase) => {
      if (t == null || !player.current) return;
      const st = seekTimer.current;
      if (phase === 'move') {
        setScrubT(t);
        setPlayhead(t);
        if (!laneDrag.current) setCenter(t);
        st.pending = t;
        const now = performance.now();
        if (now - st.t > 140) {
          st.t = now;
          player.current.seek(t);
        } else if (!st.timer)
          st.timer = setTimeout(() => {
            st.timer = 0;
            st.t = performance.now();
            if (st.pending != null) player.current && player.current.seek(st.pending);
          }, 150);
        return;
      }
      clearTimeout(st.timer);
      st.timer = 0;
      st.pending = null;
      setScrubT(null);
      if (laneDrag.current) {
        player.current.seek(t);
        setPlayhead(t);
      } else seekScrub(t);
    },
    [seekScrub]
  );

  const centerAnim = useRef(0);
  const glideTo = useCallback((to) => {
    cancelAnimationFrame(centerAnim.current);
    let from = null;
    const t0 = performance.now();
    const stepFn = (now) => {
      setCenter((c) => {
        if (from == null) from = c;
        const k = Math.min(1, (now - t0) / 260);
        const e = 1 - (1 - k) ** 3;
        return from + (to - from) * e;
      });
      if (now - t0 < 260) centerAnim.current = requestAnimationFrame(stepFn);
    };
    centerAnim.current = requestAnimationFrame(stepFn);
  }, []);
  const onLaneDrag = useCallback(
    (d) => {
      laneDrag.current = d;
      if (!d && !freeView.current) {
        followLock.current = 0;
        glideTo(player.current ? player.current.time : 0);
      }
    },
    [glideTo]
  );

  const previewEdge = useCallback((seg, which, t, follow) => {
    if (!player.current) return;
    player.current.pause();
    if (!follow) followLock.current = performance.now() + 1500;
    player.current.seek(t);
    setPlayhead(t);
    if (follow) setCenter(t);
    setEdge({ edge: which, t, color: seg.color });
    clearTimeout(edgeTimer.current);
    edgeTimer.current = setTimeout(() => setEdge(null), 1200);
  }, []);

  // ---------- segment edits ----------
  const updateSeg = useCallback(
    (id, patch, which, from = 'list') => {
      let changed = null;
      setClips(
        (cs) =>
          cs.map((c) => {
            if (!c.segments.some((s) => s.id === id)) return c;
            const D = durOf(c.src);
            return {
              ...c,
              sent: false,
              on: true,
              segments: c.segments.map((s) => {
                if (s.id !== id) return s;
                const n = { ...s, ...patch };
                const len = s.end - s.start;
                if (patch.start != null && patch.end == null && n.start >= s.end) n.end = Math.min(D, n.start + len);
                if (patch.end != null && patch.start == null && n.end <= s.start) n.start = Math.max(0, n.end - len);
                n.start = Math.max(0, Math.min(n.start, D - 1));
                n.end = Math.max(n.start + 1, Math.min(n.end, D));
                changed = n;
                return n;
              }),
            };
          }),
        `seg:${id}:${which || 'x'}`
      );
      if (changed && which) {
        const t = which === 'end' ? changed.end : changed.start;
        const seg = allSegs.find((s) => s.id === id);
        if (seg && seg.src === activeSrc) previewEdge(changed, which === 'move' ? 'start' : which, t, from === 'list');
      }
    },
    [setClips, allSegs, activeSrc, previewEdge] // eslint-disable-line
  );
  const commitSegs = () => setClips((cs) => cs.map((c) => ({ ...c, segments: sortSegs(c.segments) })), null, { silent: true });

  const addClip = useCallback(
    (start, end) => {
      if (!activeSrc) return;
      const t = start ?? Math.floor(player.current ? player.current.time : playhead);
      const e = end ?? Math.min(duration, t + 30);
      const s = newSeg(Math.min(t, Math.max(0, duration - 1)), Math.max(e, t + 1));
      setClips((cs) => [...cs, { id: nid('c'), src: activeSrc, on: true, segments: [s] }]);
      setActiveId(s.id);
      setMark(null);
      if (start == null) fitSpan(s.end - s.start);
      return s;
    },
    [activeSrc, duration, playhead, setClips] // eslint-disable-line
  );
  const addSegment = useCallback(
    (clipId, start, end) => {
      const target = clipsRef.current.find((c) => c.id === clipId) || clipsRef.current.find((c) => c.segments.some((x) => x.id === activeId) && c.src === activeSrc);
      if (!target) return addClip(start, end);
      if (target.src !== activeSrc) setActiveSrc(target.src);
      const D = durOf(target.src);
      const t = start ?? (target.src === activeSrc ? Math.floor(player.current ? player.current.time : playhead) : target.segments.at(-1).end + 10);
      const e = end ?? Math.min(D, t + 30);
      const s = newSeg(Math.min(t, D - 1), Math.max(e, t + 1));
      setClips((cs) => cs.map((c) => (c.id === target.id ? { ...c, sent: false, on: true, segments: sortSegs([...c.segments, s]) } : c)));
      setActiveId(s.id);
    },
    [activeId, activeSrc, playhead, addClip, setClips] // eslint-disable-line
  );
  const deleteSeg = (id) => {
    setClips((cs) => cs.map((c) => ({ ...c, segments: c.segments.filter((s) => s.id !== id) })).filter((c) => c.segments.length));
    if (activeId === id) setActiveId(null);
  };
  const deleteClip = (cid) => {
    setClips((cs) => cs.filter((c) => c.id !== cid));
    toast('Clip deleted — Ctrl+Z to undo', 'info', 1800);
  };
  const duplicateClip = (cid) => {
    const c = clipsRef.current.find((x) => x.id === cid);
    if (!c) return;
    const copy = { ...c, id: nid('c'), sent: false, on: true, segments: c.segments.map((s) => ({ ...s, id: nid('s'), color: PALETTE[colorIdx.current++ % PALETTE.length] })) };
    setClips((cs) => {
      const i = cs.findIndex((x) => x.id === cid);
      return [...cs.slice(0, i + 1), copy, ...cs.slice(i + 1)];
    });
    setActiveId(copy.segments[0].id);
  };
  const splitAt = (segId, t) => {
    const s = allSegs.find((x) => x.id === segId);
    if (!s || t <= s.start + 1 || t >= s.end - 1) return toast('Put the playhead inside the clip to split it', 'info', 1600);
    const left = { ...s, end: Math.round(t) };
    const right = newSeg(Math.round(t), s.end);
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === s.clipId);
      const c = cs[i];
      const segs = c.segments.map((x) => (x.id === segId ? { id: x.id, start: left.start, end: left.end, color: x.color } : x));
      return [...cs.slice(0, i), { ...c, segments: segs }, { id: nid('c'), src: c.src, on: true, segments: [right] }, ...cs.slice(i + 1)];
    });
    setActiveId(right.id);
  };
  const toggleClip = (cid, on) => setClips((cs) => cs.map((c) => (c.id === cid ? { ...c, on } : c)), `on:${cid}`);
  const toggleAll = (on) => setClips((cs) => cs.map((c) => ({ ...c, on })), 'on:all');

  const fromPlayhead = (id, which) => {
    const t = Math.round(player.current ? player.current.time : playhead);
    const s = allSegs.find((x) => x.id === id);
    if (!s || s.src !== activeSrc) return;
    if (which === 'start') updateSeg(id, t >= s.end ? { start: t, end: Math.min(duration, t + Math.max(10, s.end - s.start)) } : { start: t });
    else updateSeg(id, t <= s.start ? { end: t, start: Math.max(0, t - Math.max(10, s.end - s.start)) } : { end: t });
    setActiveId(id);
  };
  /** I: trim the selected clip, or set a pending IN point. O: trim, or create the clip IN → playhead. */
  const markIn = () => {
    if (!info) return;
    if (activeSeg && activeSeg.src === activeSrc) return fromPlayhead(activeId, 'start');
    setMark(Math.round(player.current ? player.current.time : playhead));
  };
  /** O finishes the clip and deselects it, so the next I starts a new one (I…O, I…O, …). */
  const markOut = () => {
    if (!info) return;
    if (activeSeg && activeSeg.src === activeSrc) return fromPlayhead(activeId, 'end');
    const t = Math.round(player.current ? player.current.time : playhead);
    if (mark != null && t > mark + 0.5) addClip(mark, t);
    else if (mark != null && t < mark - 0.5) addClip(t, mark);
    else addClip(Math.max(0, t - 30), Math.max(t, 1));
    setMark(null);
    setActiveId(null);
  };

  // ---------- markers (U): jump targets + snap points ----------
  const markers = ss.markers || [];
  const toggleMarker = (at) => {
    if (!activeSrc) return;
    const t = at ?? (player.current ? player.current.time : playhead);
    const near = markers.find((m) => Math.abs(m.t - t) < 0.75);
    if (near) return patchSrc(activeSrc, { markers: markers.filter((m) => m.id !== near.id) });
    patchSrc(activeSrc, { markers: [...markers, { id: nid('m'), t: Math.round(t * 10) / 10 }].sort((a, b) => a.t - b.t) });
  };
  const jumpMarker = (dir) => {
    const t = player.current ? player.current.time : playhead;
    const m = dir > 0 ? markers.find((x) => x.t > t + 0.3) : [...markers].reverse().find((x) => x.t < t - 0.3);
    if (m) seekScrub(m.t);
  };
  const deleteMarker = (id) => patchSrc(activeSrc, { markers: markers.filter((m) => m.id !== id) });

  const selectSeg = (id) => {
    const s = allSegs.find((x) => x.id === id);
    if (!s) return;
    setActiveId(id);
    setMark(null);
    fitSpan(s.end - s.start);
    if (s.src !== activeSrc) {
      setActiveSrc(s.src);
      setPlayhead(s.start);
      setCenter(s.start);
    } else if (player.current) seekScrub(s.start);
  };
  const activateClip = (cid) => {
    const c = clipsRef.current.find((x) => x.id === cid);
    if (c && c.segments[0]) selectSeg(c.segments[0].id);
  };

  // ---------- sources ----------
  const initSource = useCallback((inf) => {
    const s = settingsRef.current;
    setSources((m) => ({ ...m, [inf.cacheId]: inf }));
    setOrder((o) => (o.includes(inf.cacheId) ? o : [...o, inf.cacheId]));
    // decided here, not inside the state updater (React runs updaters later)
    const m0 = srcStateRef.current;
    if (m0[inf.cacheId] && m0[inf.cacheId].fcKeys && m0[inf.cacheId].fcKeys.length) return false;
    const preset = (s.facecamPresets || {})[inf.channelKey];
    const sibling = Object.entries(m0).find(([id]) => sourcesRef.current[id] && sourcesRef.current[id].channelKey === inf.channelKey);
    const rect = preset || (sibling && sibling[1].fcKeys && sibling[1].fcKeys[0] && sibling[1].fcKeys[0].rect) || (s.facecam.autoDetect ? null : DEFAULT_BOX);
    const cp = (s.cropPresets || {})[inf.channelKey];
    const cropRect = cp && cp.rect && cp.aspect === s.gameplay.aspect ? cp.rect : null;
    setSrcState((m) =>
      m[inf.cacheId] && m[inf.cacheId].fcKeys && m[inf.cacheId].fcKeys.length
        ? m
        : { ...m, [inf.cacheId]: { ...(m[inf.cacheId] || {}), fcKeys: rect ? [{ id: nid('k'), t: 0, rect }] : [], confidence: preset ? 'saved' : null, cropRect, quality: inf.defaultQuality } }
    );
    return !rect;
  }, []);

  const ensureProject = useCallback((inf) => {
    setProject((p) => p || { id: nid('p'), name: inf.title || inf.channel, created: Date.now() });
  }, []);

  /** Load a link into this project (it lands in the bin and opens in the player). */
  const load = useCallback(
    async (raw, opts = {}) => {
      const url = (raw || '').trim();
      if (!/^https?:\/\//i.test(url)) return toast('That is not a link', 'warn');
      if (loadingUrl.current === url) return;
      const known = Object.values(sourcesRef.current).find((x) => x.url === url || (opts.id && x.id && String(x.id).replace(/^v/, '') === String(opts.id)));
      if (known && !known.stale && !opts.append) {
        setActiveSrc(known.cacheId);
        return;
      }
      loadingUrl.current = url;
      const silent = opts.append;
      if (silent) setAdding(true);
      else setPending({ url, title: opts.title, thumbnail: opts.thumbnail, channel: opts.channel });
      try {
        const inf = await window.api.probe(url);
        if (inf.isLive) throw new Error('This stream is still live — wait for the VOD to finish.');
        const needDetect = initSource(inf);
        ensureProject(inf);
        const s = settingsRef.current;
        let select = null;
        const own = clipsRef.current.filter((c) => c.src === inf.cacheId);
        if (own.length) select = own[0].segments[0];
        else if (inf.kind === 'clip' || opts.append) {
          const seg = newSeg(0, inf.duration);
          setClips((cs) => [...cs, { id: nid('c'), src: inf.cacheId, on: true, segments: [seg] }]);
          select = seg;
          if (clipsRef.current.length > 1) toast(`${inf.site === 'twitch' ? 'Twitch clip' : 'Clip'} added as clip ${clipsRef.current.length}`, 'ok', 2200);
        }
        if (!silent || !activeSrc) {
          setActiveSrc(inf.cacheId);
          setActiveId(select ? select.id : null);
          setMark(null);
          const t0 = select ? select.start : inf.startHint || 0;
          setPlayhead(t0);
          setCenter(t0);
          freeView.current = false;
          setSpan(inf.kind === 'clip' ? Math.max(10, inf.duration) : select ? Math.max(60, (select.end - select.start) * 2.4) : 300);
        }
        if (needDetect && s.facecam.enabled && s.facecam.autoDetect) setTimeout(() => runDetectRef.current && runDetectRef.current(inf), 300);
      } catch (e) {
        const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
        if (msg.startsWith('BOTCHECK: ')) toast(msg.slice(10), 'warn', 20000, { label: 'Use my browser login', onClick: () => openSettings('downloads') });
        else toast(msg, 'err', 7000);
      } finally {
        if (loadingUrl.current === url) loadingUrl.current = null;
        setPending(null);
        setAdding(false);
      }
    },
    [toast, initSource, setClips, ensureProject, activeSrc] // eslint-disable-line
  );

  const removeSource = (id) => {
    const n = clipsRef.current.filter((c) => c.src === id).length;
    if (n) setClips((cs) => cs.filter((c) => c.src !== id));
    setSources((m) => {
      const o = { ...m };
      delete o[id];
      return o;
    });
    setOrder((o) => o.filter((x) => x !== id));
    if (activeSrc === id) setActiveSrc(order.find((x) => x !== id) || null);
    toast(n ? `Removed with ${n} clip${n > 1 ? 's' : ''}` : 'Removed from project', 'info', 2000);
  };

  // Warm the storyboard sprites so scrubbing and the filmstrip show frames instantly
  const sbCache = useRef(new Map());
  useEffect(() => {
    const sb = info && info.storyboard;
    if (!sb || !sb.fragments) return;
    let alive = true;
    const urls = sb.fragments.map((f) => f.url).filter((u) => !sbCache.current.has(u));
    let i = 0;
    const next = () => {
      if (!alive || i >= urls.length) return;
      const img = new Image();
      sbCache.current.set(urls[i++], img);
      img.onload = img.onerror = () => setTimeout(next, 30);
      img.src = urls[i - 1];
    };
    for (let k = 0; k < 4; k++) next();
    return () => {
      alive = false;
    };
  }, [info && info.cacheId, info && info.storyboard]); // eslint-disable-line

  // Frames for the filmstrip of sources without storyboards (Twitch clips)
  useEffect(() => {
    if (!info || info.stale || info.storyboard || ss.thumbs || ss.thumbsLoading) return;
    const id = info.cacheId;
    const n = Math.max(4, Math.min(10, Math.round(info.duration / 6)));
    const times = Array.from({ length: n }, (_, i) => Math.max(0, ((i + 0.5) * info.duration) / n));
    setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), thumbsLoading: true } }));
    window.api
      .frames(id, times, 90)
      .then((fr) => setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), thumbs: fr, thumbsLoading: false } })))
      .catch(() => setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), thumbs: [], thumbsLoading: false } })));
  }, [info && info.cacheId, info && info.stale]); // eslint-disable-line

  // Twitch chat activity for VODs (sampled in the main process, cached on disk)
  const activityOn = settings.ui.activity !== false;
  useEffect(() => {
    if (!info || info.stale || !activityOn || info.site !== 'twitch' || info.kind !== 'vod' || !info.twitchId) return;
    const id = info.cacheId;
    if (chat[id] && (chat[id].data || chat[id].loading || chat[id].error)) return;
    setChat((m) => ({ ...m, [id]: { loading: true, progress: 0 } }));
    const off = window.api.onChatProgress((e) => e.twitchId === info.twitchId && setChat((m) => (m[id] && m[id].loading ? { ...m, [id]: { ...m[id], progress: e.p } } : m)));
    window.api.chatActivity({ twitchId: info.twitchId, duration: info.duration, growing: info.growing }).then((r) => {
      off();
      setChat((m) => ({ ...m, [id]: r.ok ? { data: r.activity } : { error: r.error } }));
    });
    return () => off();
  }, [info && info.cacheId, info && info.stale, activityOn]); // eslint-disable-line
  const activity = !info || !activityOn || info.stale ? null : info.twitchId ? { kind: 'chat', ...(chat[info.cacheId] || { loading: true, progress: 0 }) } : info.heatmap && info.heatmap.length ? { kind: 'heat', data: info.heatmap } : null;
  const chatData = activity && activity.kind === 'chat' ? activity.data : null;

  // ---------- facecam ----------
  const patchSrc = useCallback((id, patch) => setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } })), []);
  const savePreset = useCallback((key, rect) => {
    const s = settingsRef.current;
    window.api.replaceSetting('facecamPresets', { ...(s.facecamPresets || {}), [key]: rect });
  }, []);
  const setRectForChannel = useCallback((channelKey, rect, confidence) => {
    setSrcState((m) => {
      const out = { ...m };
      for (const [id, inf] of Object.entries(sourcesRef.current)) {
        if (inf.channelKey !== channelKey) continue;
        const keys = (out[id] && out[id].fcKeys) || [];
        out[id] = { ...(out[id] || {}), confidence, fcKeys: keys.length ? keys.map((k, i) => (i === 0 ? { ...k, rect } : k)) : [{ id: nid('k'), t: 0, rect }] };
      }
      return out;
    });
  }, []);
  const fcKeys = ss.fcKeys || [];
  const activeKey = keyAt(fcKeys, playhead);
  const setKeys = useCallback((id, fn) => setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), fcKeys: fn((m[id] && m[id].fcKeys) || []).sort((a, b) => a.t - b.t) } })), []);
  const addLayout = () => {
    if (!info) return;
    const t = Math.round(player.current ? player.current.time : playhead);
    const base = activeKey ? activeKey.rect : DEFAULT_BOX;
    if (fcKeys.some((k) => Math.abs(k.t - t) < 1)) return toast('There is already a position here', 'info', 1500);
    setFacecamOn(true);
    setKeys(activeSrc, (keys) => (keys.length ? [...keys, { id: nid('k'), t, rect: { ...base } }] : [{ id: nid('k'), t: 0, rect: { ...base } }]));
    if (fcKeys.length) toast(`New facecam position from ${fmt(t)} — move the box`, 'ok', 2600);
  };
  const deleteLayout = (id) => {
    const k = fcKeys.find((x) => x.id === id);
    if (!k || fcKeys.indexOf(k) === 0) return;
    setKeys(activeSrc, (keys) => keys.filter((x) => x.id !== id));
    toast(`Facecam position at ${fmt(k.t)} removed`, 'info', 1800);
  };

  const runDetect = useCallback(
    async (inf = info) => {
      if (!inf || detecting) return;
      try {
        setDetecting('Grabbing frames…');
        const segs = clipsRef.current.filter((c) => c.src === inf.cacheId).flatMap((c) => c.segments);
        const keys = (srcState[inf.cacheId] && srcState[inf.cacheId].fcKeys) || [];
        const k = keys.length > 1 && inf.cacheId === activeSrc ? keyAt(keys, playhead) : null;
        let times;
        if (k) {
          const next = keys.find((x) => x.t > k.t);
          const a = k.t;
          const b = next ? next.t : inf.duration;
          times = Array.from({ length: 12 }, (_, i) => Math.round(a + ((b - a) * (i + 0.5)) / 12));
        } else times = sampleTimes(inf.duration, segs, 14);
        const frames = await window.api.frames(inf.cacheId, times, 480);
        if (!frames.length) throw new Error('Could not grab frames');
        const res = await detectFacecam(frames, setDetecting);
        setFacecamOn(true);
        if (!res) {
          toast('No facecam found — draw the box yourself', 'warn');
          if (!keys.length) setKeys(inf.cacheId, () => [{ id: nid('k'), t: 0, rect: DEFAULT_BOX }]);
          patchSrc(inf.cacheId, { confidence: 'low' });
        } else if (k && keys.indexOf(k) > 0) {
          setKeys(inf.cacheId, (ks) => ks.map((x) => (x.id === k.id ? { ...x, rect: res.rect } : x)));
          toast(res.message, res.confidence === 'low' ? 'warn' : 'ok');
        } else {
          setRectForChannel(inf.channelKey, res.rect, res.confidence);
          if (res.confidence !== 'low') savePreset(inf.channelKey, res.rect);
          toast(res.message, res.confidence === 'low' ? 'warn' : 'ok');
        }
      } catch (e) {
        toast(`Detection failed: ${e.message}`, 'err');
      } finally {
        setDetecting(null);
      }
    },
    [info, detecting, toast, savePreset, patchSrc, setRectForChannel, srcState, activeSrc, playhead, setKeys]
  );
  const runDetectRef = useRef(null);
  runDetectRef.current = runDetect;

  const toggleFacecam = () => {
    const on = !facecamOn;
    setFacecamOn(on);
    if (on && activeSrc && !fcKeys.length) setKeys(activeSrc, () => [{ id: nid('k'), t: 0, rect: DEFAULT_BOX }]);
  };
  const onFacecamRect = useCallback(
    (rect, final) => {
      if (!info || !activeKey) return;
      const firstKey = fcKeys.indexOf(activeKey) === 0;
      if (final && firstKey) {
        setRectForChannel(info.channelKey, rect, 'manual');
        savePreset(info.channelKey, rect);
      } else setKeys(info.cacheId, (keys) => keys.map((k) => (k.id === activeKey.id ? { ...k, rect } : k)));
    },
    [info, activeKey, fcKeys, savePreset, setKeys, setRectForChannel]
  );
  const changeBoxRatio = (n) => {
    setAspectLock(n);
    if (n && activeKey && info) {
      const r = activeKey.rect;
      onFacecamRect({ ...r, h: Math.min(1 - r.y, (r.w * info.width) / n / info.height) }, true);
    }
  };

  // ---------- gameplay crop window ----------
  const aspectNum = ASPECTS[cropAspect] || 9 / 16;
  const cropRect = info ? ss.cropRect || fitCrop(aspectNum, info.width, info.height) : null;
  const onCropRect = useCallback(
    (rect, final) => {
      if (!info) return;
      patchSrc(info.cacheId, { cropRect: rect });
      if (final) window.api.replaceSetting('cropPresets', { ...(settingsRef.current.cropPresets || {}), [info.channelKey]: { aspect: cropAspect, rect } });
    },
    [info, patchSrc, cropAspect]
  );
  const changeAspect = (a) => {
    setCropAspect(a);
    setCropOn(true);
    window.api.setSettings({ gameplay: { aspect: a } });
    setSrcState((m) => {
      const out = {};
      for (const [id, st] of Object.entries(m)) {
        const inf = sources[id];
        if (!inf) {
          out[id] = st;
          continue;
        }
        const r = st.cropRect;
        out[id] = { ...st, cropRect: id === activeSrc && r ? fitCrop(ASPECTS[a], inf.width, inf.height, r.x + r.w / 2, r.y + r.h / 2) : null };
      }
      return out;
    });
  };

  // ---------- Topaz ----------
  const tz = settings.topaz;
  const tzPreset = tz.presets.find((p) => p.id === tz.preset) || tz.presets[0];
  const enhanceOn = !!(tz.enabled && topazInfo && topazInfo.found && tzPreset && facecamOn);
  const tzLabel = tzPreset ? `${tzPreset.scale}× ${(((topazInfo && topazInfo.models) || []).find((m) => m.id === tzPreset.model) || { family: tzPreset.model }).family}` : '';

  // ---------- Premiere layout (1440×1920: facecam top, gameplay window below) ----------
  const prem = settings.premiere;
  const premiereOn = !!prem.enabled;
  const topH = Math.round(PH * prem.split);
  const botAspect = PW / (PH - topH);
  const premRect = info ? ss.premRect || (settings.premiereLayouts || {})[info.channelKey] || fitCrop(botAspect, info.width, info.height) : null;
  const onPremRect = useCallback(
    (rect, final) => {
      if (!info) return;
      patchSrc(info.cacheId, { premRect: rect });
      if (final) window.api.replaceSetting('premiereLayouts', { ...(settingsRef.current.premiereLayouts || {}), [info.channelKey]: rect });
    },
    [info, patchSrc]
  );
  useEffect(() => {
    if (!info || !premRect) return;
    const r = premRect;
    if (Math.abs((r.w * info.width) / (r.h * info.height) / botAspect - 1) > 0.02) patchSrc(info.cacheId, { premRect: fitCrop(botAspect, info.width, info.height, r.x + r.w / 2, r.y + r.h / 2) });
  }, [botAspect, info && info.cacheId]); // eslint-disable-line

  // ---------- selection for export + naming ----------
  const selected = useMemo(() => clips.filter((c) => c.on !== false && sources[c.src]), [clips, sources]);
  const selSrcs = useMemo(() => [...new Set(selected.map((c) => c.src))], [selected]);
  const channelKeys = useMemo(() => [...new Set((selSrcs.length ? selSrcs : activeSrc ? [activeSrc] : []).filter((id) => sources[id]).map((id) => sources[id].channelKey))], [selSrcs, activeSrc, sources]);
  useEffect(() => {
    if (!channelKeys.length) return;
    let alive = true;
    Promise.all(
      channelKeys.map((k) => {
        const inf = Object.values(sourcesRef.current).find((x) => x.channelKey === k);
        return window.api.peekName({ channelKey: k, channel: inf.channel, title: inf.title }).then((p) => [k, p]);
      })
    ).then((list) => alive && setPeeks(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [channelKeys.join('|'), settings.output, jobs.length]); // eslint-disable-line

  const tmpl = settings.output.template;
  const peekOf = (inf) => (inf && peeks[inf.channelKey]) || null;
  const effectiveMode = selected.length > 1 ? clipMode : 'merge';
  const firstInf = selected.length ? sources[selected[0].src] : info;
  const firstPeek = peekOf(firstInf);
  const outName = useMemo(() => {
    if (!firstInf) return '';
    const counters = {};
    const nameFor = (inf, isFirst) => {
      const pk = peekOf(inf);
      const key = inf.channelKey;
      if (counters[key] == null) counters[key] = (isFirst && startNumber) || (pk && pk.next) || 1;
      return renderName(tmpl, pk ? pk.channel : inf.channel, counters[key]++, inf.title);
    };
    if (selected.length <= 1 || effectiveMode !== 'separate') return nameFor(firstInf, true);
    const names = selected.map((c) => nameFor(sources[c.src], sources[c.src].channelKey === firstInf.channelKey));
    return channelKeys.length <= 1 ? `${names[0]} – ${names.at(-1).split(' ').pop()}` : `${names[0]} + ${names.length - 1} more`;
  }, [selected, sources, peeks, startNumber, tmpl, effectiveMode, firstInf]); // eslint-disable-line

  const q = info && info.qualities && info.qualities.find((x) => x.key === ss.quality);
  const totalDur = selected.reduce((a, c) => a + c.segments.reduce((b, s) => b + (s.end - s.start), 0), 0);
  const estBytes = useMemo(() => {
    let b = 0;
    for (const c of selected)
      for (const s of c.segments) {
        const inf = sources[c.src];
        const st = srcState[c.src] || {};
        const qq = inf && inf.qualities && inf.qualities.find((x) => x.key === st.quality);
        if (qq && qq.tbr) b += (qq.tbr * 1000 * (s.end - s.start)) / 8;
      }
    return b;
  }, [selected, sources, srcState]);

  // ---------- download ----------
  /** clipIds = only these clips; full = whole video of one source. */
  const download = useCallback(
    async (opts = {}) => {
      const s = settingsRef.current;
      let list = opts.clipIds ? clipsRef.current.filter((c) => opts.clipIds.includes(c.id)) : clipsRef.current.filter((c) => c.on !== false);
      list = list.filter((c) => sources[c.src] && !sources[c.src].stale);
      const srcIds = opts.full ? [opts.full] : [...new Set(list.map((c) => c.src))];
      if (!srcIds.length) return toast(clipsRef.current.length ? 'Check at least one clip' : 'Mark a clip on the timeline first', 'warn');
      const srcSpec = {};
      for (const id of srcIds) {
        const inf = sources[id];
        const st = srcState[id] || {};
        srcSpec[id] = {
          url: inf.url,
          title: inf.title,
          channel: inf.channel,
          channelKey: inf.channelKey,
          duration: inf.duration,
          thumbnail: inf.thumbnail,
          quality: st.quality || inf.defaultQuality,
          facecamKeys: (st.fcKeys || []).map((k) => ({ t: k.t, rect: k.rect })),
          cropRect: st.cropRect || fitCrop(ASPECTS[cropAspect] || 9 / 16, inf.width, inf.height),
          // for the chat overlay
          site: inf.site,
          kind: inf.kind,
          vid: inf.id,
          twitchId: inf.twitchId || null,
        };
      }
      const first = srcIds[0];
      const spec = {
        sources: srcSpec,
        clips: opts.full ? [] : list.map((c) => ({ src: c.src, segments: c.segments.map((x) => ({ start: x.start, end: x.end })) })),
        clipMode: list.length > 1 ? clipMode : 'merge',
        facecamOn,
        cropOn,
        cropAspect: ASPECTS[cropAspect] || 9 / 16,
        enhance: enhanceOn ? tzPreset : null,
        chat: !!(s.chat && s.chat.enabled),
        premiereRect: premiereOn && !cropOn && sources[first] ? (srcState[first] && srcState[first].premRect) || (s.premiereLayouts || {})[sources[first].channelKey] || null : null,
        qualityLabel: q ? `${q.label} ${q.codec}` : '',
        startNumber: startNumber || null,
        baseDir: s.output.baseDir,
      };
      try {
        const job = await window.api.addJob(spec);
        toast(`Downloading → ${job.names.join(', ')}`, 'ok');
        setStartNumber(null);
        const ids = new Set(list.map((c) => c.id));
        // downloaded clips stay in the list (✓) but are unchecked so the next download takes only new ones
        if (!opts.full) setClips((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, sent: true, on: false } : c)), null, { silent: true });
      } catch (e) {
        toast(e.message, 'err');
      }
    },
    [sources, srcState, clipMode, facecamOn, cropOn, cropAspect, enhanceOn, tzPreset, premiereOn, q, startNumber, toast, setClips]
  );

  // ---------- context menus ----------
  const segMenu = (e, seg, t) => {
    if (!seg) {
      return openMenu(e, [
        { label: 'New clip here', icon: 'plus', kbd: 'N', onClick: () => addClip(Math.round(t)) },
        { label: mark != null ? 'Move IN here' : 'Set IN here', icon: 'in', kbd: 'I', onClick: () => setMark(Math.round(t)) },
        mark != null && t > mark ? { label: `Clip from IN (${fmt(mark)}) to here`, icon: 'scissors', onClick: () => addClip(mark, Math.round(t)) } : null,
        { label: 'Marker here', icon: 'flag', kbd: 'U', onClick: () => toggleMarker(t) },
        { label: 'Facecam moved here — new position', icon: 'userPlus', onClick: () => (seekScrub(t), setTimeout(addLayout, 50)) },
      ]);
    }
    const c = clipsRef.current.find((x) => x.id === seg.clipId);
    openMenu(e, [
      { head: `Clip ${seg.label}` },
      { label: 'Download this clip', icon: 'download', primary: true, onClick: () => download({ clipIds: [seg.clipId] }) },
      { label: 'Play clip', icon: 'play', onClick: () => player.current && player.current.playRange(seg.start, seg.end) },
      { label: 'Split at playhead', icon: 'scissors', onClick: () => splitAt(seg.id, player.current ? player.current.time : playhead) },
      { label: 'Add part at playhead', icon: 'plus', kbd: 'Shift N', onClick: () => addSegment(seg.clipId) },
      { label: c && c.on === false ? 'Check for download' : 'Uncheck (skip on download)', icon: 'check', onClick: () => toggleClip(seg.clipId, c && c.on === false) },
      '-',
      c && c.segments.length > 1 ? { label: 'Delete this part', icon: 'x', danger: true, onClick: () => deleteSeg(seg.id) } : null,
      { label: 'Delete clip', icon: 'trash', danger: true, kbd: 'Del', onClick: () => deleteClip(seg.clipId) },
    ]);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (modalOpen) return;
      const typing = isTyping(document.activeElement);
      const k = e.key;
      if (e.ctrlKey && !isTextInput(document.activeElement) && (k === 'z' || k === 'Z' || k === 'y' || k === 'Y')) {
        e.preventDefault();
        if (k === 'y' || k === 'Y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.ctrlKey && k === 'Enter') {
        e.preventDefault();
        download();
        return;
      }
      if (e.ctrlKey && (k === 'a' || k === 'A') && !typing) {
        e.preventDefault();
        toggleAll(!clipsRef.current.every((c) => c.on !== false));
        return;
      }
      if (typing || !info || e.ctrlKey || e.altKey || e.metaKey) return;
      const p = player.current;
      const seekBy = (d) => p && seekScrub(p.time + d);
      const bump = (dir) => {
        const i = RATES.indexOf(rate);
        setRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 0 : i) + dir))]);
      };
      const playPause = () => {
        if (!p) return;
        followLock.current = 0;
        freeView.current = false;
        p.toggle();
      };
      if (e.shiftKey && (k === '>' || k === ':')) return bump(1);
      if (e.shiftKey && (k === '<' || k === ';')) return bump(-1);
      switch (k) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          playPause();
          break;
        case 'j':
        case 'J':
          seekBy(e.shiftKey ? -2 : -10);
          break;
        case 'l':
        case 'L':
          // shuttle: L plays, every further L speeds up (1 → 2 → 4 → 8); any pause resets to 1×
          followLock.current = 0;
          freeView.current = false;
          if (p && p.paused) {
            setRate(1);
            p.toggle();
          } else setRate(rate < 2 ? 2 : rate < 4 ? 4 : 8);
          break;
        case 'u':
        case 'U':
          toggleMarker();
          break;
        case ',':
          jumpMarker(-1);
          break;
        case '.':
          jumpMarker(1);
          break;
        case 'p':
        case 'P':
          if (activeSeg && activeSeg.src === activeSrc && p) {
            p.playRange(activeSeg.start, activeSeg.end);
          } else playPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(e.shiftKey ? -1 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(e.shiftKey ? 1 : 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((muted ? 0 : volume) + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((muted ? 0 : volume) - 0.05);
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 'i':
        case 'I':
          markIn();
          break;
        case 'o':
        case 'O':
          markOut();
          break;
        case 'n':
          addClip();
          break;
        case 'N':
          addSegment();
          break;
        case 'Escape':
          setActiveId(null);
          setMark(null);
          break;
        case 'Delete':
        case 'Backspace':
          if (activeSeg) {
            const c = clipsRef.current.find((x) => x.id === activeSeg.clipId);
            if (c && c.segments.length > 1) deleteSeg(activeId);
            else deleteClip(activeSeg.clipId);
          }
          break;
        case 'f':
        case 'F':
          toggleFacecam();
          break;
        case 'd':
        case 'D':
          runDetect();
          break;
        case 's':
        case 'S':
          if (activeSeg) {
            splitAt(activeId, p ? p.time : playhead);
          }
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- project persistence ----------
  const snapshot = useCallback(
    () =>
      project && {
        ...project,
        sources: Object.fromEntries(order.filter((id) => sources[id]).map((id) => [id, storable(sources[id])])),
        order,
        srcState: Object.fromEntries(Object.entries(srcState).map(([id, st]) => [id, { fcKeys: st.fcKeys, cropRect: st.cropRect, premRect: st.premRect, quality: st.quality, confidence: st.confidence, markers: st.markers }])),
        clips,
        activeSrc,
        playhead: Math.round(playhead),
        facecamOn,
        cropOn,
        cropAspect,
        clipMode,
      },
    [project, sources, order, srcState, clips, activeSrc, playhead, facecamOn, cropOn, cropAspect, clipMode]
  );
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const saveTimer = useRef(0);
  useEffect(() => {
    if (!project || !order.length) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snap = snapRef.current();
      if (snap) onProject && onProject(snap);
    }, 700);
  }, [project, sources, order, srcState, clips, activeSrc, facecamOn, cropOn, cropAspect, clipMode, Math.round(playhead / 5)]); // eslint-disable-line

  const reset = () => {
    setProject(null);
    setSources({});
    setOrder([]);
    setActiveSrc(null);
    setSrcState({});
    clipsRef.current = [];
    setClipsRaw([]);
    undoS.current = [];
    redoS.current = [];
    setActiveId(null);
    setMark(null);
    setPlayhead(0);
    setCenter(0);
    setSpan(300);
    setStartNumber(null);
  };

  useImperativeHandle(ref, () => ({
    load,
    flush() {
      clearTimeout(saveTimer.current);
      const snap = snapRef.current();
      if (snap && snap.order && snap.order.length) onProject && onProject(snap);
    },
    newProject() {
      this.flush();
      reset();
    },
    get projectId() {
      return project && project.id;
    },
    get hasMedia() {
      return order.length > 0;
    },
    rename(name) {
      setProject((p) => (p ? { ...p, name } : p));
    },
    /** Open a saved project: show it right away from the stored info, refresh the media links in the background. */
    async open(p) {
      this.flush();
      reset();
      const srcs = p.sources || {};
      const ord = (p.order || Object.keys(srcs)).filter((id) => srcs[id]);
      setProject({ id: p.id, name: p.name, created: p.created });
      setSources(Object.fromEntries(ord.map((id) => [id, { ...srcs[id], preview: null, stale: true }])));
      setOrder(ord);
      setSrcState(p.srcState || {});
      clipsRef.current = p.clips || [];
      setClipsRaw(p.clips || []);
      const act = p.activeSrc && srcs[p.activeSrc] ? p.activeSrc : ord[0] || null;
      setActiveSrc(act);
      if (typeof p.facecamOn === 'boolean') setFacecamOn(p.facecamOn);
      if (typeof p.cropOn === 'boolean') setCropOn(p.cropOn);
      if (p.cropAspect) setCropAspect(p.cropAspect);
      if (p.clipMode) setClipMode(p.clipMode);
      const t0 = p.playhead || 0;
      setPlayhead(t0);
      setCenter(t0);
      colorIdx.current = (p.clips || []).reduce((a, c) => a + c.segments.length, 0);
      for (const id of [act, ...ord.filter((x) => x !== act)].filter(Boolean)) {
        try {
          const inf = await window.api.probe(srcs[id].url);
          setSources((m) => (m[id] ? { ...m, [inf.cacheId]: inf } : m));
          if (inf.cacheId === act && t0) setTimeout(() => player.current && player.current.seek(t0), 600);
        } catch (e) {
          setSources((m) => (m[id] ? { ...m, [id]: { ...m[id], stale: false, error: e.message } } : m));
          const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
          if (msg.startsWith('BOTCHECK: ')) toast(msg.slice(10), 'warn', 20000, { label: 'Use my browser login', onClick: () => openSettings('downloads') });
          else toast(`Could not reload ${srcs[id].title || 'a video'}: ${msg}`, 'warn', 6000);
        }
      }
    },
    stageRect() {
      return player.current ? player.current.stageRect : null;
    },
    binRect() {
      const el = document.querySelector('.bin');
      return el ? el.getBoundingClientRect() : null;
    },
  }));

  // automation hook (screenshot test scripts)
  useEffect(() => {
    window.__vs = {
      ...(window.__vs || {}),
      load,
      download,
      runDetect,
      addClip,
      addSegment,
      undo,
      redo,
      markIn,
      markOut,
      setView: onView,
      seek: seekScrub,
      scrub: scrubTo,
      updateSeg,
      addLayout,
      changeAspect,
      setRate,
      toggleClip,
      state: () => ({ info, sources, clips, srcState, project, facecam: { enabled: facecamOn, keys: fcKeys, rect: activeKey && activeKey.rect }, cropRect, view, playhead, detecting, activeId, activeSrc, edge, rate, mark, chat }),
    };
  });

  // ---------- render ----------
  const facecam = { enabled: facecamOn, rect: activeKey ? activeKey.rect : null, confidence: ss.confidence };
  const crop = cropOn
    ? { enabled: true, rect: cropRect, aspect: aspectNum, label: cropAspect }
    : premiereOn && premRect
      ? { enabled: true, rect: premRect, aspect: botAspect, label: '· PREMIERE BOTTOM', premiere: true }
      : { enabled: false };
  const segInPlayer = activeSeg && activeSeg.src === activeSrc;
  const initialTime = segInPlayer ? activeSeg.start : playhead || null;
  const showPip = premiereOn && !cropOn && settings.ui.pipPreview !== false && info && !info.stale;
  const getVideo = useCallback(() => player.current && player.current.el, []);
  // what the selected sources will really produce (a facecam file needs a box)
  const fcReady = facecamOn && (selSrcs.length ? selSrcs : activeSrc ? [activeSrc] : []).some((id) => srcState[id] && srcState[id].fcKeys && srcState[id].fcKeys.length);
  const chatOn = !!(settings.chat && settings.chat.enabled);
  const files = `${settings.output.gameplayName}${cropOn ? ` ${cropAspect}` : ''}${fcReady ? ` + ${settings.output.facecamName}${enhanceOn ? ' (enhanced)' : ''}` : ''}${chatOn ? ' + Chat' : ''}${premiereOn ? ' + Premiere' : ''}`;

  const folderCard = (close) => (
    <div className="pop-card">
      <div className="pc-row">
        <span className="pc-label">Main folder</span>
        <div className="path-row">
          <span className="path" title={settings.output.baseDir}>
            {settings.output.baseDir}
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              const p = await window.api.pickFolder(settings.output.baseDir);
              if (p) window.api.setSettings({ output: { baseDir: p } });
            }}
          >
            Change
          </button>
          <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(settings.output.baseDir)}>
            <Icon name="external" size={14} />
          </button>
        </div>
      </div>
      <div className="pc-row">
        <span className="pc-label">Save as</span>
        <Seg
          size="sm"
          value={settings.output.mode}
          onChange={(m) => window.api.setSettings({ output: { mode: m } })}
          options={[
            { value: 'folders', label: 'Numbered folders' },
            { value: 'flat', label: 'All in one folder' },
          ]}
        />
      </div>
      {firstInf && (
        <div className="pc-row two">
          <label>
            <span className="pc-label">Name</span>
            <input
              className="input sm"
              value={(settings.output.aliases || {})[firstInf.channelKey] ?? ''}
              placeholder={firstInf.channel}
              onChange={(e) => window.api.replaceSetting('output.aliases', { ...(settings.output.aliases || {}), [firstInf.channelKey]: e.target.value })}
            />
          </label>
          <label>
            <span className="pc-label">Number</span>
            <input
              className="input sm num"
              type="number"
              min="1"
              value={startNumber ?? ''}
              placeholder={String((firstPeek && firstPeek.next) || 1)}
              onChange={(e) => setStartNumber(e.target.value ? Number(e.target.value) : null)}
            />
          </label>
        </div>
      )}
      <div className="pc-row">
        <span className="pc-label">Numbering</span>
        <Seg
          size="sm"
          value={settings.output.counterMode}
          onChange={(m) => window.api.setSettings({ output: { counterMode: m } })}
          options={[
            { value: 'auto', label: 'Continue from folder' },
            { value: 'manual', label: 'My own counter' },
          ]}
        />
      </div>
      <p className="pc-hint">
        {startNumber
          ? `Starts at ${startNumber} this time${settings.output.counterMode === 'manual' ? ' and keeps counting from there' : ''}.`
          : settings.output.counterMode === 'auto'
            ? `Next free number in this folder: ${(firstPeek && firstPeek.next) || 1}.`
            : `Your counter for ${firstPeek ? firstPeek.channel : ''} is at ${(firstPeek && firstPeek.next) || 1}.`}
      </p>
      <button className="btn sm full" onClick={close}>
        Done
      </button>
    </div>
  );

  const exportCtx = {
    settings,
    selected,
    filesLabel: files,
    facecamOn,
    toggleFacecam,
    detecting,
    fcKeys,
    hasBox: !!(activeKey && activeKey.rect),
    activeKey,
    runDetect: () => runDetect(),
    seek: (t) => seekScrub(t + 0.05),
    deleteLayout,
    addLayout,
    playhead,
    aspectLock,
    setAspectLock: changeBoxRatio,
    topazFound: !!(topazInfo && topazInfo.found),
    enhanceOn,
    tzLabel,
    premiereOn,
    cropOn,
    setCropOn,
    cropAspect,
    changeAspect,
    openSettings,
    outName,
    folderCard,
    q,
    qualities: info ? info.qualities : [],
    setQuality: (key) => activeSrc && patchSrc(activeSrc, { quality: key }),
    totalDur,
    estBytes,
    clipMode,
    setClipMode,
    download: () => download(),
  };

  const videoMenu = (
    <Popover
      align="right"
      trigger={({ toggle, open }) => (
        <button className={`vid-gear ${open ? 'open' : ''}`} title="Video options" onClick={toggle}>
          <Icon name="settings" size={16} />
        </button>
      )}
    >
      {() => (
        <div className="pop-card narrow vid-menu">
          <label className="row between">
            <span>
              <b>{info && info.site === 'twitch' ? 'Chat activity' : 'Most replayed'}</b>
              <em>{info && info.site === 'twitch' ? 'Twitch chat graph + emotes at the peaks' : 'YouTube heatmap on the timeline'}</em>
            </span>
            <Toggle checked={activityOn} onChange={(v) => window.api.setSettings({ ui: { activity: v } })} />
          </label>
          {info && info.site === 'twitch' && (
            <label className="row between">
              <span>
                <b>Emotes on the progress bar</b>
                <em>Click one to jump to that moment</em>
              </span>
              <Toggle checked={settings.ui.emotes !== false} onChange={(v) => window.api.setSettings({ ui: { emotes: v } })} />
            </label>
          )}
          <label className="row between">
            <span>
              <b>Premiere preview</b>
              <em>Live 1440×1920 view while the Premiere layout is on</em>
            </span>
            <Toggle checked={settings.ui.pipPreview !== false} onChange={(v) => window.api.setSettings({ ui: { pipPreview: v } })} />
          </label>
        </div>
      )}
    </Popover>
  );

  return (
    <div className={`editor ${active ? '' : 'inactive'}`}>
      <div className="ed-main">
        <div className="ed-center" ref={centerRef}>
          <Bin
            sources={sources}
            order={order}
            activeSrc={activeSrc}
            clips={clips}
            pending={pending}
            channel={channel}
            project={project}
            onActivate={(id) => {
              if (id === activeSrc) return;
              setActiveSrc(id);
              setActiveId(null);
              setMark(null);
              const c = clipsRef.current.find((x) => x.src === id);
              const t0 = c ? c.segments[0].start : 0;
              setPlayhead(t0);
              setCenter(t0);
            }}
            onRemove={removeSource}
            onAdd={onAddMedia}
            onChannel={onChannel}
            onDownloadFull={(id) => download({ full: id })}
            onRename={() => onRenameProject && onRenameProject(project)}
          />
          <section className="ed-player" style={{ width: layout.playerW || undefined }}>
            <Player
              ref={player}
              info={info && !info.stale ? info : null}
              poster={pending ? pending.thumbnail : info && info.thumbnail}
              facecam={facecam}
              onFacecamRect={onFacecamRect}
              crop={crop}
              onCropRect={crop.premiere ? onPremRect : onCropRect}
              editBoxes
              aspectLock={aspectLock}
              onTime={onTime}
              onPlayState={onPlayState}
              volume={volume}
              muted={muted}
              rate={rate}
              initialTime={initialTime}
              preview={scrubT}
              empty={
                !info && !pending ? (
                  <div className="stage-empty">
                    <Icon name="film" size={26} />
                    <b>No video yet</b>
                    <span>Paste a link or search a streamer in the bar above.</span>
                  </div>
                ) : pending || (info && info.stale) ? (
                  <div className="stage-badge">
                    <Spinner /> {pending ? 'Loading video…' : 'Refreshing video link…'}
                  </div>
                ) : null
              }
            >
              {info && (
                <div className="vid-top">
                  <span className={`site site-${info.site}`}>{info.site === 'twitch' ? (info.kind === 'clip' ? 'Twitch clip' : 'Twitch') : 'YouTube'}</span>
                  <span className="vid-title" title={info.title}>
                    <b>{info.channel}</b> {info.title}
                  </span>
                  <button className="icon-btn xs" title="Open original" onClick={() => window.api.openExternal(info.url)}>
                    <Icon name="external" size={13} />
                  </button>
                  {videoMenu}
                </div>
              )}
              {info && (
                <ScrubBar
                  duration={duration}
                  playhead={playhead}
                  segments={flat}
                  activeId={activeId}
                  heatmap={activityOn ? info.heatmap : null}
                  chat={activityOn ? chatData : null}
                  emotes={settings.ui.emotes !== false}
                  chapters={info.chapters}
                  storyboard={info.storyboard}
                  onSeek={scrubTo}
                  edge={edge}
                  layouts={facecamOn && fcKeys.length > 1 ? fcKeys : null}
                  onLayoutDelete={deleteLayout}
                  markers={markers}
                  onMarkerDelete={deleteMarker}
                />
              )}
              {showPip && (
                <PremierePreview
                  getVideo={getVideo}
                  facecamRect={facecamOn && activeKey ? activeKey.rect : null}
                  gameplayRect={premRect}
                  split={prem.split}
                  captions={prem.captions}
                  height={Math.max(150, Math.min(300, Math.round(((layout.playerW || 800) * 9) / 16 / 2.4)))}
                  onClose={() => window.api.setSettings({ ui: { pipPreview: false } })}
                />
              )}
            </Player>
            <div className="controls">
              <div className="ctl-group">
                <button
                  className="icon-btn play"
                  disabled={!info || info.stale}
                  onClick={() => {
                    followLock.current = 0;
                    player.current && player.current.toggle();
                  }}
                  title="Play / pause (Space)"
                >
                  <Icon name={playing ? 'pause' : 'play'} size={16} />
                </button>
                <button className="icon-btn" onClick={() => player.current && seekScrub(player.current.time - 10)} title="Back 10 s (J)">
                  <Icon name="back10" size={15} />
                </button>
                <button className="icon-btn" onClick={() => player.current && seekScrub(player.current.time + 10)} title="Forward 10 s (→ = 5 s)">
                  <Icon name="fwd10" size={15} />
                </button>
                <span className="clock">
                  <b>{fmt(playhead, { forceHours: duration >= 3600 })}</b> / {fmt(duration)}
                </span>
                <Volume value={volume} muted={muted} onChange={setVolume} onToggleMute={toggleMute} />
                <Popover
                  up
                  trigger={({ toggle }) => (
                    <button className={`rate-btn ${rate !== 1 ? 'on' : ''} ${rate !== 1 && playing ? 'glow' : ''}`} onClick={toggle} onContextMenu={(e) => (e.preventDefault(), setRate(1))} title="Playback speed (L = faster, any pause resets to 1×)">
                      {rate}×
                    </button>
                  )}
                >
                  {({ close }) => (
                    <div className="menu">
                      {RATES.map((r) => (
                        <button
                          key={r}
                          className={`menu-item ${r === rate ? 'on' : ''}`}
                          onClick={() => {
                            setRate(r);
                            close();
                          }}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              </div>
              <div className="ctl-group mark">
                <button className={`mark-btn ${mark != null ? 'armed' : ''}`} disabled={!info} onClick={markIn} title={segInPlayer ? 'Set the start of the selected clip to the playhead (I)' : 'Mark IN at the playhead (I)'}>
                  <Icon name="in" size={13} /> IN
                </button>
                <button className="mark-btn" disabled={!info} onClick={markOut} title={segInPlayer ? 'Set the end of the selected clip to the playhead (O)' : 'Mark OUT — creates the clip (O)'}>
                  OUT <Icon name="out" size={13} />
                </button>
                <button className="mark-btn ghost" disabled={!info} onClick={() => toggleMarker()} title="Marker at the playhead (U) · jump with , and .">
                  <Icon name="flag" size={13} /> Marker
                </button>
              </div>
              <div className="ctl-group right">
                <button className="icon-btn sm" title="Keyboard shortcuts (F1)" onClick={() => onShowKeys && onShowKeys()}>
                  <Icon name="keyboard" size={16} />
                </button>
                {facecamOn && info && (
                  <button className="chip sm" onClick={addLayout} title={`Facecam moved? New position from ${fmt(playhead)}`}>
                    <Icon name="userPlus" size={12} /> {fcKeys.length > 1 ? `Cam ${fcKeys.indexOf(activeKey) + 1}/${fcKeys.length}` : 'Cam moved?'}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
        <Timeline
          info={info}
          thumbs={ss.thumbs}
          duration={duration}
          segments={flat}
          activeId={activeId}
          playhead={playhead}
          view={view}
          onView={onView}
          onSeek={(t, phase) => (phase === 'move' ? scrubTo(t, 'move') : phase === 'end' ? scrubTo(t, 'end') : seekScrub(t))}
          onSelect={(id) => {
            setActiveId(id);
            if (id) setMark(null);
          }}
          onChange={(id, p, mode) => updateSeg(id, p, mode, 'lane')}
          onCommit={commitSegs}
          onDragState={onLaneDrag}
          onCreate={(s, e) => addClip(s, e)}
          onMenu={segMenu}
          activity={activity}
          mark={mark}
          markers={markers}
          onMarkerDelete={deleteMarker}
        />
      </div>
      <aside className="ed-side">
        <ClipList
          clips={clips}
          sources={sources}
          srcState={srcState}
          activeSrc={activeSrc}
          activeId={activeId}
          settings={settings}
          onSelect={selectSeg}
          onActivateClip={activateClip}
          onChangeSeg={(id, p, which) => updateSeg(id, p, which, 'list')}
          onDeleteSeg={deleteSeg}
          onAddSeg={(cid) => addSegment(cid)}
          onAddClip={() => addClip()}
          onDeleteClip={deleteClip}
          onDuplicate={duplicateClip}
          onPlaySeg={(s) => {
            const c = clipsRef.current.find((x) => x.segments.some((y) => y.id === s.id));
            selectSeg(s.id);
            if (c && c.src === activeSrc && player.current) player.current.playRange(s.start, s.end);
          }}
          onFromPlayhead={fromPlayhead}
          onAddLink={async () => {
            const text = await window.api.readClipboard();
            const m = /https?:\/\/\S+/.exec(text || '');
            if (!m) return toast('Copy a Twitch clip / video link first', 'warn');
            load(m[0], { append: true });
          }}
          onToggle={toggleClip}
          onToggleAll={toggleAll}
          onDownloadClip={(cid) => download({ clipIds: [cid] })}
          adding={adding}
        />
        <ExportPanel x={exportCtx} />
      </aside>
    </div>
  );
});

export default Editor;
