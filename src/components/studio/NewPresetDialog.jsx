import { useEffect, useState } from 'react';
import { Icon, Seg } from '../ui.jsx';
import { RATIOS, QUALITIES, frameSize, fromShared } from '../../../electron/layout.mjs';
import { decodePreset } from './presetStore.js';

export function RatioTiles({ value, onChange, quality = 'hd' }) {
  return (
    <div className="ratio-tiles">
      {Object.keys(RATIOS).map((r) => {
        const [w, h] = RATIOS[r];
        const k = 34 / Math.max(w, h);
        return (
          <button key={r} className={`ratio-tile ${value === r ? 'on' : ''}`} onClick={() => onChange(r)} title={frameSize(r, quality).join(' × ')}>
            <span className="rt-shape" style={{ width: w * k, height: h * k }} />
            <b>{r}</b>
          </button>
        );
      })}
    </div>
  );
}

export function QualitySeg({ value, onChange, ratio }) {
  return (
    <div className="q-row">
      <Seg size="sm" value={value} onChange={onChange} options={Object.entries(QUALITIES).map(([k, q]) => ({ value: k, label: q.label }))} />
      <span className="q-px">{frameSize(ratio, value).join(' × ')}</span>
    </div>
  );
}

/**
 * "+" next to the presets: name, format, resolution and a starting layout — or paste a code / load a file
 * someone sent you.
 */
export default function NewPresetDialog({ presets, current, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState(current.ratio);
  const [quality, setQuality] = useState(current.quality || 'hd');
  const [base, setBase] = useState(current.id);
  const [code, setCode] = useState('');
  const [imported, setImported] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // a pasted code is checked right away
  useEffect(() => {
    if (!code.trim()) {
      setImported(null);
      setErr(null);
      return;
    }
    let alive = true;
    decodePreset(code)
      .then((obj) => {
        if (!alive) return;
        const p = fromShared(obj);
        setImported(p);
        setErr(null);
        if (!name) setName(p.name);
        setRatio(p.ratio);
        setQuality(p.quality);
      })
      .catch((e) => alive && (setImported(null), setErr(e.message)));
    return () => {
      alive = false;
    };
  }, [code]); // eslint-disable-line

  const loadFile = async () => {
    try {
      const text = await window.api.openPresetFile();
      if (text) setCode(text);
    } catch (e) {
      setErr(e.message);
    }
  };

  const create = () => {
    const src = imported || presets.find((p) => p.id === base) || current;
    const p = fromShared(JSON.parse(JSON.stringify(src)), (name || '').trim() || (imported ? imported.name : `${src.name} copy`));
    p.ratio = ratio;
    p.quality = quality;
    onCreate(p);
  };

  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal np-modal">
        <h3>New preset</h3>
        <label className="np-field">
          <span>Name</span>
          <input className="input" autoFocus value={name} placeholder={imported ? imported.name : 'e.g. DrDonut split'} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </label>
        <div className="np-field">
          <span>Format</span>
          <RatioTiles value={ratio} onChange={setRatio} quality={quality} />
        </div>
        <div className="np-field">
          <span>Resolution</span>
          <QualitySeg value={quality} onChange={setQuality} ratio={ratio} />
        </div>
        {!imported && (
          <div className="np-field">
            <span>Start from</span>
            <div className="np-bases">
              {presets.map((p) => (
                <button key={p.id} className={`chip sm ${base === p.id ? 'on' : ''}`} onClick={() => setBase(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="np-import">
          <div className="np-import-h">
            <Icon name="download" size={13} /> Got a preset from someone?
            <div className="grow" />
            <button className="btn sm" onClick={loadFile}>
              <Icon name="folder" size={13} /> Load file…
            </button>
          </div>
          <textarea className="input np-code" rows={2} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the preset code (VSP1-…)" spellCheck={false} />
          {imported && (
            <div className="np-ok">
              <Icon name="check" size={13} /> {imported.name} · {imported.ratio} · {frameSize(imported.ratio, imported.quality).join('×')}
            </div>
          )}
          {err && <div className="np-err">{err}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!!code.trim() && !imported}>
            Create preset
          </button>
        </div>
      </div>
    </div>
  );
}
