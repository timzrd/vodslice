import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Player from './components/Player.jsx';
import ScrubBar from './components/ScrubBar.jsx';
import Timeline from './components/Timeline.jsx';
import ClipList from './components/ClipList.jsx';
import Settings from './components/Settings.jsx';
import Jobs, { ACTIVE } from './components/Jobs.jsx';
import Logo from './components/Logo.jsx';
import Volume from './components/Volume.jsx';
import Empty from './components/Empty.jsx';
import UpdatePill from './components/UpdatePill.jsx';
import CaptionsEditor from './components/CaptionsEditor.jsx';
import { Icon, Seg, Popover, Spinner, Kbd, SplitChip, Toggle } from './components/ui.jsx';
import { fmt, fmtShort, fmtBytes, extractUrl, SUPPORTED } from './lib/time.js';
import { detectFacecam, sampleTimes } from './lib/facecam.js';

const PALETTE = ['#ffd23f', '#3ddc84', '#39c6ff', '#ff6fae', '#ff9f43', '#a78bfa', '#2dd4bf', '#f87171'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DEFAULT_BOX = { x: 0.7, y: 0.62, w: 0.28, h: 0.35 };
const ASPECTS = { '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9 };
const RATES = [1, 1.25, 1.5, 2, 3, 4, 8];

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

/** Facecam position active at time t (layouts = [{id, t, rect}] sorted by t). */
function keyAt(keys, t) {
  if (!keys || !keys.length) return null;
  let k = keys[0];
  for (const x of keys) if (x.t <= t + 0.001) k = x;
  return k;
}
let uid = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

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

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, tone = 'info', ms = 3800) => {
    const id = nid('t');
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  return [toasts, push];
}

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.classList && el.classList.contains('tf-cell')));
const isTextInput = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

