import { useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const STEP = 0.05;
const clamp = (v) => Math.max(0, Math.min(1, v));
const snap = (v) => Math.round(clamp(v) / STEP) * STEP;

/**
 * Volume control: mute button + slider in 5 % steps.
 * Click or drag anywhere on the track (no scroll wheel needed); arrow keys work when focused.
 */
export default function Volume({ value, muted, onChange, onToggleMute }) {
  const track = useRef(null);
  const [drag, setDrag] = useState(false);
  const shown = muted ? 0 : value;

  const fromX = (clientX) => {
    const r = track.current.getBoundingClientRect();
    onChange(snap((clientX - r.left) / r.width));
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    fromX(e.clientX);
  };
  const move = (e) => drag && fromX(e.clientX);
  const up = () => setDrag(false);
  const key = (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? STEP : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -STEP : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(snap((muted ? 0 : value) + d));
  };

  const icon = shown === 0 ? 'mute' : shown < 0.5 ? 'volumeLow' : 'volume';
  const pct = Math.round(shown * 100);
  return (
    <div className={`vol ${drag ? 'dragging' : ''}`}>
      <button className="icon-btn" title={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={onToggleMute}>
        <Icon name={icon} size={15} />
      </button>
      <div
        ref={track}
        className="vol-track"
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        title="Volume (↑ / ↓)"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <span className="vol-rail">
          <span className="vol-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="vol-thumb" style={{ left: `${pct}%` }}>
          <span className="vol-pct">{pct}%</span>
        </span>
      </div>
    </div>
  );
}
