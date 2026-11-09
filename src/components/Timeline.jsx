import { useLayoutEffect, useRef, useState } from 'react';
import { fmt, fmtShort } from '../lib/time.js';
import { Icon } from './ui.jsx';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const ZOOMS = [30, 60, 300, 900, 3600];

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

/**
 * Zoomed edit lane under the video. While any drag runs, the visible window is frozen (the lane does not
 * follow the playhead) so the pointer always maps to the same time; the parent recenters afterwards.
 */
export default function Timeline({ duration, segments, activeId, playhead, view, onView, onSeek, onSelect, onChange, onCreate, onCommit, onDelete, onDragState }) {
  const [lnRef, lnW] = useWidth();
  const [hover, setHover] = useState(null);
  const [ghost, setGhost] = useState(null);
  const drag = useRef(null);
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
    const cands = [playhead];
    segments.forEach((s) => s.id !== ignoreId && cands.push(s.start, s.end));
    for (const c of cands) if (c != null && Math.abs(c - t) < px) return c;
    return Math.round(t);
  };

  const begin = (e, d) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { ...d, v: { ...view }, x0: e.clientX, moved: false };
    onDragState && onDragState(true);
  };
  const end = () => {
    drag.current = null;
    onDragState && onDragState(false);
  };

  // ruler = scrub strip
  const rulerDown = (e) => {
    if (e.button !== 0) return;
    begin(e, { kind: 'scrub' });
    onSeek(tAt(e.clientX, drag.current.v), true);
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

  const move = (e) => {
    const r = lnRef.current.getBoundingClientRect();
    const d = drag.current;
    const t = tAt(e.clientX, d ? d.v : view);
    if (!d) {
      setHover({ x: e.clientX - r.left, t });
      return;
    }
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (d.kind === 'scrub') {
      onSeek(t, true);
      return;
    }
    if (d.kind === 'create') {
      if (d.moved) {
        const t1 = snap(t, null, d.v);
        setGhost({ start: Math.min(d.t0, t1), end: Math.max(d.t0, t1) });
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

  const up = (e) => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(e.clientX, d.v);
    if (d.kind === 'scrub') onSeek(null, false);
    if (d.kind === 'create') {
      if (d.moved && ghost && ghost.end - ghost.start >= 1) onCreate(ghost.start, ghost.end);
      else onSeek(t, false);
      setGhost(null);
    }
    if (d.kind === 'seg') {
      if (!d.moved) onSeek(t, false);
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
  const pan = (dir) => {
    const s = Math.max(0, Math.min(D - span, view.start + dir * span * 0.5));
    onView({ start: s, end: s + span });
  };
  const fitActive = () => {
    const a = segments.find((s) => s.id === activeId);
    if (!a) return zoomTo(span);
    const len = Math.max(20, (a.end - a.start) * 1.6);
    const s = Math.max(0, Math.min(D - len, (a.start + a.end) / 2 - len / 2));
    onView({ start: s, end: s + len });
  };

  const ph = playhead || 0;
  const zoomOpts = ZOOMS.filter((z) => z < D * 1.2);
  return (
    <div className="timeline">
      <div className="zbar">
        <button className="icon-btn xs" onClick={() => pan(-1)} title="Earlier">
          <Icon name="chevronLeft" size={14} />
        </button>
        <span className="zspan">
          {fmt(view.start)} – {fmt(view.end)}
        </span>
        <button className="icon-btn xs" onClick={() => pan(1)} title="Later">
          <Icon name="chevronRight" size={14} />
        </button>
        <div className="zgap" />
        {zoomOpts.length > 1 && (
          <div className="seg seg-sm" role="radiogroup" title="Visible range">
            {zoomOpts.map((z) => (
              <button key={z} className={Math.abs(span - z) < 1 ? 'on' : ''} onClick={() => zoomTo(z)}>
                <span>{fmtShort(z)}</span>
              </button>
            ))}
            <button onClick={fitActive} title="Fit the selected segment">
              <span>Fit</span>
            </button>
          </div>
        )}
        <button className="icon-btn xs" onClick={() => zoomTo(span / 2)} title="Zoom in">
          <Icon name="zoomIn" size={14} />
        </button>
        <button className="icon-btn xs" onClick={() => zoomTo(span * 2)} title="Zoom out">
          <Icon name="zoomOut" size={14} />
        </button>
      </div>

      <div className="zoom" ref={lnRef} onPointerLeave={() => setHover(null)}>
        <div className="ruler" onPointerDown={rulerDown} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag to scrub">
          {minorTicks.map((t) => (
            <span key={'m' + t} className="tick minor" style={{ left: xOf(t) }} />
          ))}
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: xOf(t) }}>
              <em>{fmt(t)}</em>
            </span>
          ))}
        </div>
        <div className="lane" onPointerDown={laneDown} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {!segments.some((s) => s.end > view.start && s.start < view.end) && !ghost && <span className="lane-hint">Drag to mark a clip · click to jump</span>}
          {segments
            .filter((s) => s.end > view.start && s.start < view.end)
            .map((s) => {
              const x0 = xOf(Math.max(s.start, view.start));
              const x1 = xOf(Math.min(s.end, view.end));
              return (
                <div
                  key={s.id}
                  className={`tseg ${s.id === activeId ? 'active' : ''}`}
                  style={{ left: x0, width: Math.max(4, x1 - x0), '--c': s.color }}
                  onPointerDown={segDown(s, 'move')}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onDelete && onDelete(s.id);
                  }}
                  title="Drag to move · edges to trim · right-click to delete"
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
  );
}