export default function App() {
  const [settings, setSettings] = useState(null);
  const [tools, setTools] = useState(null);
  const [urlText, setUrlText] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  // sources = every loaded video/clip, activeSrc = the one in the player
  const [sources, setSources] = useState({});
  const [activeSrc, setActiveSrc] = useState(null);
  const info = activeSrc ? sources[activeSrc] : null;
  // per-source settings: facecam box, 9:16 crop position, quality
  const [srcState, setSrcState] = useState({});
  const ss = (activeSrc && srcState[activeSrc]) || {};

  const [clips, setClipsRaw] = useState([]);
  const clipsRef = useRef([]);
  const [activeId, setActiveId] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMutedState] = useState(false);
  const [span, setSpan] = useState(180);
  const [center, setCenter] = useState(0);
  const [facecamOn, setFacecamOn] = useState(true);
  const [cropOn, setCropOn] = useState(false);
  const [cropAspect, setCropAspect] = useState('9:16');
  const [rate, setRate] = useState(1);
  const [topazInfo, setTopazInfo] = useState(null);
  const [detecting, setDetecting] = useState(null);
  const [aspectLock, setAspectLock] = useState(null);
  const [clipMode, setClipMode] = useState('separate');
  const [startNumber, setStartNumber] = useState(null);
  const [peeks, setPeeks] = useState({});
  const [edge, setEdge] = useState(null); // {edge, t, color} shown on the video while setting start/end
  const [jobs, setJobs] = useState([]);
  const [jobsOpen, setJobsOpen] = useState(true);
  const [history, setHistory] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [capJob, setCapJob] = useState(null);
  const [miniOn, setMiniOn] = useState(false);
  const [toasts, toast] = useToasts();

  const player = useRef(null);
  const colorIdx = useRef(0);
  const lastPh = useRef(0);
  const urlInput = useRef(null);
  const loadingUrl = useRef(null);
  const settingsRef = useRef(null);
  const volSave = useRef(null);
  const followLock = useRef(0);
  const laneDrag = useRef(false);
  const edgeTimer = useRef(null);
  const undoS = useRef([]);
  const redoS = useRef([]);
  const lastRec = useRef({ key: null, t: 0 });
  settingsRef.current = settings;

  // ---------- boot ----------
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setFacecamOn(s.facecam.enabled);
      setCropOn(s.gameplay.crop === 'crop' || s.gameplay.crop === '9x16');
      setCropAspect(ASPECTS[s.gameplay.aspect] ? s.gameplay.aspect : '9:16');
      setClipMode(s.output.clipMode);
      if (typeof s.ui.volume === 'number') setVolumeState(s.ui.volume);
      setMutedState(!!s.ui.muted);
    });
    window.api.toolsStatus().then((t) => setTools({ status: t, progress: t.progress, error: t.error }));
    window.api.jobs().then(setJobs);
    window.api.history().then(setHistory);
    window.api.miniState().then(setMiniOn);
    window.api.topazStatus().then(setTopazInfo).catch(() => {});
    const offs = [
      window.api.onSettings(setSettings),
      window.api.onTools((p) => setTools((t) => ({ ...(t || {}), status: p.status || (t && t.status), progress: p.done ? null : p, error: p.error || null }))),
      window.api.onJob((j) => setJobs((list) => (list.some((x) => x.id === j.id) ? list.map((x) => (x.id === j.id ? j : x)) : [...list, j]))),
      window.api.onJobRemoved((id) => setJobs((list) => list.filter((x) => x.id !== id))),
      window.api.onHistory(setHistory),
      window.api.onMiniState(setMiniOn),
    ];
    return () => offs.forEach((o) => o());
  }, []);

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

  // job finished / failed toasts
  const prevJobs = useRef({});
  useEffect(() => {
    for (const j of jobs) {
      const p = prevJobs.current[j.id];
      if (p && p !== j.status) {
        if (j.status === 'done') toast(`✓ ${j.names.join(', ')} saved`, 'ok');
        if (j.status === 'error') toast(`Download failed: ${j.error}`, 'err', 8000);
      }
      prevJobs.current[j.id] = j.status;
    }
  }, [jobs, toast]);

  // ---------- clips + undo ----------
  /** All clip edits go through here. Edits with the same key in quick succession form one undo step. */
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
      if (!all.some((s) => s.id === activeId)) {
        const first = all.find((s) => s.src === activeSrc) || all[0];
        setActiveId(first ? first.id : null);
        if (first && first.src !== activeSrc) setActiveSrc(first.src);
      }
      toast(label, 'info', 1200);
    },
    [activeId, activeSrc, toast]
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

  const clipNo = useMemo(() => Object.fromEntries(clips.map((c, i) => [c.id, i])), [clips]);
  const allSegs = useMemo(
    () =>
      clips.flatMap((c, ci) =>
        c.segments.map((s, si) => ({ ...s, src: c.src, clipId: c.id, clipIdx: ci, label: c.segments.length > 1 ? `${ci + 1}${LETTERS[si]}` : `${ci + 1}` }))
      ),
    [clips]
  );
  const flat = useMemo(() => allSegs.filter((s) => s.src === activeSrc), [allSegs, activeSrc]);
  const activeSeg = allSegs.find((s) => s.id === activeId) || null;
  const duration = info ? info.duration : 0;
  const durOf = (src) => (sources[src] ? sources[src].duration : 0) || 1e9;

  const newSeg = (start, end) => ({ id: nid('s'), start: Math.round(start), end: Math.round(end), color: PALETTE[colorIdx.current++ % PALETTE.length] });
  const sortSegs = (segs) => [...segs].sort((a, b) => a.start - b.start);

  // ---------- zoom lane: always centered on the playhead ----------
  const view = useMemo(() => {
    const D = duration || span;
    const sp = Math.min(Math.max(10, span), D);
    const st = Math.max(0, Math.min(D - sp, center - sp / 2));
    return { start: st, end: st + sp };
  }, [span, center, duration]);
  const onView = useCallback((v) => {
    setSpan(v.end - v.start);
    setCenter((v.start + v.end) / 2);
    followLock.current = performance.now() + 400;
  }, []);
  const fitSpan = (len) => setSpan(Math.max(30, Math.min(duration || 1e9, len * 2.4)));

  // ---------- player ----------
  const onTime = useCallback((t) => {
    const now = performance.now();
    if (now - lastPh.current > 50) {
      lastPh.current = now;
      setPlayhead(t);
      if (!laneDrag.current && now > followLock.current) setCenter(t);
    }
  }, []);
  const onPlayState = useCallback((p) => setPlaying(p), []);
  const seekScrub = useCallback((t) => {
    if (t == null || !player.current) return;
    followLock.current = 0;
    player.current.seek(t);
    setPlayhead(t);
    setCenter(t);
  }, []);

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
      if (!d) {
        followLock.current = 0;
        glideTo(player.current ? player.current.time : 0);
      }
    },
    [glideTo]
  );

  /** Show the frame where a start/end is being set, without moving the zoom lane. */
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
              segments: c.segments.map((s) => {
                if (s.id !== id) return s;
                const n = { ...s, ...patch };
                const len = s.end - s.start;
                // moving one edge past the other drags the whole segment along
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
      setClips((cs) => [...cs, { id: nid('c'), src: activeSrc, segments: [s] }]);
      setActiveId(s.id);
      if (start == null) fitSpan(s.end - s.start);
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
      setClips((cs) => cs.map((c) => (c.id === target.id ? { ...c, sent: false, segments: sortSegs([...c.segments, s]) } : c)));
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
  const clearClips = () => {
    if (!clipsRef.current.length) return;
    setClips([]);
    setActiveId(null);
    toast('All clips removed — Ctrl+Z brings them back', 'info', 3000);
  };

  const fromPlayhead = (id, which) => {
    const t = Math.round(player.current ? player.current.time : playhead);
    const s = allSegs.find((x) => x.id === id);
    if (!s || s.src !== activeSrc) return;
    if (which === 'start') updateSeg(id, t >= s.end ? { start: t, end: Math.min(duration, t + Math.max(10, s.end - s.start)) } : { start: t });
    else updateSeg(id, t <= s.start ? { end: t, start: Math.max(0, t - Math.max(10, s.end - s.start)) } : { end: t });
    setActiveId(id);
  };

  const selectSeg = (id) => {
    const s = allSegs.find((x) => x.id === id);
    if (!s) return;
    setActiveId(id);
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

  // draft per video (restored when the same VOD is opened again with no clips)
  useEffect(() => {
    if (!activeSrc) return;
    try {
      const own = clips.filter((c) => c.src === activeSrc);
      if (own.length) localStorage.setItem(`draft:${activeSrc}`, JSON.stringify({ clips: own, at: Date.now() }));
    } catch {}
  }, [clips, activeSrc]);

  // ---------- loading ----------
  const initSource = useCallback((inf) => {
    const s = settingsRef.current;
    setSources((m) => ({ ...m, [inf.cacheId]: inf }));
    setSrcState((m) => {
      if (m[inf.cacheId]) return m;
      const preset = (s.facecamPresets || {})[inf.channelKey];
      // reuse the box of an already loaded source from the same channel (VOD + its clips)
      const sibling = Object.entries(m).find(([id]) => sources[id] && sources[id].channelKey === inf.channelKey);
      const rect = preset || (sibling && sibling[1].fcKeys && sibling[1].fcKeys[0] && sibling[1].fcKeys[0].rect) || (s.facecam.autoDetect ? null : DEFAULT_BOX);
      let fcKeys = rect ? [{ id: nid('k'), t: 0, rect }] : [];
      try {
        const saved = JSON.parse(localStorage.getItem(`layouts:${inf.cacheId}`) || 'null');
        if (saved && saved.length) fcKeys = saved;
      } catch {}
      const cp = (s.cropPresets || {})[inf.channelKey];
      const cropRect = cp && cp.rect && cp.aspect === s.gameplay.aspect ? cp.rect : null;
      return { ...m, [inf.cacheId]: { fcKeys, confidence: preset ? 'saved' : null, cropRect, quality: inf.defaultQuality } };
    });
    const preset = (s.facecamPresets || {})[inf.channelKey];
    return !preset;
  }, [sources]); // eslint-disable-line

  const load = useCallback(
    async (raw, { append = false } = {}) => {
      const url = extractUrl(raw) || (raw || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        toast('That is not a link', 'warn');
        return;
      }
      if (loadingUrl.current === url) return;
      loadingUrl.current = url;
      if (!append) setUrlText(url);
      append ? setAdding(true) : setLoading(true);
      setError(null);
      try {
        const inf = await window.api.probe(url);
        if (inf.isLive) throw new Error('This stream is still live — wait for the VOD to finish.');
        const needDetect = initSource(inf);
        const s = settingsRef.current;
        // clips already sent to downloads make room for the new work
        let cs = clipsRef.current.filter((c) => !c.sent);
        let select = null;
        const asClip = append || inf.kind === 'clip';
        const own = cs.filter((c) => c.src === inf.cacheId);
        if (own.length) select = own[0].segments[0];
        else if (asClip) {
          const seg = newSeg(0, inf.duration);
          cs = [...cs, { id: nid('c'), src: inf.cacheId, segments: [seg] }];
          select = seg;
          if (clipsRef.current.length) toast(`${inf.site === 'twitch' && inf.kind === 'clip' ? 'Twitch clip' : 'Video'} added as clip ${cs.length}`, 'ok', 2200);
        } else {
          let restored = null;
          try {
            const d = JSON.parse(localStorage.getItem(`draft:${inf.cacheId}`) || 'null');
            if (d && d.clips && d.clips.length && !inf.startHint) restored = d.clips.map((c) => ({ ...c, src: inf.cacheId, sent: false }));
          } catch {}
          if (restored) cs = [...cs, ...restored];
          else {
            const st0 = Math.min(inf.startHint || 0, Math.max(0, inf.duration - 2));
            cs = [...cs, { id: nid('c'), src: inf.cacheId, segments: [newSeg(st0, Math.min(inf.duration, st0 + 60))] }];
          }
          select = cs.find((c) => c.src === inf.cacheId).segments[0];
        }
        if (cs !== clipsRef.current) setClips(cs);
        if (!Object.keys(sources).length) setStartNumber(null);
        setActiveSrc(inf.cacheId);
        setActiveId(select ? select.id : null);
        const t0 = select ? select.start : inf.startHint || 0;
        setPlayhead(t0);
        setCenter(t0);
        setSpan(inf.kind === 'clip' ? Math.max(10, inf.duration) : select ? Math.max(60, (select.end - select.start) * 2.4) : 180);
        if (needDetect && s.facecam.enabled && s.facecam.autoDetect) setTimeout(() => runDetectRef.current && runDetectRef.current(inf), 300);
      } catch (e) {
        if (append) toast(e.message || String(e), 'err', 6000);
        else setError(e.message || String(e));
      } finally {
        if (loadingUrl.current === url) loadingUrl.current = null;
        append ? setAdding(false) : setLoading(false);
      }
    },
    [toast, initSource, setClips, sources] // eslint-disable-line
  );

  const pasteAndLoad = useCallback(
    async (opts) => {
      const text = await window.api.readClipboard();
      const u = extractUrl(text);
      if (u && SUPPORTED.test(u)) {
        if (!info || (u !== info.url && u !== urlText) || (opts && opts.append)) load(u, opts);
        else urlInput.current && urlInput.current.select();
        return true;
      }
      return false;
    },
    [info, urlText, load]
  );

  // ---------- facecam / crop ----------
  const patchSrc = useCallback((id, patch) => setSrcState((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } })), []);
  const savePreset = useCallback((key, rect) => {
    const s = settingsRef.current;
    window.api.replaceSetting('facecamPresets', { ...(s.facecamPresets || {}), [key]: rect });
  }, []);
  /** Same channel = same default layout: apply a box as the first position of every source of that channel. */
  const setRectForChannel = useCallback(
    (channelKey, rect, confidence) => {
      setSrcState((m) => {
        const out = { ...m };
        for (const [id, inf] of Object.entries(sources)) {
          if (inf.channelKey !== channelKey) continue;
          const keys = (out[id] && out[id].fcKeys) || [];
          out[id] = { ...(out[id] || {}), confidence, fcKeys: keys.length ? keys.map((k, i) => (i === 0 ? { ...k, rect } : k)) : [{ id: nid('k'), t: 0, rect }] };
        }
        return out;
      });
    },
    [sources]
  );
  const fcKeys = ss.fcKeys || [];
  const activeKey = keyAt(fcKeys, playhead);
  const setKeys = useCallback(
    (id, fn) =>
      setSrcState((m) => {
        const keys = fn((m[id] && m[id].fcKeys) || []).sort((a, b) => a.t - b.t);
        try {
          if (keys.length > 1) localStorage.setItem(`layouts:${id}`, JSON.stringify(keys));
          else localStorage.removeItem(`layouts:${id}`);
        } catch {}
        return { ...m, [id]: { ...(m[id] || {}), fcKeys: keys } };
      }),
    []
  );
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
        const segs = clips.filter((c) => c.src === inf.cacheId).flatMap((c) => c.segments);
        // with several facecam positions: detect the one under the playhead (sample only its time window)
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
    [info, clips, detecting, toast, savePreset, patchSrc, setRectForChannel, srcState, activeSrc, playhead, setKeys]
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
      const first = fcKeys.indexOf(activeKey) === 0;
      if (final && first) {
        // first position = the channel's default layout
        setRectForChannel(info.channelKey, rect, 'manual');
        savePreset(info.channelKey, rect);
      } else setKeys(info.cacheId, (keys) => keys.map((k) => (k.id === activeKey.id ? { ...k, rect } : k)));
    },
    [info, activeKey, fcKeys, savePreset, setKeys, setRectForChannel]
  );

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
    // keep the window where it is, resized to the new ratio; other sources fall back to centered
    setSrcState((m) => {
      const out = {};
      for (const [id, st] of Object.entries(m)) {
        const inf = sources[id];
        if (!inf) continue;
        const r = st.cropRect;
        out[id] = { ...st, cropRect: id === activeSrc && r ? fitCrop(ASPECTS[a], inf.width, inf.height, r.x + r.w / 2, r.y + r.h / 2) : null };
      }
      return out;
    });
  };

  // ---------- Topaz ----------
  const tz = settings ? settings.topaz : null;
  const tzPreset = tz ? tz.presets.find((p) => p.id === tz.preset) || tz.presets[0] : null;
  const enhanceOn = !!(tz && tz.enabled && topazInfo && topazInfo.found && tzPreset);

  // ---------- Premiere layout (facecam on top, gameplay below) ----------
  const prem = settings ? settings.premiere : null;
  const premiereOn = !!(prem && prem.enabled);
  const [PW, PH] = prem && prem.format === '9:16' ? [1440, 2560] : [1440, 1920];
  const topH = Math.round(PH * (prem ? prem.split : 1 / 3));
  const topAspect = PW / topH;
  const botAspect = PW / (PH - topH);
  const premRect = info ? ss.premRect || (settings && (settings.premiereLayouts || {})[info.channelKey]) || fitCrop(botAspect, info.width, info.height) : null;
  const onPremRect = useCallback(
    (rect, final) => {
      if (!info) return;
      patchSrc(info.cacheId, { premRect: rect });
      if (final) window.api.replaceSetting('premiereLayouts', { ...(settingsRef.current.premiereLayouts || {}), [info.channelKey]: rect });
    },
    [info, patchSrc]
  );
  // keep the facecam box at the ratio of the top area while the Premiere layout is on
  useEffect(() => {
    if (!premiereOn || !info || !activeKey || !activeKey.rect) return;
    const r = activeKey.rect;
    const a = (r.w * info.width) / (r.h * info.height);
    if (Math.abs(a / topAspect - 1) < 0.02) return;
    const h = Math.min(1, (r.w * info.width) / topAspect / info.height);
    const cy = r.y + r.h / 2;
    onFacecamRect({ ...r, h, y: Math.max(0, Math.min(1 - h, cy - h / 2)) }, true);
  }, [premiereOn, topAspect, activeKey && activeKey.id, info && info.cacheId]); // eslint-disable-line
  // stored bottom windows must follow format/split changes
  useEffect(() => {
    if (!info || !ss.premRect) return;
    const r = ss.premRect;
    if (Math.abs((r.w * info.width) / (r.h * info.height) / botAspect - 1) > 0.02) patchSrc(info.cacheId, { premRect: fitCrop(botAspect, info.width, info.height, r.x + r.w / 2, r.y + r.h / 2) });
  }, [botAspect]); // eslint-disable-line

  // ---------- naming ----------
  const usedSrcs = useMemo(() => {
    const ids = clips.length ? [...new Set(clips.map((c) => c.src))] : activeSrc ? [activeSrc] : [];
    return ids.filter((id) => sources[id]);
  }, [clips, activeSrc, sources]);
  const channelKeys = useMemo(() => [...new Set(usedSrcs.map((id) => sources[id].channelKey))], [usedSrcs, sources]);
  useEffect(() => {
    if (!settings || !channelKeys.length) return;
    let alive = true;
    Promise.all(
      channelKeys.map((k) => {
        const inf = Object.values(sources).find((x) => x.channelKey === k);
        return window.api.peekName({ channelKey: k, channel: inf.channel, title: inf.title }).then((p) => [k, p]);
      })
    ).then((list) => alive && setPeeks(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [channelKeys.join('|'), settings, jobs.length]); // eslint-disable-line

  const effectiveMode = clips.length > 1 ? clipMode : 'merge';
  const tmpl = settings ? settings.output.template : '{channel} {n}';
  const firstInf = clips.length ? sources[clips[0].src] : info;
  const peekOf = (inf) => (inf && peeks[inf.channelKey]) || null;
  const clipNames = useMemo(() => {
    if (!firstInf) return [];
    const counters = {};
    const nameFor = (inf, isFirst) => {
      const pk = peekOf(inf);
      const key = inf.channelKey;
      if (counters[key] == null) counters[key] = (isFirst && startNumber) || (pk && pk.next) || 1;
      return renderName(tmpl, pk ? pk.channel : inf.channel, counters[key]++, inf.title);
    };
    if (clips.length <= 1 || effectiveMode !== 'separate') {
      const base = nameFor(firstInf, true);
      return clips.map((_, i) => (clips.length <= 1 ? base : effectiveMode === 'together' ? `${base} · Clip ${i + 1}` : `${base} · merged`));
    }
    const firstKey = firstInf.channelKey;
    return clips.map((c) => {
      const inf = sources[c.src];
      return nameFor(inf, inf.channelKey === firstKey);
    });
  }, [clips, sources, peeks, startNumber, tmpl, effectiveMode, firstInf]); // eslint-disable-line
  const oneChannel = channelKeys.length <= 1;
  const outName =
    clips.length > 1 && effectiveMode === 'separate'
      ? oneChannel
        ? `${clipNames[0]} – ${clipNames.at(-1).split(' ').pop()}`
        : `${clipNames[0]} + ${clipNames.length - 1} more`
      : clipNames[0] || (firstInf ? renderName(tmpl, firstInf.channel, (peekOf(firstInf) || {}).next || 1, firstInf.title) : '');
  const firstPeek = peekOf(firstInf);

  // ---------- download ----------
  const q = info && info.qualities.find((x) => x.key === ss.quality);
  const totalDur = clips.length ? allSegs.reduce((a, s) => a + (s.end - s.start), 0) : duration;
  const estBytes = useMemo(() => {
    let b = 0;
    for (const s of clips.length ? allSegs : info ? [{ src: activeSrc, start: 0, end: duration }] : []) {
      const inf = sources[s.src];
      const st = srcState[s.src] || {};
      const qq = inf && inf.qualities.find((x) => x.key === st.quality);
      if (qq && qq.tbr) b += (qq.tbr * 1000 * (s.end - s.start)) / 8;
    }
    return b;
  }, [clips, allSegs, sources, srcState, info, activeSrc, duration]);

  const download = useCallback(async () => {
    if (!usedSrcs.length) return;
    const s = settingsRef.current;
    const srcSpec = {};
    for (const id of usedSrcs) {
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
      };
    }
    const spec = {
      sources: srcSpec,
      clips: clips.map((c) => ({ src: c.src, segments: c.segments.map((x) => ({ start: x.start, end: x.end })) })),
      clipMode: effectiveMode,
      facecamOn,
      cropOn,
      cropAspect: ASPECTS[cropAspect] || 9 / 16,
      enhance: enhanceOn ? tzPreset : null,
      premiereRect: premiereOn && !cropOn && usedSrcs[0] && sources[usedSrcs[0]] ? (srcState[usedSrcs[0]] && srcState[usedSrcs[0]].premRect) || (settingsRef.current.premiereLayouts || {})[sources[usedSrcs[0]].channelKey] || null : null,
      qualityLabel: q ? `${q.label} ${q.codec}` : '',
      startNumber: startNumber || null,
      baseDir: s.output.baseDir,
    };
    try {
      const job = await window.api.addJob(spec);
      toast(`Downloading → ${job.names.join(', ')}`, 'ok');
      setStartNumber(null);
      setJobsOpen(true);
      setClips((cs) => cs.map((c) => ({ ...c, sent: true })), null, { silent: true });
    } catch (e) {
      toast(e.message, 'err');
    }
  }, [usedSrcs, sources, srcState, clips, effectiveMode, facecamOn, cropOn, cropAspect, enhanceOn, tzPreset, premiereOn, q, startNumber, toast, setClips]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (showSettings) return;
      const typing = isTyping(document.activeElement);
      const k = e.key;
      if (e.ctrlKey && !isTextInput(document.activeElement) && (k === 'z' || k === 'Z' || k === 'y' || k === 'Y')) {
        e.preventDefault();
        if (k === 'y' || k === 'Y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.ctrlKey && (k === 'v' || k === 'V') && !typing) {
        e.preventDefault();
        pasteAndLoad().then((ok) => !ok && toast('No YouTube / Twitch link in clipboard', 'warn'));
        return;
      }
      if (e.ctrlKey && k === ',') {
        e.preventDefault();
        setShowSettings(true);
        return;
      }
      if (e.ctrlKey && e.shiftKey && (k === 'O' || k === 'o')) {
        e.preventDefault();
        const done = [...jobs].reverse().find((j) => j.status === 'done');
        window.api.openPath(done && done.outputs[0] ? done.outputs[0].dir : settingsRef.current.output.baseDir);
        return;
      }
      if (e.ctrlKey && k === 'Enter') {
        e.preventDefault();
        download();
        return;
      }
      if (typing || !info || e.ctrlKey || e.altKey || e.metaKey) return;
      const p = player.current;
      const seekBy = (d) => p && seekScrub(p.time + d);
      const bump = (dir) => {
        const i = RATES.indexOf(rate);
        const n = RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 0 : i) + dir))];
        setRate(n);
        toast(`Speed ${n}×`, 'info', 900);
      };
      if (e.shiftKey && (k === '>' || k === '.' || k === ':')) return bump(1);
      if (e.shiftKey && (k === '<' || k === ',' || k === ';')) return bump(-1);
      switch (k) {
        case ' ':
          e.preventDefault();
          followLock.current = 0;
          p && p.toggle();
          break;
        case 'j':
        case 'J':
          seekBy(-10);
          break;
        case 'l':
        case 'L':
          // Premiere-style shuttle: L plays, every further L doubles the speed
          followLock.current = 0;
          if (p && p.paused) {
            setRate(1);
            p.toggle();
          } else bump(rate >= 2 ? 2 : 3);
          break;
        case 'k':
        case 'K':
          p && p.pause();
          setRate(1);
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
          if (activeSeg && activeSeg.src === activeSrc) fromPlayhead(activeId, 'start');
          else addClip();
          break;
        case 'o':
        case 'O':
          if (activeSeg && activeSeg.src === activeSrc) fromPlayhead(activeId, 'end');
          break;
        case 'n':
          addClip();
          break;
        case 'N':
          addSegment();
          break;
        case 'Delete':
        case 'Backspace':
          if (activeId) deleteSeg(activeId);
          break;
        case 'f':
        case 'F':
          toggleFacecam();
          break;
        case 'd':
        case 'D':
          runDetect();
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // automation hook (used by the screenshot test script)
  useEffect(() => {
    window.__vs = {
      load,
      download,
      runDetect,
      addClip,
      addSegment,
      undo,
      redo,
      setView: onView,
      seek: seekScrub,
      updateSeg,
      addLayout,
      changeAspect,
      setRate,
      state: () => ({ info, sources, clips, srcState, facecam: { enabled: facecamOn, keys: fcKeys, rect: activeKey && activeKey.rect }, cropRect, view, playhead, detecting, jobs, activeId, activeSrc, edge, rate }),
    };
  });

  // drop a link anywhere
  useEffect(() => {
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const u = extractUrl(t);
      if (u) load(u, { append: !!info });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [load, info]);

  if (!settings) return <div className="boot" />;

  const toolSetup = tools && tools.progress && tools.progress.setup;
  const activeJobs = jobs.filter((j) => ACTIVE.includes(j.status));
  const facecam = { enabled: facecamOn, rect: activeKey ? activeKey.rect : null, confidence: ss.confidence };
  const crop = cropOn
    ? { enabled: true, rect: cropRect, aspect: aspectNum, label: cropAspect }
    : premiereOn && premRect
      ? { enabled: true, rect: premRect, aspect: botAspect, label: '· PREMIERE BOTTOM', premiere: true }
      : { enabled: false };
  const segInPlayer = activeSeg && activeSeg.src === activeSrc;
  const initialTime = segInPlayer ? activeSeg.start : null;

  return (
    <div className="app">
      {/* ---------- Title bar ---------- */}
      <header className="titlebar">
        <div className="brand">
          <Logo size={22} />
          <span>vodslice</span>
        </div>
        <div className={`urlbox ${loading ? 'loading' : ''} ${error ? 'has-error' : ''}`}>
          <Icon name="link" size={16} />
          <input
            ref={urlInput}
            value={urlText}
            placeholder="Click to paste a YouTube / Twitch link — clips get added to the list"
            spellCheck={false}
            onChange={(e) => setUrlText(e.target.value)}
            onMouseDown={async (e) => {
              const el = e.currentTarget;
              if (document.activeElement === el) return;
              const ok = await pasteAndLoad();
              if (ok) el.blur();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load(urlText);
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text');
              if (extractUrl(t)) {
                e.preventDefault();
                load(t);
              }
            }}
          />
          {loading ? (
            <Spinner />
          ) : urlText ? (
            <button className="icon-btn xs ghost" title="Reload" onClick={() => load(urlText)}>
              <Icon name="refresh" size={13} />
            </button>
          ) : (
            <Kbd>Ctrl V</Kbd>
          )}
        </div>
        <div className="tb-actions">
          <UpdatePill busyJobs={activeJobs.length > 0} />
          <button className={`icon-btn ${miniOn ? 'on' : ''}`} title="Mini progress overlay (always on top)" onClick={() => window.api.toggleMini()}>
            <Icon name="pip" size={17} />
            {activeJobs.length > 0 && <span className="dot" />}
          </button>
          <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={17} />
          </button>
        </div>
      </header>

      {/* ---------- Body ---------- */}
      {!info ? (
        <Empty
          loading={loading}
          error={error}
          onPaste={() => pasteAndLoad().then((ok) => !ok && toast('No YouTube / Twitch link in clipboard', 'warn'))}
          history={history}
          settings={settings}
        />
      ) : (
        <main className="workspace">
          <section className="maincol">
            <div className="meta">
              <span className={`site site-${info.site}`}>{info.site === 'twitch' ? (info.kind === 'clip' ? 'Twitch clip' : 'Twitch') : info.site === 'youtube' ? 'YouTube' : info.site}</span>
              <span className="meta-ch">{info.channel}</span>
              <span className="meta-title" title={info.title}>
                {info.title}
              </span>
              <span className="meta-dur">{fmt(info.duration)}</span>
              {error && <span className="meta-err">{error}</span>}
              <button className="icon-btn xs ghost" title="Open original" onClick={() => window.api.openExternal(info.url)}>
                <Icon name="external" size={13} />
              </button>
            </div>
            <Player
              ref={player}
              info={info}
              facecam={facecam}
              onFacecamRect={onFacecamRect}
              crop={crop}
              onCropRect={crop.premiere ? onPremRect : onCropRect}
              editBoxes
              aspectLock={premiereOn ? topAspect : aspectLock}
              onTime={onTime}
              onPlayState={onPlayState}
              volume={volume}
              muted={muted}
              rate={rate}
              initialTime={initialTime}
            >
              <ScrubBar
                duration={duration}
                playhead={playhead}
                segments={flat}
                activeId={activeId}
                heatmap={info.heatmap}
                chapters={info.chapters}
                storyboard={info.storyboard}
                onSeek={seekScrub}
                edge={edge}
                layouts={facecamOn && fcKeys.length > 1 ? fcKeys : null}
                onLayoutDelete={deleteLayout}
              />
            </Player>
            <div className="controls">
              <div className="ctl-group">
                <button
                  className="icon-btn play"
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
                <button className="icon-btn" onClick={() => player.current && seekScrub(player.current.time + 10)} title="Forward 10 s">
                  <Icon name="fwd10" size={15} />
                </button>
                <span className="clock">
                  <b>{fmt(playhead, { forceHours: duration >= 3600 })}</b> / {fmt(duration)}
                </span>
                <Volume value={volume} muted={muted} onChange={setVolume} onToggleMute={toggleMute} />
                <Popover
                  up
                  trigger={({ toggle }) => (
                    <button className={`rate-btn ${rate !== 1 ? 'on' : ''}`} onClick={toggle} onContextMenu={(e) => (e.preventDefault(), setRate(1))} title="Playback speed (Shift+. / Shift+, · L = faster · K = stop)">
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
                <button className="mark-btn" onClick={() => (segInPlayer ? fromPlayhead(activeId, 'start') : addClip())} title="Set start of the selected segment to the playhead (I)">
                  <Icon name="in" size={13} /> IN
                </button>
                <button className="mark-btn" disabled={!segInPlayer} onClick={() => segInPlayer && fromPlayhead(activeId, 'end')} title="Set end of the selected segment to the playhead (O)">
                  OUT <Icon name="out" size={13} />
                </button>
              </div>
              <div className="ctl-group right">
                <SplitChip
                  on={facecamOn}
                  icon="user"
                  label={fcKeys.length > 1 ? `Facecam · ${fcKeys.indexOf(activeKey) + 1}/${fcKeys.length}` : 'Facecam'}
                  busy={!!detecting}
                  title="Export the facecam as its own file (F)"
                  onToggle={toggleFacecam}
                >
                  {({ close }) => (
                    <div className="pop-card narrow">
                      <button
                        className="btn sm full"
                        disabled={!!detecting}
                        onClick={() => {
                          runDetect();
                          close();
                        }}
                      >
                        {detecting ? <Spinner size={12} /> : <Icon name="sparkles" size={13} />} {detecting || (fcKeys.length > 1 ? 'Detect this position' : 'Detect automatically')}
                        <Kbd>D</Kbd>
                      </button>
                      <div className="pc-row">
                        <span className="pc-label">Positions</span>
                        <div className="layout-list">
                          {fcKeys.map((k, i) => (
                            <div key={k.id} className={`layout-row ${activeKey && activeKey.id === k.id ? 'on' : ''}`}>
                              <button className="layout-jump" onClick={() => seekScrub(k.t + (i === 0 && k.t === 0 ? 0 : 0.1))}>
                                <b>{i + 1}</b> from {i === 0 ? 'start' : fmt(k.t)}
                              </button>
                              {i > 0 && (
                                <button className="icon-btn xs ghost" title="Remove" onClick={() => deleteLayout(k.id)}>
                                  <Icon name="x" size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button className="add-seg" onClick={addLayout} title="The streamer moved the cam? Add a new position from the playhead">
                            <Icon name="plus" size={12} /> New position at {fmt(playhead)}
                          </button>
                        </div>
                      </div>
                      <div className="pc-row">
                        <span className="pc-label">Box ratio</span>
                        <Seg
                          size="sm"
                          value={aspectLock ? aspectLock.toFixed(4) : 'free'}
                          onChange={(v) => {
                            const n = v === 'free' ? null : Number(v);
                            setAspectLock(n);
                            if (n && activeKey) {
                              const r = activeKey.rect;
                              onFacecamRect({ ...r, h: Math.min(1 - r.y, (r.w * info.width) / n / info.height) }, true);
                            }
                          }}
                          options={[
                            { value: 'free', label: 'Free' },
                            { value: (16 / 9).toFixed(4), label: '16:9' },
                            { value: (4 / 3).toFixed(4), label: '4:3' },
                            { value: (1).toFixed(4), label: '1:1' },
                          ]}
                        />
                        <span className="pc-hint">Hold Shift while resizing to keep the current ratio.</span>
                      </div>
                    </div>
                  )}
                </SplitChip>
                {facecamOn && (
                  <button className="icon-btn chip-icon" onClick={addLayout} title={`Facecam moved? New position from ${fmt(playhead)}`}>
                    <Icon name="userPlus" size={15} />
                  </button>
                )}
                {topazInfo && topazInfo.found && facecamOn && (
                  <SplitChip
                    on={enhanceOn}
                    icon="sparkles"
                    label={enhanceOn ? `${tzPreset.scale}× ${(topazInfo.models.find((m) => m.id === tzPreset.model) || { family: tzPreset.model }).family}` : 'Enhance'}
                    title="Upscale the facecam with Topaz Video AI after the download"
                    onToggle={() => window.api.setSettings({ topaz: { enabled: !tz.enabled } })}
                  >
                    {({ close }) => (
                      <div className="menu">
                        <span className="menu-head">Topaz Video AI · facecam</span>
                        {tz.presets.map((p) => (
                          <button
                            key={p.id}
                            className={`menu-item ${enhanceOn && p.id === tzPreset.id ? 'on' : ''}`}
                            onClick={() => {
                              window.api.setSettings({ topaz: { enabled: true, preset: p.id } });
                              close();
                            }}
                          >
                            <Icon name="sparkles" size={12} /> {p.name}
                          </button>
                        ))}
                        <button
                          className="menu-item muted"
                          onClick={() => {
                            close();
                            setShowSettings('topaz');
                          }}
                        >
                          <Icon name="settings" size={12} /> Edit presets…
                        </button>
                      </div>
                    )}
                  </SplitChip>
                )}
                <SplitChip on={cropOn} icon="phone" label={`Crop ${cropAspect}`} title="Crop the gameplay (snaps to the center, Alt = free)" onToggle={() => setCropOn((c) => !c)}>
                  {({ close }) => (
                    <div className="menu">
                      {Object.keys(ASPECTS).map((a) => (
                        <button
                          key={a}
                          className={`menu-item ${cropOn && a === cropAspect ? 'on' : ''}`}
                          onClick={() => {
                            changeAspect(a);
                            close();
                          }}
                        >
                          <span className={`ratio-ico r-${a.replace(':', 'x')}`} /> {a}
                        </button>
                      ))}
                      <button
                        className="menu-item muted"
                        onClick={() => {
                          setCropOn(false);
                          close();
                        }}
                      >
                        Full frame (no crop)
                      </button>
                    </div>
                  )}
                </SplitChip>
              </div>
            </div>
            <Timeline
              duration={duration}
              segments={flat}
              activeId={activeId}
              playhead={playhead}
              view={view}
              onView={onView}
              onSeek={(t) => t != null && seekScrub(t)}
              onSelect={setActiveId}
              onChange={(id, p, mode) => updateSeg(id, p, mode, 'lane')}
              onCommit={commitSegs}
              onDelete={(id) => {
                deleteSeg(id);
                toast('Segment deleted — Ctrl+Z to undo', 'info', 1800);
              }}
              onDragState={onLaneDrag}
              onCreate={(s, e) => (flat.length ? addSegment(flat.find((x) => x.id === activeId) ? flat.find((x) => x.id === activeId).clipId : flat[0].clipId, s, e) : addClip(s, e))}
            />
          </section>
          <aside className="sidecol">
            <ClipList
              clips={clips}
              sources={sources}
              activeSrc={activeSrc}
              activeId={activeId}
              settings={settings}
              clipNames={clipNames}
              onSelect={selectSeg}
              onActivateClip={activateClip}
              onChangeSeg={(id, p, which) => updateSeg(id, p, which, 'list')}
              onDeleteSeg={deleteSeg}
              onAddSeg={(cid) => addSegment(cid)}
              onAddClip={() => addClip()}
              onDeleteClip={deleteClip}
              onPlaySeg={(s) => {
                const c = clipsRef.current.find((x) => x.segments.some((y) => y.id === s.id));
                selectSeg(s.id);
                if (c && c.src === activeSrc && player.current) player.current.playRange(s.start, s.end);
              }}
              onFromPlayhead={fromPlayhead}
              onAddLink={() => pasteAndLoad({ append: true }).then((ok) => !ok && toast('Copy a Twitch clip / video link first', 'warn'))}
              onClear={clearClips}
              adding={adding}
            />
          </aside>
        </main>
      )}

      {/* ---------- Output bar ---------- */}
      {info && (
        <footer className="outbar">
          <Popover
            up
            trigger={({ toggle }) => (
              <button className="out-chip" onClick={toggle} title={settings.output.baseDir}>
                <Icon name={settings.output.mode === 'folders' ? 'folders' : 'folder'} size={15} />
                <span className="out-path">{(settings.output.baseDir || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || 'Choose folder'}</span>
                <Icon name="chevronRight" size={12} className="sep" />
                <span className="out-name">{outName}</span>
              </button>
            )}
          >
            {({ close }) => (
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
            )}
          </Popover>

          {clips.length > 1 && (
            <Seg
              value={clipMode}
              onChange={setClipMode}
              title="How multiple clips are saved"
              options={[
                { value: 'separate', label: 'Own folders', icon: 'folders', title: 'Every clip gets its own numbered folder' },
                { value: 'together', label: 'Same folder', icon: 'folder', title: 'All clips as separate files in one folder' },
                { value: 'merge', label: 'Merge', icon: 'merge', title: 'Join all clips into one video' },
              ]}
            />
          )}

          <div className="grow" />

          <SplitChip
            on={premiereOn}
            icon="film"
            label={premiereOn ? `Premiere ${prem.format}` : 'Premiere'}
            title="Build captions + a vertical Premiere sequence after the download"
            onToggle={() => window.api.setSettings({ premiere: { enabled: !premiereOn } })}
          >
            {({ close }) => (
              <div className="pop-card narrow">
                <div className="pc-row">
                  <span className="pc-label">Format</span>
                  <Seg
                    size="sm"
                    value={prem.format}
                    onChange={(v) => window.api.setSettings({ premiere: { format: v, enabled: true } })}
                    options={[
                      { value: '3:4', label: '1440×1920' },
                      { value: '9:16', label: '1440×2560' },
                    ]}
                  />
                </div>
                <div className="pc-row">
                  <span className="pc-label">Facecam height · {Math.round(prem.split * 100)}%</span>
                  <input type="range" min="0.2" max="0.5" step="0.01" value={prem.split} onChange={(e) => window.api.setSettings({ premiere: { split: Number(e.target.value) } })} />
                </div>
                <div className="pc-row two">
                  <label className="row">
                    <span className="pc-label">Captions</span>
                    <Toggle checked={prem.captions.enabled} onChange={(v) => window.api.setSettings({ premiere: { captions: { enabled: v } } })} />
                  </label>
                  <label className="row">
                    <span className="pc-label">Words</span>
                    <Seg size="sm" value={prem.captions.maxWords} onChange={(v) => window.api.setSettings({ premiere: { captions: { maxWords: v } } })} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
                  </label>
                </div>
                <p className="pc-hint">Drag the blue box to choose which part of the gameplay fills the bottom.</p>
                <button
                  className="btn sm full"
                  onClick={() => {
                    close();
                    setShowSettings('premiere');
                  }}
                >
                  <Icon name="settings" size={13} /> All Premiere settings
                </button>
              </div>
            )}
          </SplitChip>

          <span className="out-files">
            <Icon name="film" size={13} /> {settings.output.gameplayName}
            {cropOn ? ` ${cropAspect}` : ''}
            {facecamOn && ss.rect && (
              <>
                {' + '}
                <Icon name="user" size={13} /> {settings.output.facecamName}
              </>
            )}
          </span>

          <Popover
            up
            align="right"
            trigger={({ toggle }) => (
              <button className="out-chip" onClick={toggle} title={usedSrcs.length > 1 ? 'Quality of the video in the player (each source keeps its own)' : 'Quality'}>
                <b>{q ? q.label : '—'}</b>
                <span className="muted">{q ? q.codec : ''}</span>
                {q && q.codec !== 'H.264' && settings.quality.codec === 'convert' && <span className="tag">→ H.264</span>}
                <Icon name="chevronDown" size={12} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="menu tall">
                {info.qualities.map((x) => (
                  <button
                    key={x.key}
                    className={`menu-item ${x.key === ss.quality ? 'on' : ''}`}
                    onClick={() => {
                      patchSrc(activeSrc, { quality: x.key });
                      close();
                    }}
                  >
                    <b>{x.label}</b>
                    <span className="muted">{x.codec}</span>
                    {x.tbr ? <span className="muted r">{fmtBytes((x.tbr * 1000 * Math.max(60, totalDur)) / 8)}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </Popover>

          <button className="dl-btn" onClick={download} title="Download (Ctrl+Enter)">
            <Icon name="download" size={18} />
            <span className="dl-main">Download</span>
            <span className="dl-sub">
              {clips.length ? `${clips.length} clip${clips.length > 1 ? 's' : ''} · ${fmtShort(totalDur)}` : `Full · ${fmtShort(duration)}`}
              {estBytes ? ` · ~${fmtBytes(estBytes)}` : ''}
            </span>
          </button>
        </footer>
      )}

      <Jobs jobs={jobs} open={jobsOpen} onToggle={() => setJobsOpen((o) => !o)} notify={toast} onCaptions={setCapJob} />
      {capJob && <CaptionsEditor job={jobs.find((j) => j.id === capJob.id) || capJob} settings={settings} notify={toast} onClose={() => setCapJob(null)} />}

      {showSettings && <Settings settings={settings} tools={tools} topaz={topazInfo} section={typeof showSettings === 'string' ? showSettings : null} onClose={() => setShowSettings(false)} />}

      {toolSetup && (
        <div className="setup">
          <div className="setup-card">
            <Logo size={40} />
            <h2>Setting up</h2>
            <p>Downloading the latest yt-dlp, FFmpeg and Deno. Only happens once.</p>
            <div className="bar">
              <span style={{ width: `${Math.round((tools.progress.progress || 0) * 100)}%` }} />
            </div>
            <p className="muted">
              {tools.progress.label} {tools.progress.total ? `· ${fmtBytes(tools.progress.bytes)} / ${fmtBytes(tools.progress.total)}` : ''}
            </p>
          </div>
        </div>
      )}
      {tools && tools.error && !toolSetup && (
        <div className="banner err">
          <Icon name="alert" size={14} /> Tool setup failed: {tools.error}
          <button className="chip sm" onClick={() => window.api.updateTools()}>
            Retry
          </button>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
