import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../lib/time.js';
import { sbStyle } from '../lib/storyboard.js';

/** Storyboard sprite thumbnail for time t (YouTube storyboards / Twitch seek previews). */
export function Storyboard({ sb, t, width = 160 }) {
  if (!sb) return null;
  const h = (width * sb.height) / sb.width;
  const st = sbStyle(sb, t, width, h);
  return st ? <div className="sb-thumb" style={{ width, height: h, ...st }} /> : null;
}

/**
 * YouTube-style progress bar inside the bottom of the video. Clips show up as glowing ranges, chat peaks as
 * emotes above the bar. Dragging reports 'move' (cheap preview) and 'end' (final seek).
 */
export default function ScrubBar({ duration, playhead, segments, activeId, heatmap, chat, chapters, storyboard, onSeek, edge, layouts, onLayoutDelete, emotes = true }) {
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
  useEffect(() => setHover(null), [duration]);

  const heatPath = useMemo(() => {
    let pts = null;
    if (chat && chat.counts && chat.counts.length) pts = chat.counts.map((c, i) => [(((i + 0.5) * chat.step) / D) * 100, 100 - Math.min(1, c / chat.max) * 100]);
    else if (heatmap && heatmap.length) pts = heatmap.map(([s, e, v]) => [((s + e) / 2 / D) * 100, 100 - v * 100]);
    if (!pts) return null;
    return `M0,100 ${pts.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(1)}`).join(' ')} L100,100 Z`;
  }, [heatmap, chat, D]);

  // the biggest chat peaks with an emote, spread out so they don't overlap
  const peaks = useMemo(() => {
    if (!emotes || !chat || !chat.peaks || !w) return [];
    const minGap = 30 / Math.max(1, w); // ~30 px
    const out = [];
    for (const p of [...chat.peaks].filter((x) => x.emote).sort((a, b) => b.value - a.value)) {
      const f = p.t / D;
      if (out.some((o) => Math.abs(o.t / D - f) < minGap)) continue;
      out.push(p);
      if (out.length >= 14) break;
    }
    return out;
  }, [chat, emotes, w, D]);

  const down = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    onSeek(tAt(e.clientX), 'move');
  };
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, t: tAt(e.clientX) });
    if (drag) onSeek(tAt(e.clientX), 'move');
  };
  const up = (e) => {
    if (drag) onSeek(tAt(e.clientX), 'end');
    setDrag(false);
  };

  const ph = Math.max(0, Math.min(D, playhead || 0));
  const pct = (t) => `${(t / D) * 100}%`;
  return (
    <div className={`scrub ${drag ? 'dragging' : ''} ${hover ? 'hovering' : ''} ${heatPath ? 'has-heat' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="scrub-shade" />
      {peaks.length > 0 && (
        <div className="scrub-emotes">
          {peaks.map((p) => (
            <button
              key={p.t}
              className="scrub-emote"
              style={{ left: pct(p.t) }}
              title={`${p.emote.name} ×${p.emote.count} at ${fmt(p.t)} — click to jump`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(Math.max(0, p.t - 12), 'end');
              }}
            >
              <img src={p.emote.url} alt={p.emote.name} draggable={false} />
            </button>
          ))}
        </div>
      )}
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
                if (e.button === 0) onSeek(k.t, 'end');
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
        {hover && w > 0 && !drag && (
          <div className="scrub-tip" style={{ left: Math.max(84, Math.min(w - 84, hover.x)) }}>
            <Storyboard sb={storyboard} t={hover.t} />
            <span>{fmt(hover.t)}</span>
          </div>
        )}
        {drag && hover && w > 0 && (
          <div className="scrub-tip time-only" style={{ left: Math.max(30, Math.min(w - 30, hover.x)) }}>
            <span>{fmt(hover.t)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
