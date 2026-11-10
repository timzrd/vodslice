import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';
import { BUNDLED } from '../../lib/fonts.js';

const ROW = 58;

/**
 * Font browser: every font rendered with a sample word, search, favorites, bundled caption fonts first.
 * Arrow keys / hover preview the font live on the canvas, Enter or click picks, Esc goes back.
 */
export default function FontPicker({ value, sample, favorites, onPick, onPreview, onClose, onToggleFav }) {
  const [system, setSystem] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [text, setText] = useState(sample || 'WAIT FOR IT');
  const [hi, setHi] = useState(0);
  const [scroll, setScroll] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    window.api
      .listFonts()
      .then(setSystem)
      .catch(() => setSystem([]));
    inputRef.current && inputRef.current.focus();
    return () => onPreview(null);
  }, []); // eslint-disable-line

  const all = useMemo(() => {
    const bundled = BUNDLED.map((f) => ({ ...f, bundled: true }));
    const names = new Set(bundled.map((f) => f.family.toLowerCase()));
    const sys = (system || []).filter((f) => !names.has(f.family.toLowerCase()) && !/(icons|mdl2|assets|symbol|emoji|wingdings|webdings|marlett|holomdl|extra$)/i.test(f.family));
    return [...bundled, ...sys];
  }, [system]);
  const fav = useMemo(() => new Set(favorites || []), [favorites]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let l = all;
    if (tab === 'fav') l = l.filter((f) => fav.has(f.family));
    if (tab === 'bundled') l = l.filter((f) => f.bundled);
    if (tab === 'installed') l = l.filter((f) => !f.bundled);
    if (s) l = l.filter((f) => f.family.toLowerCase().includes(s) || (f.tag || '').toLowerCase().includes(s));
    if (tab === 'all' && !s) l = [...l.filter((f) => fav.has(f.family)), ...l.filter((f) => !fav.has(f.family))];
    return l;
  }, [all, q, tab, fav]);

  useEffect(() => {
    const i = list.findIndex((f) => f.family === value.font);
    setHi(i >= 0 ? i : 0);
    if (i >= 0 && listRef.current) listRef.current.scrollTop = Math.max(0, i * ROW - 120);
  }, [list.length, tab]); // eslint-disable-line

  const weightFor = (f) => (f.weights.includes(value.weight) ? value.weight : f.weights.reduce((b, w) => (Math.abs(w - 800) < Math.abs(b - 800) ? w : b), f.weights[0]));
  const preview = (f) => f && onPreview({ font: f.family, weight: weightFor(f), italic: false });
  const pick = (f) => f && onPick({ font: f.family, weight: weightFor(f), italic: false, fontWeights: f.weights });

  const keyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(list.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
      setHi(n);
      preview(list[n]);
      const el = listRef.current;
      if (el) {
        if (n * ROW < el.scrollTop) el.scrollTop = n * ROW;
        if ((n + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (n + 1) * ROW - el.clientHeight;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(list[hi]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const viewH = listRef.current ? listRef.current.clientHeight : 600;
  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const last = Math.min(list.length, Math.ceil((scroll + viewH) / ROW) + 4);

  return (
    <div className="font-picker" onKeyDown={keyDown}>
      <div className="fp-head">
        <button className="icon-btn sm" onClick={onClose} title="Back (Esc)">
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="fp-search">
          <Icon name="search" size={14} />
          <input ref={inputRef} value={q} placeholder="Search fonts…" onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        </div>
      </div>
      <div className="fp-tabs">
        {[
          ['all', 'All'],
          ['fav', `★ ${fav.size || ''}`],
          ['bundled', 'Caption fonts'],
          ['installed', 'Installed'],
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <input className="fp-sample input sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Sample text" spellCheck={false} title="Text shown in every font" />
      <div className="fp-list" ref={listRef} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} onMouseLeave={() => onPreview(null)}>
        {!system && <div className="fp-empty">Reading installed fonts…</div>}
        {system && !list.length && <div className="fp-empty">{tab === 'fav' ? 'Star fonts to find them here.' : 'No font matches.'}</div>}
        <div style={{ height: list.length * ROW, position: 'relative' }}>
          {list.slice(first, last).map((f, j) => {
            const i = first + j;
            const w = weightFor(f);
            return (
              <div
                key={f.family}
                className={`fp-row ${i === hi ? 'hi' : ''} ${f.family === value.font ? 'cur' : ''}`}
                style={{ top: i * ROW, height: ROW }}
                onMouseEnter={() => (setHi(i), preview(f))}
                onClick={() => pick(f)}
              >
                <div className="fp-name">
                  <span>{f.family}</span>
                  {f.bundled ? <em>{f.tag}</em> : f.user ? <em>yours</em> : null}
                  <span className="fp-w">{f.weights.length > 1 ? `${f.weights.length} weights` : ''}</span>
                </div>
                <div className="fp-sample-text" style={{ fontFamily: `"${f.family}", sans-serif`, fontWeight: w }}>
                  {text || f.family}
                </div>
                <button
                  className={`fp-star ${fav.has(f.family) ? 'on' : ''}`}
                  title={fav.has(f.family) ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFav(f.family);
                  }}
                >
                  <Icon name="star" size={15} fill={fav.has(f.family)} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="fp-foot">↑ ↓ preview on the video · Enter picks · Esc back</div>
    </div>
  );
}
