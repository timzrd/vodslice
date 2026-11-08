import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Player from './components/Player.jsx';
import Timeline from './components/Timeline.jsx';
import ClipList from './components/ClipList.jsx';
import Settings from './components/Settings.jsx';
import Jobs, { ACTIVE } from './components/Jobs.jsx';
import Logo from './components/Logo.jsx';
import { Icon, Seg, Popover, Spinner, Kbd } from './components/ui.jsx';
import { fmt, fmtShort, fmtBytes, extractUrl, SUPPORTED } from './lib/time.js';
import { detectFacecam, sampleTimes } from './lib/facecam.js';

const PALETTE = ['#ffd23f', '#3ddc84', '#39c6ff', '#ff6fae', '#ff9f43', '#a78bfa', '#2dd4bf', '#f87171'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
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

export default function App() {
  const [settings, setSettings] = useState(null);
  const [tools, setTools] = useState(null);
  const [urlText, setUrlText] = useState('');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clips, setClips] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [view, setView] = useState({ start: 0, end: 60 });
  const [facecam, setFacecam] = useState({ enabled: true, rect: null, confidence: null, source: null });
  const [detecting, setDetecting] = useState(null);
  const [crop, setCrop] = useState({ enabled: false, x: null });
  const [editBoxes, setEditBoxes] = useState(true);
  const [aspectLock, setAspectLock] = useState(null);
  const [quality, setQuality] = useState(null);
  const [clipMode, setClipMode] = useState('separate');
  const [startNumber, setStartNumber] = useState(null);
  const [peek, setPeek] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [jobsOpen, setJobsOpen] = useState(true);
  const [history, setHistory] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [miniOn, setMiniOn] = useState(false);
  const [toasts, toast] = useToasts();
  const player = useRef(null);
  const colorIdx = useRef(0);
  const lastPh = useRef(0);
  const urlInput = useRef(null);
  const loadingUrl = useRef(null);
  const settingsRef = useRef(null);
  settingsRef.current = settings;

  // ---------- boot ----------
  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.toolsStatus().then((t) => setTools({ status: t, progress: t.progress, error: t.error }));
    window.api.jobs().then(setJobs);
    window.api.history().then(setHistory);
    window.api.miniState().then(setMiniOn);
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

  // ---------- segments ----------
  const flat = useMemo(
    () =>
      clips.flatMap((c, ci) =>
        c.segments.map((s, si) => ({ ...s, clipId: c.id, clipIdx: ci, label: c.segments.length > 1 ? `${ci + 1}${LETTERS[si]}` : `${ci + 1}` }))
      ),
    [clips]
  );
  const activeSeg = flat.find((s) => s.id === activeId) || null;
  const duration = info ? info.duration : 0;

  const newSeg = (start, end) => {
    const color = PALETTE[colorIdx.current++ % PALETTE.length];
    return { id: nid('s'), start: Math.round(start), end: Math.round(end), color };
  };

  const fitView = useCallback(
    (s, e) => {
      const D = duration || 1;
      const len = Math.min(D, Math.max(30, (e - s) * 1.7));
      const st = Math.max(0, Math.min(D - len, (s + e) / 2 - len / 2));
      setView({ start: st, end: st + len });
    },
    [duration]
  );

  const sortSegs = (segs) => [...segs].sort((a, b) => a.start - b.start);

  const updateSeg = useCallback(
    (id, patch, fromList) => {
      setClips((cs) =>
        cs.map((c) => ({
          ...c,
          segments: c.segments.map((s) => {
            if (s.id !== id) return s;
            const n = { ...s, ...patch };
            const len = s.end - s.start;
            // moving one edge past the other drags the whole segment along
            if (patch.start != null && patch.end == null && n.start >= s.end) n.end = Math.min(duration || 1e9, n.start + len);
            if (patch.end != null && patch.start == null && n.end <= s.start) n.start = Math.max(0, n.end - len);
            n.start = Math.max(0, Math.min(n.start, (duration || 1e9) - 1));
            n.end = Math.max(n.start + 1, Math.min(n.end, duration || 1e9));
            return n;
          }),
        }))
      );
      if (fromList) {
        const t = patch.start != null ? patch.start : patch.end;
        if (t != null && player.current) player.current.seek(t);
        const s = flat.find((x) => x.id === id);
        if (s) {
          const ns = patch.start ?? s.start;
          const ne = patch.end ?? s.end;
          if (ns < view.start || ne > view.end) fitView(ns, ne);
        }
      }
    },
    [duration, flat, view, fitView]
  );

  const commitSegs = () => setClips((cs) => cs.map((c) => ({ ...c, segments: sortSegs(c.segments) })));

  const addClip = useCallback(
    (start, end) => {
      const t = start ?? Math.floor(player.current ? player.current.time : playhead);
      const e = end ?? Math.min(duration, t + 30);
      const s = newSeg(Math.min(t, Math.max(0, duration - 1)), Math.max(e, t + 1));
      setClips((cs) => [...cs, { id: nid('c'), segments: [s] }]);
      setActiveId(s.id);
      fitView(s.start, s.end);
    },
    [duration, playhead, fitView]
  );

  const addSegment = useCallback(
    (clipId, start, end) => {
      const t = start ?? Math.floor(player.current ? player.current.time : playhead);
      const e = end ?? Math.min(duration, t + 30);
      const s = newSeg(t, Math.max(e, t + 1));
      setClips((cs) => {
        if (!cs.length) return [{ id: nid('c'), segments: [s] }];
        const target = clipId || (cs.find((c) => c.segments.some((x) => x.id === activeId)) || cs.at(-1)).id;
        return cs.map((c) => (c.id === target ? { ...c, segments: sortSegs([...c.segments, s]) } : c));
      });
      setActiveId(s.id);
      fitView(s.start, s.end);
    },
    [duration, playhead, activeId, fitView]
  );

  const deleteSeg = (id) => {
    setClips((cs) => cs.map((c) => ({ ...c, segments: c.segments.filter((s) => s.id !== id) })).filter((c) => c.segments.length));
    if (activeId === id) setActiveId(null);
  };
  const deleteClip = (cid) => setClips((cs) => cs.filter((c) => c.id !== cid));

  const fromPlayhead = (id, edge) => {
    const t = Math.round(player.current ? player.current.time : playhead);
    const s = flat.find((x) => x.id === id);
    if (!s) return;
    if (edge === 'start') updateSeg(id, t >= s.end ? { start: t, end: Math.min(duration, t + Math.max(10, s.end - s.start)) } : { start: t });
    else updateSeg(id, t <= s.start ? { end: t, start: Math.max(0, t - Math.max(10, s.end - s.start)) } : { end: t });
    setActiveId(id);
  };

  const selectFromList = (id) => {
    setActiveId(id);
    const s = flat.find((x) => x.id === id);
    if (s) {
      fitView(s.start, s.end);
      player.current && player.current.seek(s.start);
    }
  };

  // draft persistence per video
  useEffect(() => {
    if (!info) return;
    try {
      localStorage.setItem(`draft:${info.cacheId}`, JSON.stringify({ clips, at: Date.now() }));
    } catch {}
  }, [clips, info]);

  // ---------- loading ----------
  const load = useCallback(
    async (raw) => {
      const url = extractUrl(raw) || raw.trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        toast('That is not a link', 'warn');
        return;
      }
      if (loadingUrl.current === url) return;
      loadingUrl.current = url;
      setUrlText(url);
      setLoading(true);
      setError(null);
      try {
        const inf = await window.api.probe(url);
        if (loadingUrl.current !== url) return;
        if (inf.isLive) throw new Error('This stream is still live — wait for the VOD to finish.');
        const s = settingsRef.current;
        setInfo(inf);
        setQuality(inf.defaultQuality);
        setClipMode(s.output.clipMode);
        setStartNumber(null);
        setPlayhead(inf.startHint || 0);
        // restore draft or create a first clip
        let restored = null;
        try {
          const d = JSON.parse(localStorage.getItem(`draft:${inf.cacheId}`) || 'null');
          if (d && d.clips && d.clips.length && !inf.startHint) restored = d.clips;
        } catch {}
        if (restored) {
          setClips(restored);
          const first = restored[0].segments[0];
          setActiveId(first.id);
          const len = Math.min(inf.duration, Math.max(30, (first.end - first.start) * 1.7));
          const st = Math.max(0, Math.min(inf.duration - len, (first.start + first.end) / 2 - len / 2));
          setView({ start: st, end: st + len });
        } else {
          const st0 = Math.min(inf.startHint || 0, Math.max(0, inf.duration - 2));
          const seg = { id: nid('s'), start: st0, end: Math.min(inf.duration, st0 + 60), color: PALETTE[colorIdx.current++ % PALETTE.length] };
          setClips([{ id: nid('c'), segments: [seg] }]);
          setActiveId(seg.id);
          const len = Math.min(inf.duration, 180);
          const vs = Math.max(0, Math.min(inf.duration - len, st0 - 30));
          setView({ start: vs, end: vs + len });
        }
        const preset = (s.facecamPresets || {})[inf.channelKey];
        const defaultBox = { x: 0.7, y: 0.62, w: 0.28, h: 0.35 };
        setFacecam({
          enabled: s.facecam.enabled,
          rect: preset || (s.facecam.autoDetect ? null : defaultBox),
          confidence: preset ? 'saved' : null,
          source: preset ? 'saved' : null,
        });
        const cp = (s.cropPresets || {})[inf.channelKey];
        setCrop({ enabled: s.gameplay.crop === '9x16', x: cp ? cp.x : null });
        if (s.facecam.enabled && !preset && s.facecam.autoDetect) setTimeout(() => runDetectRef.current && runDetectRef.current(inf), 300);
      } catch (e) {
        if (loadingUrl.current === url) setError(e.message || String(e));
      } finally {
        if (loadingUrl.current === url) {
          setLoading(false);
          loadingUrl.current = null;
        }
      }
    },
    [toast]
  );

  const pasteAndLoad = useCallback(async () => {
    const text = await window.api.readClipboard();
    const u = extractUrl(text);
    if (u && SUPPORTED.test(u)) {
      if (!info || (u !== info.url && u !== urlText)) load(u);
      else urlInput.current && urlInput.current.select();
      return true;
    }
    return false;
  }, [info, urlText, load]);

  // ---------- facecam ----------
  const savePreset = useCallback((key, rect) => {
    const s = settingsRef.current;
    window.api.replaceSetting('facecamPresets', { ...(s.facecamPresets || {}), [key]: rect });
  }, []);

  const runDetect = useCallback(
    async (inf = info) => {
      if (!inf || detecting) return;
      try {
        setDetecting('Grabbing frames…');
        const segs = clips.flatMap((c) => c.segments);
        const frames = await window.api.frames(inf.cacheId, sampleTimes(inf.duration, segs, 14), 480);
        if (!frames.length) throw new Error('Could not grab frames');
        const res = await detectFacecam(frames, setDetecting);
        if (!res) {
          toast('No facecam found — draw the box yourself', 'warn');
          setFacecam((f) => ({ ...f, enabled: true, rect: f.rect || { x: 0.7, y: 0.62, w: 0.28, h: 0.35 }, confidence: 'low', source: 'manual' }));
        } else {
          setFacecam({ enabled: true, rect: res.rect, confidence: res.confidence, source: 'detected' });
          if (res.confidence !== 'low') savePreset(inf.channelKey, res.rect);
          toast(res.message, res.confidence === 'low' ? 'warn' : 'ok');
        }
      } catch (e) {
        toast(`Detection failed: ${e.message}`, 'err');
      } finally {
        setDetecting(null);
      }
    },
    [info, clips, detecting, toast, savePreset]
  );
  const runDetectRef = useRef(null);
  runDetectRef.current = runDetect;

  const toggleFacecam = () => {
    setFacecam((f) => {
      const enabled = !f.enabled;
      if (enabled && !f.rect) {
        const s = settingsRef.current;
        const preset = info && (s.facecamPresets || {})[info.channelKey];
        return { ...f, enabled, rect: preset || { x: 0.7, y: 0.62, w: 0.28, h: 0.35 }, source: preset ? 'saved' : 'manual' };
      }
      return { ...f, enabled };
    });
  };

  const onFacecamRect = useCallback(
    (rect, final) => {
      setFacecam((f) => ({ ...f, rect, confidence: 'manual', source: 'manual' }));
      if (final && info) savePreset(info.channelKey, rect);
    },
    [info, savePreset]
  );
  const onCropX = useCallback(
    (x, final) => {
      setCrop((c) => ({ ...c, x }));
      if (final && info) window.api.replaceSetting('cropPresets', { ...(settingsRef.current.cropPresets || {}), [info.channelKey]: { x } });
    },
    [info]
  );

  // ---------- player ----------
  const onTime = useCallback((t) => {
    const now = performance.now();
    if (now - lastPh.current > 60) {
      lastPh.current = now;
      setPlayhead(t);
    }
  }, []);
  const onPlayState = useCallback((p) => setPlaying(p), []);
  const seekScrub = useCallback((t) => {
    if (t == null || !player.current) return;
    player.current.seek(t);
    setPlayhead(t);
  }, []);

  // keep the zoom window following the playhead while playing
  useEffect(() => {
    if (!playing) return;
    const span = view.end - view.start;
    if (playhead > view.end || playhead < view.start) {
      const s = Math.max(0, Math.min(duration - span, playhead - span * 0.1));
      setView({ start: s, end: s + span });
    }
  }, [playhead, playing]); // eslint-disable-line

  // ---------- naming ----------
  useEffect(() => {
    if (!info || !settings) return;
    window.api.peekName({ channelKey: info.channelKey, channel: info.channel, title: info.title }).then(setPeek);
  }, [info, settings, jobs.length]);

  const effectiveMode = clips.length > 1 ? clipMode : 'merge';
  const firstNum = startNumber || (peek && peek.next) || 1;
  const chanName = peek ? peek.channel : info ? info.channel : '';
  const tmpl = settings ? settings.output.template : '{channel} {n}';
  const clipNames = clips.map((c, i) =>
    clips.length <= 1
      ? renderName(tmpl, chanName, firstNum, info && info.title)
      : effectiveMode === 'separate' ? renderName(tmpl, chanName, firstNum + i, info && info.title) : effectiveMode === 'together' ? `${renderName(tmpl, chanName, firstNum, info && info.title)} · Clip ${i + 1}` : `${renderName(tmpl, chanName, firstNum, info && info.title)} · merged`
  );
  const outName =
    effectiveMode === 'separate' && clips.length > 1
      ? `${renderName(tmpl, chanName, firstNum, info && info.title)} – ${firstNum + clips.length - 1}`
      : renderName(tmpl, chanName, firstNum, info && info.title);

  // ---------- download ----------
  const q = info && info.qualities.find((x) => x.key === quality);
  const totalDur = clips.length ? flat.reduce((a, s) => a + (s.end - s.start), 0) : duration;
  const estBytes = q && q.tbr ? (q.tbr * 1000 * totalDur) / 8 : 0;

  const download = useCallback(async () => {
    if (!info) return;
    const s = settingsRef.current;
    const aspect = info.width / info.height;
    const cw = (9 / 16) / aspect;
    const spec = {
      url: info.url,
      cacheId: info.cacheId,
      title: info.title,
      channel: info.channel,
      channelKey: info.channelKey,
      duration: info.duration,
      thumbnail: info.thumbnail,
      quality,
      qualityLabel: q ? `${q.label} ${q.codec}` : '',
      clipMode: effectiveMode,
      clips: clips.map((c) => ({ segments: c.segments.map((x) => ({ start: x.start, end: x.end })) })),
      facecam: facecam.enabled && facecam.rect ? { enabled: true, rect: facecam.rect } : null,
      gameplayCrop: crop.enabled ? { mode: '9x16', x: typeof crop.x === 'number' ? crop.x : (1 - cw) / 2 } : { mode: 'full' },
      startNumber: startNumber || null,
      baseDir: s.output.baseDir,
    };
    try {
      const job = await window.api.addJob(spec);
      toast(`Downloading → ${job.names.join(', ')}`, 'ok');
      setStartNumber(null);
      setJobsOpen(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  }, [info, quality, q, effectiveMode, clips, facecam, crop, startNumber, toast]);

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if (showSettings) return;
      const typing = isTyping(document.activeElement);
      const k = e.key;
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
      switch (k) {
        case ' ':
          e.preventDefault();
          p && p.toggle();
          break;
        case 'j':
        case 'J':
          p && p.nudge(-10);
          break;
        case 'l':
        case 'L':
          p && p.nudge(10);
          break;
        case 'k':
        case 'K':
          p && p.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          p && p.nudge(e.shiftKey ? -1 : -5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          p && p.nudge(e.shiftKey ? 1 : 5);
          break;
        case 'i':
        case 'I':
          if (activeId) fromPlayhead(activeId, 'start');
          else addClip();
          break;
        case 'o':
        case 'O':
          if (activeId) fromPlayhead(activeId, 'end');
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
    window.__vs = { load, download, runDetect, addClip, addSegment, setView, seek: seekScrub, state: () => ({ info, clips, facecam, view, playhead, detecting, jobs }) };
  });

  // drop a link anywhere
  useEffect(() => {
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const u = extractUrl(t);
      if (u) load(u);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [load]);

  if (!settings) return <div className="boot" />;

  const toolSetup = tools && tools.progress && tools.progress.setup;
  const activeJobs = jobs.filter((j) => ACTIVE.includes(j.status));

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
            placeholder="Click to paste a YouTube or Twitch link"
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
              <span className={`site site-${info.site}`}>{info.site === 'twitch' ? 'Twitch' : info.site === 'youtube' ? 'YouTube' : info.site}</span>
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
              onCropX={onCropX}
              editBoxes={editBoxes}
              aspectLock={aspectLock}
              onTime={onTime}
              onPlayState={onPlayState}
            />
            <div className="controls">
              <div className="ctl-group">
                <button className="icon-btn play" onClick={() => player.current && player.current.toggle()} title="Play / pause (Space)">
                  <Icon name={playing ? 'pause' : 'play'} size={16} />
                </button>
                <button className="icon-btn" onClick={() => player.current && player.current.nudge(-10)} title="Back 10 s (J)">
                  <Icon name="back10" size={15} />
                </button>
                <button className="icon-btn" onClick={() => player.current && player.current.nudge(10)} title="Forward 10 s (L)">
                  <Icon name="fwd10" size={15} />
                </button>
                <span className="clock">
                  <b>{fmt(playhead, { forceHours: duration >= 3600 })}</b> / {fmt(duration)}
                </span>
                <button
                  className="icon-btn"
                  title="Mute"
                  onClick={() => {
                    const m = !muted;
                    setMuted(m);
                    player.current && player.current.setMuted(m);
                  }}
                >
                  <Icon name={muted ? 'mute' : 'volume'} size={15} />
                </button>
              </div>
              <div className="ctl-group mark">
                <button className="mark-btn" onClick={() => (activeId ? fromPlayhead(activeId, 'start') : addClip())} title="Set start of selected segment to playhead (I)">
                  <Icon name="in" size={13} /> IN <Kbd>I</Kbd>
                </button>
                <button className="mark-btn" disabled={!activeId} onClick={() => activeId && fromPlayhead(activeId, 'end')} title="Set end of selected segment to playhead (O)">
                  OUT <Icon name="out" size={13} /> <Kbd>O</Kbd>
                </button>
                {activeSeg && (
                  <button className="icon-btn" title="Play selected segment" onClick={() => player.current && player.current.playRange(activeSeg.start, activeSeg.end)}>
                    <Icon name="scissors" size={15} />
                  </button>
                )}
              </div>
              <div className="ctl-group right">
                <button className={`chip ${facecam.enabled ? 'on' : ''}`} onClick={toggleFacecam} title="Export the facecam as its own file (F)">
                  <Icon name="user" size={13} /> Facecam
                </button>
                {facecam.enabled && (
                  <>
                    <button className="chip" onClick={() => runDetect()} disabled={!!detecting} title="Find the facecam automatically (D)">
                      {detecting ? <Spinner size={12} /> : <Icon name="sparkles" size={13} />} {detecting || 'Detect'}
                    </button>
                    <Popover
                      align="right"
                      up
                      trigger={({ toggle }) => (
                        <button className="chip" onClick={toggle} title="Lock box aspect ratio">
                          <Icon name="crop" size={13} /> Box {aspectLock ? { 1.7778: '16:9', 1.3333: '4:3', 1: '1:1', 0.5625: '9:16' }[aspectLock.toFixed(4)] || 'Lock' : 'Free'}
                        </button>
                      )}
                    >
                      {({ close }) => (
                        <div className="menu">
                          {[
                            [null, 'Free'],
                            [16 / 9, '16:9'],
                            [4 / 3, '4:3'],
                            [1, '1:1'],
                            [9 / 16, '9:16'],
                          ].map(([v, l]) => (
                            <button
                              key={l}
                              className={`menu-item ${aspectLock === v ? 'on' : ''}`}
                              onClick={() => {
                                setAspectLock(v);
                                if (v && facecam.rect) {
                                  const r = facecam.rect;
                                  const h = (r.w * info.width) / v / info.height;
                                  onFacecamRect({ ...r, h: Math.min(1 - r.y, h) }, true);
                                }
                                close();
                              }}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      )}
                    </Popover>
                  </>
                )}
                <button className={`chip ${crop.enabled ? 'on' : ''}`} onClick={() => setCrop((c) => ({ ...c, enabled: !c.enabled }))} title="Crop gameplay to vertical 9:16">
                  <Icon name="phone" size={13} /> 9:16
                </button>
              </div>
            </div>
            <Timeline
              duration={duration}
              segments={flat}
              activeId={activeId}
              playhead={playhead}
              heatmap={info.heatmap}
              chapters={info.chapters}
              storyboard={info.storyboard}
              view={view}
              onView={setView}
              onSeek={seekScrub}
              onSelect={setActiveId}
              onChange={(id, p) => updateSeg(id, p, false)}
              onCommit={commitSegs}
              onCreate={(s, e) => (clips.length ? addSegment(null, s, e) : addClip(s, e))}
            />
          </section>
          <aside className="sidecol">
            <ClipList
              clips={clips}
              activeId={activeId}
              duration={duration}
              settings={settings}
              clipNames={clipNames}
              onSelect={selectFromList}
              onChangeSeg={updateSeg}
              onCommit={commitSegs}
              onDeleteSeg={deleteSeg}
              onAddSeg={(cid) => addSegment(cid)}
              onAddClip={() => addClip()}
              onDeleteClip={deleteClip}
              onPlaySeg={(s) => {
                setActiveId(s.id);
                player.current && player.current.playRange(s.start, s.end);
              }}
              onFromPlayhead={fromPlayhead}
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
                <div className="pc-row two">
                  <label>
                    <span className="pc-label">Name</span>
                    <input
                      className="input sm"
                      value={(settings.output.aliases || {})[info.channelKey] ?? ''}
                      placeholder={info.channel}
                      onChange={(e) => window.api.replaceSetting('output.aliases', { ...(settings.output.aliases || {}), [info.channelKey]: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="pc-label">Number</span>
                    <input
                      className="input sm num"
                      type="number"
                      min="1"
                      value={startNumber ?? ''}
                      placeholder={String((peek && peek.next) || 1)}
                      onChange={(e) => setStartNumber(e.target.value ? Number(e.target.value) : null)}
                    />
                  </label>
                </div>
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
                      ? `Next free number in this folder: ${(peek && peek.next) || 1}.`
                      : `Your counter for ${chanName} is at ${(peek && peek.next) || 1}.`}
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

          <span className="out-files">
            <Icon name="film" size={13} /> {settings.output.gameplayName}
            {crop.enabled ? ' 9:16' : ''}
            {facecam.enabled && facecam.rect && (
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
              <button className="out-chip" onClick={toggle}>
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
                    className={`menu-item ${x.key === quality ? 'on' : ''}`}
                    onClick={() => {
                      setQuality(x.key);
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

      <Jobs jobs={jobs} open={jobsOpen} onToggle={() => setJobsOpen((o) => !o)} />

      {showSettings && <Settings settings={settings} tools={tools} onClose={() => setShowSettings(false)} />}

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

function Empty({ loading, error, onPaste, history, settings }) {
  const recent = (history || []).filter((h) => h.outputs && h.outputs.length).slice(0, 6);
  return (
    <main className="empty">
      <div className="hero">
        <button className={`paste-zone ${loading ? 'loading' : ''}`} onClick={onPaste} disabled={loading}>
          {loading ? <Spinner size={28} /> : <Icon name="link" size={30} />}
          <span className="pz-title">{loading ? 'Reading video…' : 'Paste a link'}</span>
          <span className="pz-sub">
            {loading ? 'Getting formats, length and preview' : (
              <>
                YouTube & Twitch VODs · click here or press <Kbd>Ctrl V</Kbd>
              </>
            )}
          </span>
        </button>
        {error && (
          <div className="hero-err">
            <Icon name="alert" size={14} /> {error}
          </div>
        )}
        <div className="hero-feats">
          <span>
            <Icon name="scissors" size={14} /> Only the parts you need
          </span>
          <span>
            <Icon name="user" size={14} /> Facecam as its own file
          </span>
          <span>
            <Icon name="folders" size={14} /> Auto-numbered folders
          </span>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <div className="recent-head">
            <span className="h-title">Recent</span>
            <button className="chip sm" onClick={() => window.api.openPath(settings.output.baseDir)}>
              <Icon name="folder" size={12} /> Open main folder
            </button>
          </div>
          <div className="recent-grid">
            {recent.map((h) => (
              <div key={h.id} className="recent-card">
                <div className="rc-thumb" style={h.thumbnail ? { backgroundImage: `url("${h.thumbnail}")` } : undefined} />
                <div className="rc-body">
                  <b>{h.outputs.map((o) => o.name).join(', ')}</b>
                  <span className="muted">{h.title}</span>
                </div>
                <div className="rc-actions">
                  <span
                    className="drag-out"
                    draggable
                    title="Drag files into your editor"
                    onDragStart={(e) => {
                      e.preventDefault();
                      window.api.startDrag(h.outputs.flatMap((o) => o.files));
                    }}
                  >
                    <Icon name="grip" size={14} />
                  </span>
                  <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(h.outputs[0].dir)}>
                    <Icon name="folder" size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
