import { useEffect, useState } from 'react';
import { Seg, Toggle } from './ui.jsx';

function Row({ label, hint, children }) {
  return (
    <div className="srow">
      <div className="srow-l">
        <div className="srow-label">{label}</div>
        {hint && <div className="srow-hint">{hint}</div>}
      </div>
      <div className="srow-r">{children}</div>
    </div>
  );
}

/** Premiere export: layout + captions. Everything here applies to the next build / rebuild. */
export default function PremiereSettings({ settings }) {
  const P = settings.premiere;
  const c = P.captions;
  const set = (p) => window.api.setSettings({ premiere: p });
  const setC = (p) => window.api.setSettings({ premiere: { captions: p } });
  const [ws, setWs] = useState(null);
  useEffect(() => {
    window.api.whisperStatus().then(setWs).catch(() => {});
  }, []);
  const [W, H] = P.format === '9:16' ? [1440, 2560] : [1440, 1920];

  return (
    <div>
      <Row label="Build Premiere sequence after every download" hint="Captions + vertical sequence are ready when the download finishes — then one click on “Open in Premiere”.">
        <Toggle checked={P.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>
      <Row label="Format">
        <Seg
          size="sm"
          value={P.format}
          onChange={(v) => set({ format: v })}
          options={[
            { value: '3:4', label: '1440×1920 (3:4)' },
            { value: '9:16', label: '1440×2560 (9:16)' },
          ]}
        />
      </Row>
      <Row label="Facecam height" hint={`Top ${Math.round(P.split * H)} px facecam, bottom ${H - Math.round(P.split * H)} px gameplay.`}>
        <div className="slider-row">
          <input type="range" min="0.2" max="0.5" step="0.01" value={P.split} onChange={(e) => set({ split: Number(e.target.value) })} />
          <span className="val">{Math.round(P.split * 100)}%</span>
        </div>
      </Row>
      <Row label="Captions" hint="Local speech-to-text (whisper.cpp), nothing leaves your PC.">
        <Toggle checked={c.enabled} onChange={(v) => setC({ enabled: v })} />
      </Row>
      {c.enabled && (
        <>
          <Row label="Animated captions in the sequence" hint="Transparent video on V3, the spoken word highlighted. The .srt is always saved too.">
            <Toggle checked={c.overlay} onChange={(v) => setC({ overlay: v })} />
          </Row>
          <Row label="Language">
            <Seg
              size="sm"
              value={c.language}
              onChange={(v) => setC({ language: v })}
              options={[
                { value: 'de', label: 'Deutsch' },
                { value: 'en', label: 'English' },
                { value: 'auto', label: 'Auto' },
              ]}
            />
          </Row>
          <Row label="Speech model" hint={ws ? `${ws.gpu ? 'NVIDIA GPU' : 'CPU'} · downloaded on first use` : ''}>
            <select className="input sm" value={c.model} onChange={(e) => setC({ model: e.target.value })}>
              {Object.entries((ws && ws.models) || { 'large-v3-turbo': { label: 'Large v3 Turbo — best (GPU)' }, medium: { label: 'Medium' }, small: { label: 'Small' } }).map(([id, m]) => (
                <option key={id} value={id}>
                  {m.label}
                  {m.installed ? ' ✓' : m.mb ? ` (${m.mb} MB)` : ''}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Words per caption">
            <Seg size="sm" value={c.maxWords} onChange={(v) => setC({ maxWords: v })} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
          </Row>
          <Row label="Max characters per caption">
            <div className="slider-row">
              <input type="range" min="6" max="32" value={c.maxChars} onChange={(e) => setC({ maxChars: Number(e.target.value) })} />
              <span className="val">{c.maxChars}</span>
            </div>
          </Row>
          <Row label="Timing offset" hint="Captions snap to the real start of speech. Use this only to taste: negative = earlier.">
            <div className="slider-row">
              <input type="range" min="-500" max="500" step="10" value={c.offsetMs} onChange={(e) => setC({ offsetMs: Number(e.target.value) })} />
              <span className="val">{c.offsetMs > 0 ? '+' : ''}{c.offsetMs} ms</span>
            </div>
          </Row>
          <Row label="Style">
            <div className="cap-style">
              <input className="input sm" value={c.font} onChange={(e) => setC({ font: e.target.value })} title="Font (installed on Windows)" />
              <input type="number" className="input sm num" min="30" max="200" value={c.size} onChange={(e) => setC({ size: Number(e.target.value) || 84 })} title="Size" />
              <input type="color" value={c.color} onChange={(e) => setC({ color: e.target.value })} title="Text color" />
              <input type="color" value={c.highlight} onChange={(e) => setC({ highlight: e.target.value })} title="Spoken word" />
              <label className="cap-caps">
                <Toggle checked={c.uppercase} onChange={(v) => setC({ uppercase: v })} /> CAPS
              </label>
            </div>
          </Row>
          <Row label="Position" hint={c.posY == null ? 'On the line between facecam and gameplay.' : `${Math.round(c.posY * 100)}% from the top.`}>
            <div className="slider-row">
              <input type="range" min="0.1" max="0.95" step="0.01" value={c.posY == null ? P.split : c.posY} onChange={(e) => setC({ posY: Number(e.target.value) })} />
              <button className="chip sm" onClick={() => setC({ posY: null })}>
                Line
              </button>
            </div>
          </Row>
        </>
      )}
    </div>
  );
}
