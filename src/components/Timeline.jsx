import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmt, fmtShort } from '../lib/time.js';
import { frameStyle } from '../lib/storyboard.js';
import { Icon } from './ui.jsx';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const ZOOMS = [30, 60, 300, 900, 3600];
const EDGE = 28; // px at the lane edges that auto-scroll while dragging

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Video thumbnails under the clips, on a fixed time grid so they don't swim while scrolling. */
function Filmstrip({ info, thumbs, view, width, height }) {
  const span = Math.max(1, view.end - view.start);
  const tileW = Math.round((height * 16) / 9);
  if (!width || !info) return null;
  const step = (span * tileW) / width;
  const D = info.duration || view.end;
  const tiles = [];
  for (let t = Math.floor(view.start / step) * step; t < view.end; t += step) {
    if (t + step < 0 || t > D) continue;
    const x = ((t - view.start) / span) * width;
    tiles.push({ t, x, st: frameStyle(info, thumbs, Math.min(D - 0.5, t + step / 2), tileW, height) });
  }
  return (
    <div className="filmstrip">
      {tiles.map(({ t, x, st }) => (
        <span key={t.toFixed(3)} className="fs-tile" style={{ left: x, width: tileW, height, ...(st || {}) }} />
      ))}
    </div>
  );
}

/** Heat (YouTube most-replayed) or Twitch chat activity for the visible window. */
function ActivityTrack({ activity, view, width, onJump }) {
  const span = Math.max(1, view.end - view.start);
  const path = useMemo(() => {
    if (!activity || !width) return null;
    const pts = [];
    if (activity.kind === 'chat' && activity.data) {
      const { counts, step, max } = activity.data;
      const i0 = Math.max(0, Math.floor(view.start / step) - 1);
      const i1 = Math.min(counts.length - 1, Math.ceil(view.end / step) + 1);
      for (let i = i0; i <= i1; i++) pts.push([((i * step + step / 2 - view.start) / span) * width, 1 - Math.min(1, counts[i] / max)]);
    } else if (activity.kind === 'heat' && activity.data) {
      for (const [s, e, v] of activity.data) {
        const m = (s + e) / 2;
        if (e < view.start - span * 0.05 || s > view.end + span * 0.05) continue;
        pts.push([((m - view.start) / span) * width, 1 - v]);
      }
    }
    if (pts.length < 2) return null;
    return `M${pts[0][0].toFixed(1)},100 ${pts.map(([x, y]) => `L${x.toFixed(1)},${(y * 100).toFixed(1)}`).join(' ')} L${pts.at(-1)[0].toFixed(1)},100 Z`;
  }, [activity, view.start, view.end, width]); // eslint-disable-line
  if (!activity) return null;
  const peaks = activity.kind === 'chat' && activity.data ? activity.data.peaks.filter((p) => p.t >= view.start && p.t <= view.end) : [];
  return (
    <div className={`act-track act-${activity.kind}`}>
      {path && (
        <svg className="act-svg" viewBox={`0 0 ${Math.max(1, width)} 100`} preserveAspectRatio="none">
          <path d={path} />
        </svg>
      )}
      {activity.loading && (
        <span className="act-loading">
          <span className="act-bar" style={{ width: `${Math.round((activity.progress || 0) * 100)}%` }} />
          Reading Twitch chat… {Math.round((activity.progress || 0) * 100)}%
        </span>
      )}
      {activity.error && <span className="act-loading err">{activity.error}</span>}
      {peaks.map((p) => (
        <button
          key={p.t}
          className={`act-peak ${p.emote ? 'has-emote' : ''}`}
          style={{ left: ((p.t - view.start) / span) * width }}
          title={`${fmt(p.t)} · chat peak${p.emote ? ` · ${p.emote.name} ×${p.emote.count}` : ''} — click to jump`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onJump(p.t)}
        >
          {p.emote ? <img src={p.emote.url} alt={p.emote.name} draggable={false} /> : <i />}
        </button>
      ))}
    </div>
  );
}

/**
 * NLE-style timeline: ruler (scrub), video lane with thumbnails + clips (drag to mark, edges to trim),
 * activity track. Wheel scrolls, Ctrl/Alt+wheel zooms at the cursor. While a drag runs the window is frozen
 * (pointer always maps to the same time) and scrolls by itself near the edges.
 */
