import { useRef } from 'react';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Draggable / resizable rectangle in normalized (0..1) stage coordinates.
 * aspectLock = pixel aspect ratio (w/h in source pixels) or null.
 */
export default function BoxEditor({ rect, stage, onChange, label, srcW, srcH, editable = true, aspectLock, tone = 'accent' }) {
  const st = useRef(null);
  const clamp = (r) => {
    const w = Math.max(0.02, Math.min(1, r.w));
    const h = Math.max(0.02, Math.min(1, r.h));
    return { x: Math.max(0, Math.min(1 - w, r.x)), y: Math.max(0, Math.min(1 - h, r.y)), w, h };
  };

  const down = (mode) => (e) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current = { mode, x0: e.clientX, y0: e.clientY, r: { ...rect } };
  };
  const move = (e) => {
    const s = st.current;
    if (!s) return;
    const dx = (e.clientX - s.x0) / stage.w;
    const dy = (e.clientY - s.y0) / stage.h;
    let { x, y, w, h } = s.r;
    if (s.mode === 'move') {
      x += dx;
      y += dy;
    } else {
      if (s.mode.includes('w')) {
        x += dx;
        w -= dx;
      }
      if (s.mode.includes('e')) w += dx;
      if (s.mode.includes('n')) {
        y += dy;
        h -= dy;
      }
      if (s.mode.includes('s')) h += dy;
      if (w < 0.02) {
        if (s.mode.includes('w')) x -= 0.02 - w;
        w = 0.02;
      }
      if (h < 0.02) {
        if (s.mode.includes('n')) y -= 0.02 - h;
        h = 0.02;
      }
      if (aspectLock) {
        // keep pixel aspect: w*srcW / (h*srcH) = aspectLock
        const horizontal = s.mode === 'e' || s.mode === 'w';
        if (horizontal || (s.mode.length === 2 && Math.abs(dx) * stage.w >= Math.abs(dy) * stage.h)) {
          const nh = (w * srcW) / aspectLock / srcH;
          if (s.mode.includes('n')) y += h - nh;
          h = nh;
        } else {
          const nw = (h * srcH * aspectLock) / srcW;
          if (s.mode.includes('w')) x += w - nw;
          w = nw;
        }
      }
    }
    if (e.shiftKey && s.mode === 'move') {
      // snap to frame edges / corners
      const snap = 0.015;
      if (x < snap) x = 0;
      if (y < snap) y = 0;
      if (1 - (x + w) < snap) x = 1 - w;
      if (1 - (y + h) < snap) y = 1 - h;
    }
    onChange(clamp({ x, y, w, h }), false);
  };
  const up = () => {
    if (st.current) onChange(clamp(rect), true);
    st.current = null;
  };

  const pw = Math.round(rect.w * srcW);
  const ph = Math.round(rect.h * srcH);
  return (
    <div
      className={`box box-${tone} ${editable ? 'editable' : ''}`}
      style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
      onPointerDown={down('move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="box-label">
        {label} <em>{pw}×{ph}</em>
      </span>
      {editable &&
        HANDLES.map((hd) => (
          <span key={hd} className={`handle h-${hd}`} onPointerDown={down(hd)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        ))}
    </div>
  );
}
