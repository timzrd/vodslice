import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../lib/time.js';

/** Storyboard sprite thumbnail for time t (YouTube / Twitch storyboards from yt-dlp). */
export function Storyboard({ sb, t, width = 160 }) {
  if (!sb) return null;
  let acc = 0;
  for (const f of sb.fragments) {
    const d = f.duration || 0;
    if (t < acc + d || f === sb.fragments.at(-1)) {
      const per = d / (sb.rows * sb.columns) || 1;
      const idx = Math.min(sb.rows * sb.columns - 1, Math.max(0, Math.floor((t - acc) / per)));
      const col = idx % sb.columns;
      const row = Math.floor(idx / sb.columns);
      const scale = width / sb.width;
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

/**
 * YouTube-style progress bar that sits inside the bottom of the video.
 * Clips show up as glowing colored ranges on the bar.
 */
export default function ScrubBar({ duration, playhead, segments, activeId, heatmap, chapters, storyboard, onSeek, edge, layouts, onLayoutDelete }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null);
  const [drag, setDrag] = useState(false);
  const D = Math.max(1, duration || 1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const tAt = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return (Math.max(0, Math.min(r.width, clientX - r.left)) / Math.max(1, r.width)) * D;
  };

  const heatPath = useMemo(() => {
    if (!heatmap || !heatmap.length) return null;
    const pts = heatmap.map(([s, e, v]) => [((s + e) / 2 / D) * 100, 100 - v * 100]);
    return `M0,100 ${pts.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(1)}`).join(' ')} L100,100 Z`;
  }, [heatmap, D]);

  const down = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    onSeek(tAt(e.clientX), true);
  };
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, t: tAt(e.clientX) });
    if (drag) onSeek(tAt(e.clientX), true);
  };
  const up = () => {
    if (drag) onSeek(null, false);
    setDrag(false);
  };

  const ph = Math.max(0, Math.min(D, playhead || 0));
  const pct = (t) => `${(t / D) * 100}%`;
  return (
    <div className={`scrub ${drag ? 'dragging' : ''} ${hover ? 'hovering' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="scrub-shade" />
      <div className="scrub-hit" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => !drag && setHover(null)}>
        {heatPath && (
          <svg className="scrub-heat" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={heatPath} />
          </svg>
        )}
        <div className="scrub-track">
          {hover && <span className="scrub-hoverfill" style={{ width: pct(hover.t) }} />}
          <span className="scrub-played" style={{ width: pct(ph) }} />
          {(chapters || []).slice(1).map((c, i) => (
            <span key={i} className="scrub-gap" style={{ left: pct(c.start) }} />
          ))}
          {segments.map((s) => (
            <span
              key={s.id}
              className={`scrub-seg ${s.id === activeId ? 'active' : ''}`}
              style={{ left: pct(s.start), width: `max(3px, ${((s.end - s.start) / D) * 100}%)`, '--c': s.color }}
            />
          ))}
        </div>
        <span className="scrub-knob" style={{ left: pct(ph) }} />
        {(layouts || []).map((k, i) =>
          i === 0 ? null : (
            <span
              key={k.id}
              className="scrub-layout"
              style={{ left: pct(k.t) }}
              title={`Facecam position ${i + 1} from ${fmt(k.t)} — click to jump, right-click to remove`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) onSeek(k.t, false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLayoutDelete && onLayoutDelete(k.id);
              }}
            />
          )
        )}
        {edge && (
          <span className="scrub-edge" style={{ left: pct(edge.t), '--c': edge.color }}>
            <span className="scrub-edge-tag" style={{ transform: `translateX(${edge.t / D > 0.85 ? '-100%' : edge.t / D < 0.15 ? '0' : '-50%'})` }}>
              <i>{edge.edge === 'end' ? 'OUT' : 'IN'}</i>
              {fmt(edge.t)}
            </span>
          </span>
        )}
        {hover && w > 0 && (
          <div className="scrub-tip" style={{ left: Math.max(84, Math.min(w - 84, hover.x)) }}>
            <Storyboard sb={storyboard} t={hover.t} />
            <span>{fmt(hover.t)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
