import { useRef, useState } from 'react';

/**
 * Vertical list you reorder by dragging the grip (⋮⋮): the row follows the pointer, the others slide out of the
 * way, and on release it glides into its slot. No arrows, no mouse wheel.
 * renderItem(item, index, { grip, dragging }) — spread `grip` on the handle element.
 */
export default function Sortable({ items, getKey, onMove, renderItem, className = '', gap = 0 }) {
  const refs = useRef(new Map());
  const [drag, setDrag] = useState(null); // {from, to, dy, rects, settling}

  const start = (e, index) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rects = items.map((it) => {
      const el = refs.current.get(getKey(it));
      const r = el ? el.getBoundingClientRect() : { top: 0, height: 0 };
      return { top: r.top, h: r.height + gap };
    });
    const y0 = e.clientY;
    let state = { from: index, to: index, dy: 0, rects, settling: false };
    setDrag(state);
    const move = (ev) => {
      const dy = ev.clientY - y0;
      const center = rects[index].top + rects[index].h / 2 + dy;
      let to = index;
      for (let i = 0; i < rects.length; i++) {
        const mid = rects[i].top + rects[i].h / 2;
        if (i < index && center < mid) {
          to = i;
          break;
        }
        if (i > index && center > mid) to = i;
      }
      state = { ...state, dy, to };
      setDrag(state);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const { from, to } = state;
      // glide into the slot, then commit the new order
      let target = 0;
      if (to > from) for (let i = from + 1; i <= to; i++) target += rects[i].h;
      else for (let i = to; i < from; i++) target -= rects[i].h;
      setDrag({ ...state, dy: target, settling: true });
      setTimeout(() => {
        setDrag(null);
        if (to !== from) onMove(from, to);
      }, 160);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`sortable ${drag ? 'is-dragging' : ''} ${className}`}>
      {items.map((it, i) => {
        const key = getKey(it);
        let style;
        if (drag) {
          const h = drag.rects[drag.from].h;
          if (i === drag.from) style = { transform: `translateY(${drag.dy}px)`, transition: drag.settling ? 'transform 0.16s cubic-bezier(.2,.8,.3,1)' : 'none', zIndex: 5, position: 'relative' };
          else {
            let shift = 0;
            if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -h;
            if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = h;
            style = { transform: `translateY(${shift}px)`, transition: 'transform 0.16s cubic-bezier(.2,.8,.3,1)' };
          }
        }
        return (
          <div key={key} ref={(el) => (el ? refs.current.set(key, el) : refs.current.delete(key))} className={`sort-item ${drag && drag.from === i ? 'lifted' : ''}`} style={style}>
            {renderItem(it, i, { grip: { onPointerDown: (e) => start(e, i), className: 'grip', title: 'Drag to reorder' }, dragging: !!drag && drag.from === i })}
          </div>
        );
      })}
    </div>
  );
}

/** The six-dot handle. */
export function GripDots() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      {[3, 8, 13].map((y) => (
        <g key={y}>
          <circle cx="2.5" cy={y} r="1.4" fill="currentColor" />
          <circle cx="7.5" cy={y} r="1.4" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
