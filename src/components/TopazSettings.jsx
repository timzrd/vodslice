import { Icon, Seg, Toggle } from './ui.jsx';

const SLIDERS = [
  ['preblur', 'Anti-alias / deblur', -1, 1],
  ['noise', 'Reduce noise', 0, 1],
  ['details', 'Improve details', 0, 1],
  ['halo', 'Dehalo', 0, 1],
  ['blur', 'Sharpen', 0, 1],
  ['compression', 'Fix compression', 0, 1],
];

let n = 0;
const newId = () => `p${Date.now().toString(36)}${(n++).toString(36)}`;

/** Topaz Video AI presets: model, scale and enhancement strengths (same knobs as Topaz's own UI). */
export default function TopazSettings({ settings, topaz, onRescan }) {
  const tz = settings.topaz;
  const presets = tz.presets || [];
  const cur = presets.find((p) => p.id === tz.preset) || presets[0];
  const models = (topaz && topaz.models) || [];
  const model = cur && models.find((m) => m.id === cur.model);
  const scales = model && model.scales.length ? model.scales : [1, 2, 4];

  const savePresets = (list) => window.api.replaceSetting('topaz.presets', list);
  const patch = (p) => savePresets(presets.map((x) => (x.id === cur.id ? { ...x, ...p } : x)));
  const select = (id) => window.api.setSettings({ topaz: { preset: id } });
  const duplicate = () => {
    const c = { ...cur, id: newId(), name: `${cur.name} copy` };
    savePresets([...presets, c]);
    select(c.id);
  };
  const remove = () => {
    if (presets.length < 2) return;
    const rest = presets.filter((x) => x.id !== cur.id);
    savePresets(rest);
    select(rest[0].id);
  };

  if (!topaz || !topaz.found)
    return (
      <div className="tz-missing">
        <p>Topaz Video AI was not found on this PC.</p>
        <button className="btn sm" onClick={onRescan}>
          <Icon name="refresh" size={13} /> Search again
        </button>
      </div>
    );

  return (
    <div className="tz">
      <div className="srow">
        <div className="srow-l">
          <div className="srow-label">Enhance facecam after download</div>
          <div className="srow-hint">Runs Topaz on Facecam.mp4 when the download is done — progress shows in Downloads and the mini overlay.</div>
        </div>
        <div className="srow-r">
          <Toggle checked={tz.enabled} onChange={(c) => window.api.setSettings({ topaz: { enabled: c } })} />
        </div>
      </div>
      <div className="srow">
        <div className="srow-l">
          <div className="srow-label">Keep the original facecam</div>
          <div className="srow-hint">{tz.keepOriginal ? `Saves “Facecam ${tz.suffix || 'Enhanced'}.mp4” next to Facecam.mp4.` : 'Facecam.mp4 gets replaced by the enhanced version.'}</div>
        </div>
        <div className="srow-r">
          <Toggle checked={tz.keepOriginal} onChange={(c) => window.api.setSettings({ topaz: { keepOriginal: c } })} />
        </div>
      </div>

      <div className="tz-presets">
        {presets.map((p) => (
          <button key={p.id} className={`tz-preset ${p.id === cur.id ? 'on' : ''}`} onClick={() => select(p.id)}>
            <b>{p.name}</b>
            <span>
              {(models.find((m) => m.id === p.model) || { name: p.model }).name} · {p.scale}×
            </span>
          </button>
        ))}
      </div>

      {cur && (
        <div className="tz-edit">
          <div className="tz-row">
            <label>Name</label>
            <input className="input sm" value={cur.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="tz-row">
            <label>Model</label>
            <select className="input sm" value={cur.model} onChange={(e) => patch({ model: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.face ? ' — faces' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="tz-row">
            <label>Upscale</label>
            <Seg size="sm" value={cur.scale} onChange={(v) => patch({ scale: v })} options={scales.map((s) => ({ value: s, label: `${s}×` }))} />
          </div>
          <div className="tz-row">
            <label>Parameters</label>
            <Seg
              size="sm"
              value={cur.auto ? 'auto' : 'manual'}
              onChange={(v) => patch({ auto: v === 'auto' })}
              options={[
                { value: 'auto', label: 'Auto (Topaz estimates)' },
                { value: 'manual', label: 'Manual' },
              ]}
            />
          </div>
          {!cur.auto &&
            SLIDERS.map(([key, label, min, max]) => (
              <div className="tz-row" key={key}>
                <label>{label}</label>
                <div className="slider-row">
                  <input type="range" min={min} max={max} step="0.01" value={cur[key] || 0} onChange={(e) => patch({ [key]: Number(e.target.value) })} />
                  <span className="val">{Math.round((cur[key] || 0) * 100)}</span>
                </div>
              </div>
            ))}
          <div className="tz-row">
            <label>Recover original detail</label>
            <div className="slider-row">
              <input type="range" min="0" max="1" step="0.01" value={cur.blend || 0} onChange={(e) => patch({ blend: Number(e.target.value) })} />
              <span className="val">{Math.round((cur.blend || 0) * 100)}</span>
            </div>
          </div>
          <div className="tz-row">
            <label>Add grain</label>
            <div className="slider-row">
              <input type="range" min="0" max="0.1" step="0.005" value={cur.grain || 0} onChange={(e) => patch({ grain: Number(e.target.value) })} />
              <span className="val">{Math.round((cur.grain || 0) * 1000) / 10}</span>
            </div>
          </div>
          <div className="tz-row">
            <label>Output quality</label>
            <div className="slider-row">
              <input type="range" min="10" max="28" step="1" value={34 - (cur.qp || 16)} onChange={(e) => patch({ qp: 34 - Number(e.target.value) })} />
              <span className="val">QP {cur.qp || 16}</span>
            </div>
          </div>
          <div className="tz-actions">
            <button className="btn sm" onClick={duplicate}>
              <Icon name="copy" size={13} /> Duplicate
            </button>
            <button className="btn sm" onClick={remove} disabled={presets.length < 2}>
              <Icon name="trash" size={13} /> Delete
            </button>
            <span className="grow" />
            <span className="muted tz-path" title={topaz.ffmpeg}>
              Topaz {topaz.version || ''} · {models.length} models
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