export default function Timeline({
  info,
  thumbs,
  duration,
  segments,
  activeId,
  playhead,
  view,
  onView,
  onSeek,
  onSelect,
  onChange,
  onCreate,
  onCommit,
  onDragState,
  onMenu,
  activity,
  mark,
}) {
  const [lnRef, lnW] = useWidth();
  const zoomRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [ghost, setGhost] = useState(null);
  const drag = useRef(null);
  const auto = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const D = Math.max(1, duration || 1);
  const span = Math.max(1, view.end - view.start);

  const tAt = (clientX, v = view) => {
    const r = lnRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return v.start + (x / Math.max(1, r.width)) * (v.end - v.start);
  };
  const xOf = (t) => ((t - view.start) / span) * lnW;

  const snap = (t, ignoreId, v) => {
    const px = ((v.end - v.start) / Math.max(1, lnW)) * 8;
    const cands = [playhead, mark];
    segments.forEach((s) => s.id !== ignoreId && cands.push(s.start, s.end));
    for (const c of cands) if (c != null && Math.abs(c - t) < px) return c;
    return Math.round(t);
  };

  // ---- wheel: scroll / zoom (needs a non-passive listener to stop the page from scrolling) ----
  useEffect(() => {
    const el = zoomRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      const sp = v.end - v.start;
      const r = lnRef.current.getBoundingClientRect();
      if (e.ctrlKey || e.altKey || e.metaKey) {
        const x = Math.max(0, Math.min(r.width, e.clientX - r.left)) / Math.max(1, r.width);
        const tc = v.start + x * sp;
        const ns = Math.min(D, Math.max(10, sp * Math.exp(e.deltaY * 0.0018)));
        const s = Math.max(0, Math.min(D - ns, tc - x * ns));
        onView({ start: s, end: s + ns }, { free: true });
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const dt = (delta / 420) * sp;
        const s = Math.max(0, Math.min(D - sp, v.start + dt));
        onView({ start: s, end: s + sp }, { free: true });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [D, onView]); // eslint-disable-line

  const begin = (e, d) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { ...d, v: { ...view }, x0: e.clientX, lastX: e.clientX, moved: false };
    onDragState && onDragState(true);
  };
  const end = () => {
    cancelAnimationFrame(auto.current);
    auto.current = 0;
    drag.current = null;
    onDragState && onDragState(false);
  };

  const rulerDown = (e) => {
    if (e.button !== 0) return;
    begin(e, { kind: 'scrub' });
    onSeek(tAt(e.clientX, drag.current.v), 'move');
  };
  const segDown = (seg, mode) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(seg.id);
    begin(e, { kind: 'seg', mode, id: seg.id, s0: seg.start, e0: seg.end });
    drag.current.t0 = tAt(e.clientX, drag.current.v);
  };
  const laneDown = (e) => {
    if (e.button !== 0) return;
    begin(e, { kind: 'create' });
    drag.current.t0 = snap(tAt(e.clientX, drag.current.v), null, drag.current.v);
  };

  const apply = (clientX) => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(clientX, d.v);
    if (Math.abs(clientX - d.x0) > 3) d.moved = true;
    if (d.kind === 'scrub') return onSeek(t, 'move');
    if (d.kind === 'create') {
      if (d.moved) {
        const t1 = snap(t, null, d.v);
        setGhost({ start: Math.max(0, Math.min(d.t0, t1)), end: Math.min(D, Math.max(d.t0, t1)) });
      }
      return;
    }
    if (d.kind === 'seg' && d.moved) {
      const dt = t - d.t0;
      let s = d.s0;
      let en = d.e0;
      if (d.mode === 'move') {
        const len = d.e0 - d.s0;
        s = Math.round(Math.max(0, Math.min(D - len, d.s0 + dt)));
        const sn = snap(s, d.id, d.v);
        if (sn !== s) s = sn;
        else {
          const se = snap(s + len, d.id, d.v);
          if (se !== s + len) s = se - len;
        }
        en = s + len;
      } else if (d.mode === 'start') s = Math.max(0, Math.min(d.e0 - 1, snap(d.s0 + dt, d.id, d.v)));
      else en = Math.min(D, Math.max(d.s0 + 1, snap(d.e0 + dt, d.id, d.v)));
      onChange(d.id, { start: s, end: en }, d.mode);
    }
  };

  // scroll the frozen window while the pointer rests near an edge
  const autoPan = () => {
    const d = drag.current;
    if (!d || !lnRef.current) return (auto.current = 0);
    const r = lnRef.current.getBoundingClientRect();
    const dl = d.lastX - r.left;
    const dr = r.right - d.lastX;
    const sp = d.v.end - d.v.start;
    let dir = 0;
    if (dl < EDGE) dir = -(1 - Math.max(0, dl) / EDGE);
    else if (dr < EDGE) dir = 1 - Math.max(0, dr) / EDGE;
    if (!dir || (dir < 0 && d.v.start <= 0) || (dir > 0 && d.v.end >= D)) return (auto.current = 0);
    const shift = dir * sp * 0.025;
    const s = Math.max(0, Math.min(D - sp, d.v.start + shift));
    d.v = { start: s, end: s + sp };
    onView(d.v, { free: true });
    apply(d.lastX);
    auto.current = requestAnimationFrame(autoPan);
  };

  const move = (e) => {
    const r = lnRef.current.getBoundingClientRect();
    const d = drag.current;
    if (!d) {
      setHover({ x: e.clientX - r.left, t: tAt(e.clientX) });
      return;
    }
    d.lastX = e.clientX;
    apply(e.clientX);
    if (!auto.current && d.moved && (e.clientX - r.left < EDGE || r.right - e.clientX < EDGE)) auto.current = requestAnimationFrame(autoPan);
  };

  const up = (e) => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(e.clientX, d.v);
    if (d.kind === 'scrub') onSeek(t, 'end');
    if (d.kind === 'create') {
      if (d.moved && ghost && ghost.end - ghost.start >= 1) onCreate(ghost.start, ghost.end);
      else {
        onSelect(null);
        onSeek(t, 'click');
      }
      setGhost(null);
    }
    if (d.kind === 'seg') {
      if (!d.moved) onSeek(t, 'click');
      onCommit && onCommit();
    }
    end();
  };

  const step = STEPS.find((s) => (s / span) * lnW >= 84) || 7200;
  const ticks = [];
  if (lnW > 0) for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) ticks.push(t);
  const minor = step / (step >= 60 ? 6 : 5);
  const minorTicks = [];
  if (lnW > 0 && (minor / span) * lnW >= 8) for (let t = Math.ceil(view.start / minor) * minor; t <= view.end; t += minor) minorTicks.push(t);

  const zoomTo = (len) => {
    len = Math.min(D, Math.max(10, len));
    const c = playhead != null ? playhead : (view.start + view.end) / 2;
    const s = Math.max(0, Math.min(D - len, c - len / 2));
    onView({ start: s, end: s + len });
  };
  const fitActive = () => {
    const a = segments.find((s) => s.id === activeId);
    if (!a) return zoomTo(span);
    const len = Math.max(20, (a.end - a.start) * 1.6);
    const s = Math.max(0, Math.min(D - len, (a.start + a.end) / 2 - len / 2));
    onView({ start: s, end: s + len }, { free: true });
  };

  const ph = playhead || 0;
  const zoomOpts = ZOOMS.filter((z) => z < D * 1.2);
  const laneH = 60;
  const showAct = !!activity;
  return (
    <div className="timeline">
      <div className="zbar">
        <span className="zspan">
          {fmt(view.start)} – {fmt(view.end)}
        </span>
        <span className="zhint">Wheel scrolls · Ctrl + wheel zooms</span>
        <div className="zgap" />
          {zoomOpts.length > 1 && (
            <div className="seg seg-sm" role="radiogroup" title="Visible range (Ctrl + wheel zooms at the cursor)">
              {zoomOpts.map((z) => (
                <button key={z} className={Math.abs(span - z) < 1 ? 'on' : ''} onClick={() => zoomTo(z)}>
                  <span>{fmtShort(z)}</span>
                </button>
              ))}
              <button onClick={fitActive} title="Fit the selected clip">
                <span>Fit</span>
              </button>
            </div>
          )}
          <button className="icon-btn xs" onClick={() => zoomTo(span / 2)} title="Zoom in (Ctrl + wheel)">
            <Icon name="zoomIn" size={14} />
          </button>
          <button className="icon-btn xs" onClick={() => zoomTo(span * 2)} title="Zoom out (Ctrl + wheel)">
            <Icon name="zoomOut" size={14} />
          </button>
      </div>
      <div className="tl-grid">
        <div className="tl-heads">
          <div className="tl-head ruler-head" />
          <div className="tl-head lane-head" title="Clips" style={{ height: laneH }}>
            <Icon name="film" size={14} />
          </div>
          {showAct && (
            <div className="tl-head act-head" title={activity.kind === 'chat' ? 'Twitch chat activity' : 'Most replayed'}>
              <Icon name={activity.kind === 'chat' ? 'chat' : 'flame'} size={13} />
            </div>
          )}
        </div>
        <div className="zoom" ref={zoomRef} onPointerLeave={() => setHover(null)}>
          <div ref={lnRef} className="tl-measure" />
          <div className="ruler" onPointerDown={rulerDown} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag to scrub · wheel to scroll">
            {minorTicks.map((t) => (
              <span key={'m' + t} className="tick minor" style={{ left: xOf(t) }} />
            ))}
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: xOf(t) }}>
                <em>{fmt(t)}</em>
              </span>
            ))}
          </div>
          <div
            className="lane"
            style={{ height: laneH }}
            onPointerDown={laneDown}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={(e) => onMenu && onMenu(e, null, tAt(e.clientX))}
          >
            <Filmstrip info={info} thumbs={thumbs} view={view} width={lnW} height={laneH} />
            {!segments.some((s) => s.end > view.start && s.start < view.end) && !ghost && mark == null && (
              <span className="lane-hint">Drag here to mark a clip · or I / O at the playhead</span>
            )}
            {mark != null && mark >= view.start - span && mark <= view.end + span && (
              <>
                {ph > mark && <span className="lane-pending" style={{ left: xOf(Math.max(view.start, mark)), width: Math.max(0, xOf(Math.min(view.end, ph)) - xOf(Math.max(view.start, mark))) }} />}
                <span className="lane-mark" style={{ left: xOf(mark) }}>
                  <em>IN</em>
                </span>
              </>
            )}
            {segments
              .filter((s) => s.end > view.start && s.start < view.end)
              .map((s) => {
                const x0 = xOf(Math.max(s.start, view.start));
                const x1 = xOf(Math.min(s.end, view.end));
                return (
                  <div
                    key={s.id}
                    className={`tseg ${s.id === activeId ? 'active' : ''} ${s.off ? 'off' : ''}`}
                    style={{ left: x0, width: Math.max(4, x1 - x0), '--c': s.color }}
                    onPointerDown={segDown(s, 'move')}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    onDoubleClick={fitActive}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      onSelect(s.id);
                      onMenu && onMenu(e, s, tAt(e.clientX));
                    }}
                    title="Drag to move · edges to trim · right-click for options"
                  >
                    {s.start >= view.start && <span className="seg-h l" onPointerDown={segDown(s, 'start')} onPointerMove={move} onPointerUp={up} />}
                    <span className="seg-label">
                      <b>{s.label}</b>
                      <span>{fmtShort(s.end - s.start)}</span>
                    </span>
                    {s.end <= view.end && <span className="seg-h r" onPointerDown={segDown(s, 'end')} onPointerMove={move} onPointerUp={up} />}
                  </div>
                );
              })}
            {ghost && (
              <div className="tseg ghost" style={{ left: xOf(ghost.start), width: Math.max(2, xOf(ghost.end) - xOf(ghost.start)) }}>
                <span className="seg-label">
                  <span>{fmtShort(ghost.end - ghost.start)}</span>
                </span>
              </div>
            )}
          </div>
          {showAct && <ActivityTrack activity={activity} view={view} width={lnW} onJump={(t) => onSeek(Math.max(0, t - 12), 'click')} />}
          {ph >= view.start && ph <= view.end && (
            <span className="z-playhead" style={{ left: xOf(ph) }}>
              <span className="z-knob">{fmt(ph)}</span>
            </span>
          )}
          {hover && !drag.current && (
            <span className="z-hover" style={{ left: hover.x }}>
              <em>{fmt(hover.t)}</em>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
