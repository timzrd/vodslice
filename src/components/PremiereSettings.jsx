import { useEffect, useState } from 'react';
import { Icon, Seg, Toggle } from './ui.jsx';
import { activePreset } from './studio/presetStore.js';
import { presetSize } from '../../electron/layout.mjs';

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

/** Premiere export basics. Layout, caption style, effects and presets live in the Premiere tab. */
export default function PremiereSettings({ settings, onOpenStudio }) {
  const P = settings.premiere;
  const c = P.captions;
  const set = (p) => window.api.setSettings({ premiere: p });
  const setC = (p) => window.api.setSettings({ premiere: { captions: p } });
  const [ws, setWs] = useState(null);
  useEffect(() => {
    window.api.whisperStatus().then(setWs).catch(() => {});
  }, []);
  const preset = activePreset(settings);

  return (
    <div>
      <Row label="Build Premiere sequence after every download" hint="Captions + the vertical sequence are ready when the download finishes — then one click on “Open in Premiere”.">
        <Toggle checked={P.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>
      <Row label="Layout & caption style" hint={`Preset “${preset.name}” · ${preset.ratio} · ${presetSize(preset).join('×')} — design it in the Premiere tab.`}>
        <button className="btn sm" onClick={onOpenStudio}>
          <Icon name="phone" size={13} /> Open Premiere tab
        </button>
      </Row>
      <Row label="Spoken language" hint="Local speech-to-text (whisper.cpp), nothing leaves your PC.">
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
      <Row label="Timing offset" hint="Captions snap to the real start of speech. Use this only to taste: negative = earlier.">
        <div className="slider-row">
          <input type="range" min="-500" max="500" step="10" value={c.offsetMs} onChange={(e) => setC({ offsetMs: Number(e.target.value) })} />
          <span className="val">
            {c.offsetMs > 0 ? '+' : ''}
            {c.offsetMs} ms
          </span>
        </div>
      </Row>
    </div>
  );
}
