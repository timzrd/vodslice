import { useEffect, useRef, useState } from 'react';
import { parseTime } from '../lib/time.js';

const UNITS = [3600, 60, 1];

function split(v) {
  v = Math.max(0, Math.floor(v || 0));
  return [Math.floor(v / 3600), Math.floor((v % 3600) / 60), v % 60];
}

/**
 * H:MM:SS picker.
 *  - press a number and drag the mouse up/down to spin it (pointer is locked, so no screen edge)
 *  - or click it and type digits; arrows step, left/right switch fields, paste "1:31:20"
 */
export default function TimeField({ value, onChange, max = 359999, min = 0, settings, accent, compact, hourDigits: hd }) {
  const [parts, setParts] = useState(split(value));
  const [focus, setFocus] = useState(-1);
  const [buf, setBuf] = useState('');
  const [drag, setDrag] = useState(-1);
  const [spin, setSpin] = useState(0); // -1/1 for wheel animation
  const cells = useRef([]);
  const st = useRef({});
  const valRef = useRef(value);
  valRef.current = value;

  useEffect(() => {
    if (focus < 0 || !buf) setParts(split(value));
  }, [value]); // eslint-disable-line

  const sens = (settings && settings.ui.dragSensitivity) || 7;
  const invert = settings && settings.ui.dragInvert;
  const clamp = (v) => Math.max(min, Math.min(max, v));

  const commit = (v) => {
    const c = clamp(Math.round(v));
    setParts(split(c));
    if (c !== valRef.current) onChange(c);
  };

  const onPointerDown = (i) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current = { i, y: e.clientY, acc: 0, dragging: false, el: e.currentTarget, start: valRef.current };
  };
  const onPointerMove = (e) => {
    const s = st.current;
    if (s.i === undefined) return;
    if (!s.dragging) {
      if (Math.abs(e.clientY - s.y) < 4) return;
      s.dragging = true;
      setDrag(s.i);
      setFocus(-1);
      try {
        const r = s.el.requestPointerLock && s.el.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch {}
      s.lastY = e.clientY;
    }
    const locked = document.pointerLockElement === s.el;
    const dy = locked ? e.movementY : e.clientY - (s.lastY ?? e.clientY);
    s.lastY = e.clientY;
    s.acc += dy;
    const fast = e.shiftKey ? 5 : 1;
    const steps = Math.trunc(s.acc / sens);
    if (steps) {
      s.acc -= steps * sens;
      const dir = invert ? 1 : -1; // default: mouse up = bigger number
      commit(valRef.current + dir * steps * UNITS[s.i] * fast);
      setSpin(dir * steps > 0 ? 1 : -1);
    }
  };
  const onPointerUp = (i) => () => {
    const s = st.current;
    if (s.i === undefined) return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (!s.dragging) {
      cells.current[i]?.focus();
      setFocus(i);
      setBuf('');
    }
    st.current = {};
    setDrag(-1);
    setSpin(0);
  };

  const setPart = (i, n) => {
    const p = [...parts];
    p[i] = i === 0 ? n : Math.min(59, n);
    commit(p[0] * 3600 + p[1] * 60 + p[2]);
  };

  const onKeyDown = (i) => (e) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const nb = (buf + e.key).slice(-2);
      setBuf(nb);
      const n = Number(nb);
      const p = [...parts];
      p[i] = n;
      setParts(p);
      if (nb.length >= 2 || (i > 0 && n > 5 && nb.length === 1 && false)) {
        setPart(i, n);
        setBuf('');
        if (i < 2) cells.current[i + 1]?.focus();
      }
      return;
    }
    const flush = () => {
      if (buf) {
        setPart(i, Number(buf));
        setBuf('');
      }
    };
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      flush();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * UNITS[i] * (e.shiftKey ? 10 : 1);
      commit(valRef.current + d);
    } else if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && !buf)) {
      e.preventDefault();
      flush();
      if (i > 0) cells.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === ':' || e.key === '.' || e.key === ' ') {
      e.preventDefault();
      flush();
      if (i < 2) cells.current[i + 1]?.focus();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      setBuf(buf.slice(0, -1));
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      flush();
      e.currentTarget.blur();
    } else if (e.key === 'Tab') {
      flush();
    }
  };

  const onBlur = (i) => () => {
    if (buf) setPart(i, Number(buf));
    setBuf('');
    setTimeout(() => {
      if (!cells.current.includes(document.activeElement)) setFocus(-1);
    }, 0);
  };

  const onPaste = (e) => {
    const t = parseTime(e.clipboardData.getData('text'));
    if (t != null) {
      e.preventDefault();
      commit(t);
    }
  };

  const onWheel = (i) => (e) => {
    commit(valRef.current + (e.deltaY < 0 ? 1 : -1) * UNITS[i]);
  };

  const hourDigits = hd || (max >= 36000 ? 2 : 1);
  const show = (i) => {
    if (focus === i && buf) return buf.padStart(i === 0 ? hourDigits : 2, '·');
    return i === 0 ? String(parts[0]).padStart(hourDigits, '0') : String(parts[i]).padStart(2, '0');
  };
  const neighbor = (i, d) => {
    const v = clamp(valRef.current + d * UNITS[i]);
    const p = split(v);
    return i === 0 ? String(p[0]) : String(p[i]).padStart(2, '0');
  };

  return (
    <div className={`tf ${compact ? 'tf-compact' : ''} ${drag >= 0 ? 'tf-dragging' : ''}`} style={accent ? { '--tf-accent': accent } : undefined} onPaste={onPaste}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="tf-group">
          {i > 0 && <span className="tf-colon">:</span>}
          <span
            ref={(el) => (cells.current[i] = el)}
            className={`tf-cell ${focus === i ? 'focus' : ''} ${drag === i ? 'drag' : ''}`}
            tabIndex={0}
            role="spinbutton"
            aria-valuenow={parts[i]}
            aria-label={['Hours', 'Minutes', 'Seconds'][i]}
            onPointerDown={onPointerDown(i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp(i)}
            onPointerCancel={onPointerUp(i)}
            onKeyDown={onKeyDown(i)}
            onFocus={() => setFocus(i)}
            onBlur={onBlur(i)}
            onWheel={onWheel(i)}
          >
            {drag === i && <span className="tf-wheel tf-prev">{neighbor(i, invert ? -1 : 1)}</span>}
            <span className={`tf-val ${drag === i && spin ? (spin > 0 ? 'spin-up' : 'spin-down') : ''}`} key={drag === i ? parts[i] : 'v'}>
              {show(i)}
            </span>
            {drag === i && <span className="tf-wheel tf-next">{neighbor(i, invert ? 1 : -1)}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}
