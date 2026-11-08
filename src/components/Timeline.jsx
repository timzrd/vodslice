import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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

function Storyboard({ sb, t }) {
  if (!sb) return null;
  let acc = 0;
  for (const f of sb.fragments) {
    const d = f.duration || 0;
    if (t < acc + d || f === sb.fragments.at(-1)) {
      const per = d / (sb.rows * sb.columns) || 1;
      const idx = Math.min(sb.rows * sb.columns - 1, Math.max(0, Math.floor((t - acc) / per)));
      const col = idx % sb.columns;
      const row = Math.floor(idx / sb.columns);
      const scale = 160 / sb.width;
      return (
        <div
          className="sb-thumb"
          style={{
            width: sb.width * scale,
            height: sb.height * scale,
            backgroundImage: `url("${f.url}")`,
            backgroundSize: `${sb.columns * sb.width * scale}px ${sb.rows * sb.height * scale}px`,
            backgroundPosition: `${-col * sb.width * scale}px ${-row * sb.height * scale}px`,
          }}
        />
      );
    }
    acc += d;
  }
  return null;
}

export default function Timeline({ duration, segments, activeId, playhead, heatmap, chapters, storyboard, view, onView, onSeek, onSelect, onChange, onCreate, onCommit }) {
  const [ovRef, ovW] = useWidth();
  const [lnRef, lnW] = useWidth();
  const [hover, setHover] = useState(null); // {x, t, where}
  const [ghost, setGhost] = useState(null);
  const drag = useRef(null);
  const D = Math.max(1, duration || 1);
  const span = Math.max(1, view.end - view.start);

  const xToT = (x, w, s0 = 0, s1 = D) => s0 + (Math.max(0, Math.min(w, x)) / Math.max(1, w)) * (s1 - s0);
  const tToX = (t, w, s0 = 0, s1 = D) => ((t - s0) / (s1 - s0)) * w;

  const heatPath = useMemo(() => {
    if (!heatmap || !heatmap.length) return null;
    const pts = heatmap.map(([s, e, v]) => [((s + e) / 2 / D) * 100, 100 - v * 100]);
    return `M0,100 ${pts.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(1)}`).join(' ')} L100,100 Z`;
  }, [heatmap, D]);

  // ---------- Overview ----------
  const ovDown = (e) => {
    const r = ovRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = xToT(x, ovW);
    e.currentTarget.setPointerCapture(e.pointerId);
    const inWindow = t >= view.start && t <= view.end && e.target.classList.contains('ov-window');
    drag.current = inWindow ? { kind: 'pan', x0: e.clientX, v0: { ...view } } : { kind: 'scrub' };
    if (!inWindow) onSeek(t, true);
  };
  const ovMove = (e) => {
    const r = ovRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover({ where: 'ov', x, t: xToT(x, ovW) });
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'scrub') onSeek(xToT(x, ovW), true);
    if (d.kind === 'pan') {
      const dt = ((e.clientX - d.x0) / ovW) * D;
      const len = d.v0.end - d.v0.start;
      const s = Math.max(0, Math.min(D - len, d.v0.start + dt));
      onView({ start: s, end: s + len });
    }
  };
  const ovUp = () => {
    if (drag.current && drag.current.kind === 'scrub') onSeek(null, false);
    drag.current = null;
  };

  // ---------- Zoomed lane ----------
  const laneT = (clientX) => {
    const r = lnRef.current.getBoundingClientRect();
    return xToT(clientX - r.left, lnW, view.start, view.end);
  };
  const snap = (t, ignoreId) => {
    const px = (span / Math.max(1, lnW)) * 8;
    const cands = [playhead];
    segments.forEach((s) => s.id !== ignoreId && cands.push(s.start, s.end));
    for (const c of cands) if (c != null && Math.abs(c - t) < px) return c;
    return Math.round(t);
  };

  const segDown = (seg, mode) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelect(seg.id);
    drag.current = { kind: 'seg', mode, id: seg.id, t0: laneT(e.clientX), s0: seg.start, e0: seg.end, moved: false };
  };
  const laneDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = laneT(e.clientX);
    drag.current = { kind: 'create', t0: snap(t), moved: false, x0: e.clientX };
  };
  const laneMove = (e) => {
    const r = lnRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = xToT(x, lnW, view.start, view.end);
    setHover({ where: 'lane', x, t });
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'create') {
      if (Math.abs(e.clientX - d.x0) > 4) d.moved = true;
      if (d.moved) {
        const t1 = snap(t);
        setGhost({ start: Math.min(d.t0, t1), end: Math.max(d.t0, t1) });
      }
      return;
    }
    if (d.kind === 'seg') {
      d.moved = true;
      const dt = t - d.t0;
      let s = d.s0;
      let en = d.e0;
      if (d.mode === 'move') {
        const len = d.e0 - d.s0;
        s = Math.round(Math.max(0, Math.min(D - len, d.s0 + dt)));
        const sn = snap(s, d.id);
        if (sn !== s) s = sn;
        else {
          const se = snap(s + len, d.id);
          if (se !== s + len) s = se - len;
        }
        en = s + len;
      } else if (d.mode === 'start') {
        s = Math.max(0, Math.min(d.e0 - 1, snap(d.s0 + dt, d.id)));
      } else {
        en = Math.min(D, Math.max(d.s0 + 1, snap(d.e0 + dt, d.id)));
      }
      onChange(d.id, { start: s, end: en });
    }
  };
  const laneUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'create') {
      if (d.moved && ghost && ghost.end - ghost.start >= 1) onCreate(ghost.start, ghost.end);
      else onSeek(laneT(e.clientX), false);
      setGhost(null);
    }
    if (d.kind === 'seg') {
      if (!d.moved) onSeek(laneT(e.clientX), false);
      onCommit && onCommit();
    }
  };

  // ---------- Ruler (scrub) ----------
  const rulerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'rscrub' };
    onSeek(laneT(e.clientX), true);
  };
  const rulerMove = (e) => {
    const r = lnRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    setHover({ where: 'lane', x, t: xToT(x, lnW, view.start, view.end) });
    if (drag.current && drag.current.kind === 'rscrub') onSeek(laneT(e.clientX), true);
  };
  const rulerUp = () => {
    if (drag.current && drag.current.kind === 'rscrub') onSeek(null, false);
    drag.current = null;
  };

  const step = STEPS.find((s) => (s / span) * lnW >= 80) || 7200;
  const ticks = [];
  if (lnW > 0) for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) ticks.push(t);
  const minor = step / (step >= 60 ? 6 : 5);
  const minorTicks = [];
  if (lnW > 0 && (minor / span) * lnW >= 8) for (let t = Math.ceil(view.start / minor) * minor; t <= view.end; t += minor) minorTicks.push(t);

  const zoomTo = (len) => {
    len = Math.min(D, Math.max(10, len));
    const c = playhead != null && playhead >= view.start && playhead <= view.end ? playhead : (view.start + view.end) / 2;
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
  const ovStep = [300, 600, 900, 1800, 3600, 7200].find((s) => (s / D) * ovW >= 70) || 7200;
  const ovTicks = [];
  if (ovW > 0) for (let t = ovStep; t < D - ovStep * 0.4; t += ovStep) ovTicks.push(t);
  return (
    <div className="timeline">
      {/* Overview */}
      <div className="ov" ref={ovRef} onPointerDown={ovDown} onPointerMove={ovMove} onPointerUp={ovUp} onPointerLeave={() => setHover(null)}>
        {heatPath && (
          <svg className="ov-heat" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={heatPath} />
          </svg>
        )}
        {ovTicks.map((t) => (
          <span key={'h' + t} className="ov-tick" style={{ left: `${(t / D) * 100}%` }}>
            <em>{fmtShort(t)}</em>
          </span>
        ))}
        {(chapters || []).slice(1).map((c, i) => (
          <span key={i} className="ov-chapter" style={{ left: `${(c.start / D) * 100}%` }} title={c.title} />
        ))}
        {segments.map((s) => (
          <span
            key={s.id}
            className={`ov-seg ${s.id === activeId ? 'active' : ''}`}
            style={{ left: `${(s.start / D) * 100}%`, width: `max(3px, ${((s.end - s.start) / D) * 100}%)`, background: s.color }}
          />
        ))}
        <span className="ov-window" style={{ left: `${(view.start / D) * 100}%`, width: `max(6px, ${(span / D) * 100}%)` }} title="Drag to pan the zoomed view" />
        <span className="ov-playhead" style={{ left: `${(ph / D) * 100}%` }} />
        <span className="ov-label ov-l">0:00</span>
        <span className="ov-label ov-r">{fmt(D)}</span>
        {hover && hover.where === 'ov' && (
          <div className="hover-tip" style={{ left: Math.max(60, Math.min(ovW - 60, hover.x)) }}>
            <Storyboard sb={storyboard} t={hover.t} />
            <span>{fmt(hover.t)}</span>
          </div>
        )}
      </div>

      {/* Zoom toolbar */}
      <div className="zbar">
        <button className="icon-btn sm" onClick={() => pan(-1)} title="Pan left">
          <Icon name="chevronLeft" size={14} />
        </button>
        <span className="zspan">
          {fmt(view.start)} – {fmt(view.end)} <em>({fmtShort(span)})</em>
        </span>
        <button className="icon-btn sm" onClick={() => pan(1)} title="Pan right">
          <Icon name="chevronRight" size={14} />
        </button>
        <div className="zgap" />
        {ZOOMS.filter((z) => z < D * 1.2).map((z) => (
          <button key={z} className={`chip sm ${Math.abs(span - z) < 1 ? 'on' : ''}`} onClick={() => zoomTo(z)}>
            {fmtShort(z)}
          </button>
        ))}
        <button className="chip sm" onClick={fitActive} title="Zoom to the selected segment">
          Fit
        </button>
        <button className="icon-btn sm" onClick={() => zoomTo(span / 2)} title="Zoom in">
          <Icon name="zoomIn" size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => zoomTo(span * 2)} title="Zoom out">
          <Icon name="zoomOut" size={14} />
        </button>
      </div>

      {/* Zoomed ruler + lane */}
      <div className="zoom" ref={lnRef} onPointerLeave={() => setHover(null)}>
        <div className="ruler" onPointerDown={rulerDown} onPointerMove={rulerMove} onPointerUp={rulerUp}>
          {minorTicks.map((t) => (
            <span key={'m' + t} className="tick minor" style={{ left: tToX(t, lnW, view.start, view.end) }} />
          ))}
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: tToX(t, lnW, view.start, view.end) }}>
              <em>{fmt(t)}</em>
            </span>
          ))}
        </div>
        <div className="lane" onPointerDown={laneDown} onPointerMove={laneMove} onPointerUp={laneUp}>
          {!segments.some((s) => s.end > view.start && s.start < view.end) && !ghost && <span className="lane-hint">Drag here to add a segment · click to jump</span>}
          {segments
            .filter((s) => s.end > view.start && s.start < view.end)
            .map((s) => {
              const x0 = tToX(Math.max(s.start, view.start), lnW, view.start, view.end);
              const x1 = tToX(Math.min(s.end, view.end), lnW, view.start, view.end);
              return (
                <div
                  key={s.id}
                  className={`tseg ${s.id === activeId ? 'active' : ''}`}
                  style={{ left: x0, width: Math.max(4, x1 - x0), '--c': s.color }}
                  onPointerDown={segDown(s, 'move')}
                  onPointerMove={laneMove}
                  onPointerUp={laneUp}
                >
                  {s.start >= view.start && <span className="seg-h l" onPointerDown={segDown(s, 'start')} onPointerMove={laneMove} onPointerUp={laneUp} />}
                  <span className="seg-label">
                    <b>{s.label}</b> {fmtShort(s.end - s.start)}
                  </span>
                  {s.end <= view.end && <span className="seg-h r" onPointerDown={segDown(s, 'end')} onPointerMove={laneMove} onPointerUp={laneUp} />}
                </div>
              );
            })}
          {ghost && (
            <div
              className="tseg ghost"
              style={{ left: tToX(ghost.start, lnW, view.start, view.end), width: Math.max(2, tToX(ghost.end, lnW, view.start, view.end) - tToX(ghost.start, lnW, view.start, view.end)) }}
            >
              <span className="seg-label">{fmtShort(ghost.end - ghost.start)}</span>
            </div>
          )}
        </div>
        {ph >= view.start && ph <= view.end && (
          <span className="z-playhead" style={{ left: tToX(ph, lnW, view.start, view.end) }}>
            <span className="z-knob">{fmt(ph)}</span>
          </span>
        )}
        {hover && hover.where === 'lane' && !drag.current && (
          <span className="z-hover" style={{ left: hover.x }}>
            <em>{fmt(hover.t)}</em>
          </span>
        )}
      </div>
    </div>
  );
}
