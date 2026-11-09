import { useEffect } from 'react';
import { Icon } from './ui.jsx';

/** What every key does (German QWERTZ layout is drawn; bindings use the typed character). */
const KEYS = {
  ' ': { icon: 'pause', label: 'Play / Pause', cat: 'play' },
  J: { icon: 'rewind', label: 'Back 10 s', shift: '−2 s', cat: 'play', home: true },
  K: { icon: 'pause', label: 'Play / Pause', cat: 'play', home: true },
  L: { icon: 'zap', label: 'Faster', shift: '', cat: 'play', home: true },
  P: { icon: 'playClip', label: 'Play clip', cat: 'play' },
  M: { icon: 'mute', label: 'Mute', cat: 'play' },
  U: { icon: 'flag', label: 'Marker', cat: 'mark' },
  I: { icon: 'in', label: 'IN', cat: 'mark' },
  O: { icon: 'out', label: 'OUT', cat: 'mark' },
  N: { icon: 'plus', label: 'New clip', shift: 'add part', cat: 'mark' },
  ',': { icon: 'markerPrev', label: 'Prev marker', shift: 'slower', cat: 'mark' },
  '.': { icon: 'markerNext', label: 'Next marker', shift: 'faster', cat: 'mark' },
  S: { icon: 'scissors', label: 'Split', cat: 'edit' },
  F: { icon: 'user', label: 'Facecam', cat: 'cam' },
  D: { icon: 'sparkles', label: 'Detect cam', cat: 'cam' },
  Del: { icon: 'trash', label: 'Delete', cat: 'edit' },
  Esc: { icon: 'esc', label: 'Deselect', cat: 'edit' },
  '←': { icon: 'chevronLeft', label: '−5 s', cat: 'play' },
  '→': { icon: 'chevronRight', label: '+5 s', cat: 'play' },
  '↑': { icon: 'volume', label: 'Vol +', cat: 'play' },
  '↓': { icon: 'volumeLow', label: 'Vol −', cat: 'play' },
};

const ROWS = [
  { off: 0, keys: ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'] },
  { off: 0.3, keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'] },
  { off: -0.45, keys: ['<', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '-'] },
];

const COMBOS = [
  ['Ctrl', 'Z', 'Undo', 'undo'],
  ['Ctrl', 'Y', 'Redo', 'redo'],
  ['Ctrl', 'A', 'Check all clips', 'check'],
  ['Ctrl', 'Enter', 'Download checked', 'download'],
  ['Ctrl', 'K', 'Search a streamer', 'search'],
  ['Ctrl', 'V', 'Paste a link', 'link'],
  ['Shift', '. / ,', 'Speed up / down', 'zap'],
  ['Wheel', '', 'Scroll the timeline', 'chevronRight'],
  ['Ctrl', 'Wheel', 'Zoom at the cursor', 'zoomIn'],
  ['F1', '', 'This keyboard', 'keyboard'],
];

function Key({ k, wide, label }) {
  const b = KEYS[k];
  return (
    <div className={`kc ${b ? `kc-on kc-${b.cat}` : ''} ${b && b.home ? 'kc-home' : ''} ${wide ? 'kc-wide' : ''}`} style={wide ? { width: wide } : undefined} title={b ? `${label || k}: ${b.label}${b.shift ? ` · Shift: ${b.shift}` : ''}` : undefined}>
      <span className="kc-cap">{label || k}</span>
      {b && <Icon name={b.icon} size={18} className="kc-ico" />}
      {b && <span className="kc-label">{b.label}</span>}
      {b && b.shift && <span className="kc-shift">⇧ {b.shift}</span>}
      {(k === 'J' || k === 'F') && <span className="kc-bump" />}
    </div>
  );
}

/** Visual keyboard: see at a glance where the hand goes (J K L to play, U I O to mark). */
export default function KeyboardMap() {
  return (
    <div className="keymap">
      <div className="km-hint">
        <b>Right hand on J K L</b> — index finger reaches U I O and N M, the little finger stays on the arrows. Left hand: F D S.
      </div>
      <div className="km-board">
        <div className="km-row">
          <Key k="Esc" />
          <span className="km-gap" />
          <Key k="Del" />
        </div>
        {ROWS.map((r, i) => (
          <div key={i} className="km-row" style={{ paddingLeft: `calc(${Math.max(0, r.off)} * var(--ku))` }}>
            {r.keys.map((k) => (
              <Key key={k} k={k} />
            ))}
          </div>
        ))}
        <div className="km-row km-bottom">
          <Key k=" " label="Space" wide="calc(6 * var(--ku) + 5 * var(--kg))" />
          <span className="km-gap" />
          <div className="km-arrows">
            <Key k="↑" />
            <div className="km-arrow-row">
              <Key k="←" />
              <Key k="↓" />
              <Key k="→" />
            </div>
          </div>
        </div>
      </div>
      <div className="km-legend">
        <span className="kl kl-play">Playback</span>
        <span className="kl kl-mark">Mark clips</span>
        <span className="kl kl-edit">Edit</span>
        <span className="kl kl-cam">Facecam</span>
      </div>
      <div className="km-combos">
        {COMBOS.map(([a, b, label, icon]) => (
          <div key={a + b} className="kco">
            <Icon name={icon} size={13} />
            <span className="kco-keys">
              <kbd className="kbd">{a}</kbd>
              {b && (
                <>
                  +<kbd className="kbd">{b}</kbd>
                </>
              )}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KeysOverlay({ onClose }) {
  useEffect(() => {
    const k = (e) => (e.key === 'Escape' || e.key === 'F1') && (e.preventDefault(), onClose());
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="keys-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="keys-card">
        <div className="keys-head">
          <h2>
            <Icon name="keyboard" size={18} /> Hotkeys
          </h2>
          <button className="icon-btn sm" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={15} />
          </button>
        </div>
        <KeyboardMap />
      </div>
    </div>
  );
}
