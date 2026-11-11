import { useEffect, useRef, useState } from 'react';
import { Icon, Seg, Toggle } from '../ui.jsx';
import { presetSize, LOOKS, EFFECTS, ANIM_IN, ANIM_OUT, newEffect, captionState, EDGES } from '../../../electron/layout.mjs';
import { drawCaption, ensureFont, measureCaption } from '../../lib/captionDraw.js';
import { WEIGHT_NAMES, BUNDLED } from '../../lib/fonts.js';
import FontPicker from './FontPicker.jsx';
import Sortable, { GripDots } from '../Sortable.jsx';
import { RatioTiles, QualitySeg } from './NewPresetDialog.jsx';

const SWATCHES = ['#ffffff', '#ffd23f', '#4ade80', '#39c6ff', '#8b5cf6', '#ff6fae', '#ff4d4d', '#ff9f43', '#000000'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Number you can drag left/right (or click to type) — no mouse wheel needed. */
function Num({ value, onChange, min = -99999, max = 99999, step = 1, begin, end, label }) {
  const [edit, setEdit] = useState(null);
  const drag = useRef(null);
  const down = (e) => {
    if (edit != null) return;
    e.preventDefault();
    drag.current = { x: e.clientX, v: value, moved: false };
    begin && begin();
    const move = (ev) => {
      const d = ev.clientX - drag.current.x;
      if (Math.abs(d) > 2) drag.current.moved = true;
      if (drag.current.moved) onChange(clamp(Math.round((drag.current.v + Math.round(d / 3) * step) / step) * step, min, max));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      end && end();
      if (!drag.current.moved) setEdit(String(Math.round(value)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label className="num" title="Drag left/right · click to type">
      {label && <span className="num-l">{label}</span>}
      {edit != null ? (
        <input
          className="num-in"
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const v = Number(edit);
            if (Number.isFinite(v)) onChange(clamp(v, min, max));
            setEdit(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEdit(null);
          }}
        />
      ) : (
        <span className="num-v" onPointerDown={down}>
          {Math.round(value)}
        </span>
      )}
    </label>
  );
}

function Range({ label, value, min, max, step = 1, onChange, begin, end, fmt }) {
  return (
    <div className="ins-range">
      <div className="ir-top">
        <span>{label}</span>
        <b>{fmt ? fmt(value) : value}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={begin} onPointerUp={end} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Color({ value, onChange }) {
  return (
    <div className="ic-row">
      <label className="ic-pick" style={{ background: value }} title="Any color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {SWATCHES.map((c) => (
        <button key={c} className={`ic-sw ${c.toLowerCase() === (value || '').toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
    </div>
  );
}

const DEMO = { start: 0, end: 1, words: [{ w: 'wait', start: 0, end: 0.3 }, { w: 'for', start: 0.3, end: 0.6 }, { w: 'it', start: 0.6, end: 1 }] };
const DEMO1 = { start: 0, end: 1, words: [{ w: 'Aa', start: 0, end: 1 }] };

/** Caption rendered with the real renderer (looks, effect tiles). */
function CapCanvas({ cap, chunk = DEMO, width = 300, height = 110, fill = 0.84 }) {
  const ref = useRef(null);
  const key = JSON.stringify(cap);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const c = ref.current;
      if (!c || !alive) return;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const flat = { ...cap, anim: { ...cap.anim, in: 'none', out: 'none', mode: 'caption' } };
      const st = captionState([chunk], 0.45, flat);
      const m = measureCaption(ctx, chunk, flat, { x: 0, y: 0, w: 100000 }, 1);
      const k = Math.min(0.6, (c.width * fill) / Math.max(1, m.width), (c.height * 0.58) / (cap.size * (cap.lineHeight || 1.08)));
      drawCaption(ctx, st, flat, { x: c.width / 2 / k, y: c.height / 2 / k, w: 100000 }, { k });
    };
    draw();
    ensureFont(cap).then(draw);
    return () => {
      alive = false;
    };
  }, [key, chunk]); // eslint-disable-line
  return <canvas ref={ref} width={width} height={height} />;
}

const ANIM_LABEL = { none: 'None', fade: 'Fade', pop: 'Pop', bounce: 'Bounce', rise: 'Rise', slide: 'Slide', zoom: 'Zoom', blur: 'Blur in', sink: 'Sink', shrink: 'Shrink' };
const EDGE_LABEL = { none: 'None', line: 'Line', shadow: 'Shadow', glow: 'Glow', frame: 'Frame' };

/** Line / shadow / glow under the facecam, or a frame around it. */
function EdgeBlock({ edge, set, begin, end }) {
  return (
    <div className="ins-block">
      <div className="ins-h">Cam edge</div>
      <div className="edge-tiles">
        {EDGES.map((t) => (
          <button key={t} className={`edge-tile et-${t} ${edge.type === t ? 'on' : ''}`} onClick={() => set((e) => { e.type = t; if (t === 'shadow' && e.color.toLowerCase() === '#ffffff') e.color = '#000000'; if (t !== 'shadow' && e.color.toLowerCase() === '#000000') e.color = '#ffffff'; })} style={{ '--ec': t === 'shadow' ? '#000' : edge.color }}>
            <span className="et-vis">
              <i />
            </span>
            <em>{EDGE_LABEL[t]}</em>
          </button>
        ))}
      </div>
      {edge.type !== 'none' && (
        <>
          <Color value={edge.color} onChange={(v) => set((e) => (e.color = v))} />
          <Range label={edge.type === 'shadow' ? 'Length' : 'Thickness'} value={edge.size} min={1} max={edge.type === 'shadow' ? 60 : 40} onChange={(v) => set((e) => (e.size = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />
          <Range label="Opacity" value={Math.round((edge.opacity == null ? 1 : edge.opacity) * 100)} min={10} max={100} onChange={(v) => set((e) => (e.opacity = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
        </>
      )}
    </div>
  );
}

export default function Inspector({ preset, sel, setSel, patch, patchLayer, begin, end, settings, tab, setTab, framing, setFraming, onFontPreview, clip, onGoEdit, hasFacecam, presetActions, toast }) {
  const [W, H] = presetSize(preset);
  const [fontOpen, setFontOpen] = useState(false);
  const [openFx, setOpenFx] = useState(null);
  const [fontState, setFontState] = useState(null); // {family, installed}
  const cap = preset.captions;
  const setCap = (fn, rec) => patch((p) => (fn(p.captions, p), p), rec);
  const l = sel ? preset.layers.find((x) => x.type === sel) : null;
  const fcLayer = preset.layers.find((x) => x.type === 'facecam');
  const setEdge = (fn, rec) => patchLayer('facecam', (x) => fn(x.edge), rec);
  const editable = cap.mode === 'editable';
  const bundled = BUNDLED.find((f) => f.family === cap.font);

  useEffect(() => {
    if (!editable || !bundled) return setFontState(null);
    let alive = true;
    window.api.fontInstalled(cap.font).then((v) => alive && setFontState({ family: cap.font, installed: v }));
    return () => {
      alive = false;
    };
  }, [editable, cap.font]); // eslint-disable-line

  // ---------------- position / size of a box layer ----------------
  const box = l && l.rect && (
    <div className="ins-block">
      <div className="ins-h">Position & size</div>
      <div className="num-grid">
        <Num label="X" value={l.rect.x * W} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.rect = { ...x.rect, x: v / W }), false)} />
        <Num label="Y" value={l.rect.y * H} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.rect = { ...x.rect, y: v / H }), false)} />
        <Num label="W" value={l.rect.w * W} min={40} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.rect = { ...x.rect, w: v / W }), false)} />
        <Num label="H" value={l.rect.h * H} min={40} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.rect = { ...x.rect, h: v / H }), false)} />
      </div>
      <div className="quick">
        {[
          ['Top ⅓', { x: 0, y: 0, w: 1, h: 1 / 3 }],
          ['Top ½', { x: 0, y: 0, w: 1, h: 0.5 }],
          ['Bottom ⅔', { x: 0, y: 1 / 3, w: 1, h: 2 / 3 }],
          ['Bottom ½', { x: 0, y: 0.5, w: 1, h: 0.5 }],
          ['Full', { x: 0, y: 0, w: 1, h: 1 }],
          ['Corner', { x: 0.04, y: 0.03, w: 0.44, h: 0.24 }],
        ].map(([label, r]) => (
          <button key={label} className="chip sm" onClick={() => patchLayer(sel, (x) => (x.rect = r))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const framingBlock = l && l.view && (
    <div className="ins-block">
      <div className="ins-h">Framing</div>
      <Range label="Zoom" value={Math.round(l.view.zoom * 100)} min={100} max={400} step={1} fmt={(v) => `${v}%`} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.view = { ...x.view, zoom: v / 100 }), false)} />
      <div className="row gap">
        <button className={`btn sm ${framing ? 'primary' : ''}`} onClick={() => setFraming(!framing)} title="Double-click the box or press Enter">
          <Icon name="frame" size={13} /> {framing ? 'Done' : 'Adjust framing'}
        </button>
        <button className="btn sm" onClick={() => patchLayer(sel, (x) => (x.view = { zoom: 1, cx: 0.5, cy: 0.5 }))}>
          Center
        </button>
      </div>
    </div>
  );

  let body = null;
  let title = preset.name;
  let icon = 'layers';

  if (!sel) {
    // ---------------- the preset itself ----------------
    title = 'Preset';
    body = (
      <>
        <div className="ins-block">
          <input className="input preset-name" value={preset.name} onChange={(e) => presetActions.rename(e.target.value)} spellCheck={false} />
          <div className="ins-h">Format</div>
          <RatioTiles value={preset.ratio} quality={preset.quality} onChange={(r) => patch((p) => ((p.ratio = r), p))} />
          <div className="ins-h">Resolution</div>
          <QualitySeg value={preset.quality} ratio={preset.ratio} onChange={(q) => patch((p) => ((p.quality = q), p))} />
        </div>
        <EdgeBlock edge={fcLayer.edge} set={setEdge} begin={begin} end={end} />
        <div className="ins-block">
          <div className="ins-h">Captions in Premiere</div>
          <div className="mode-cards">
            <button className={`mode-card ${!editable ? 'on' : ''}`} onClick={() => setCap((c) => (c.mode = 'overlay'))}>
              <b>Finished look</b>
              <em>Video track with font, effects, animation</em>
            </button>
            <button className={`mode-card ${editable ? 'on' : ''}`} onClick={() => setCap((c) => (c.mode = 'editable'))}>
              <b>Editable text</b>
              <em>Premiere captions track + After Effects text layers</em>
            </button>
          </div>
          <label className="row between">
            <span className="ins-l">Captions on</span>
            <Toggle checked={preset.layers.find((x) => x.type === 'captions').on} onChange={(v) => patchLayer('captions', (x) => (x.on = v))} />
          </label>
        </div>
        <div className="ins-block">
          <div className="ins-h">Share</div>
          <div className="row gap">
            <button className="btn sm" onClick={presetActions.copyCode}>
              <Icon name="copy" size={13} /> Copy code
            </button>
            <button className="btn sm" onClick={presetActions.saveFile}>
              <Icon name="save" size={13} /> Save file
            </button>
            <div className="grow" />
            <button className="icon-btn sm ghost danger" title="Delete preset" onClick={presetActions.remove}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      </>
    );
  } else if (sel === 'gameplay') {
    title = 'Gameplay';
    icon = 'film';
    body = (
      <>
        {box}
        {framingBlock}
      </>
    );
  } else if (sel === 'facecam') {
    title = 'Facecam';
    icon = 'user';
    body = (
      <>
        {box}
        {framingBlock}
        <EdgeBlock edge={fcLayer.edge} set={setEdge} begin={begin} end={end} />
        {!clip && !hasFacecam && (
          <div className="ins-block">
            <button className="btn sm" onClick={onGoEdit}>
              <Icon name="scissors" size={13} /> Set the facecam box in Edit
            </button>
          </div>
        )}
      </>
    );
  } else if (sel === 'chat') {
    title = 'Chat';
    icon = 'chat';
    body = (
      <>
        {box}
        <div className="ins-block">
          <label className="row between">
            <span className="ins-l">Export chat overlay</span>
            <Toggle checked={!!settings.chat.enabled} onChange={(v) => window.api.setSettings({ chat: { enabled: v } })} />
          </label>
          <Range label="Text size" value={settings.chat.fontSize} min={16} max={48} onChange={(v) => window.api.setSettings({ chat: { fontSize: v } })} fmt={(v) => `${v}px`} />
        </div>
      </>
    );
  } else if (sel === 'captions') {
    title = 'Captions';
    icon = 'type';
    const weights = bundled ? bundled.weights : cap.fontWeights && cap.fontWeights.length ? cap.fontWeights : [400, 700, 900];
    const stroke = cap.effects.find((e) => e.type === 'stroke');
    const tabs = editable
      ? [['text', 'Text', 'type']]
      : [
          ['look', 'Looks', 'wand'],
          ['text', 'Text', 'type'],
          ['effects', 'Effects', 'fx'],
          ['motion', 'Motion', 'motion'],
        ];
    const curTab = editable ? 'text' : tab;
    body = (
      <>
        <div className="ins-block tight">
          <Seg
            size="sm"
            value={cap.mode}
            onChange={(v) => setCap((c) => (c.mode = v))}
            options={[
              { value: 'overlay', label: 'Finished look' },
              { value: 'editable', label: 'Editable text' },
            ]}
          />
          {editable && <span className="ins-note">Premiere: captions track from the .srt · After Effects: real text layers in this font and position.</span>}
        </div>
        {tabs.length > 1 && (
          <div className="ins-tabs">
            {tabs.map(([k, label, ic]) => (
              <button key={k} className={curTab === k ? 'on' : ''} onClick={() => setTab(k)}>
                <Icon name={ic} size={13} /> {label}
              </button>
            ))}
          </div>
        )}

        {curTab === 'look' && (
          <div className="ins-block">
            <div className="looks">
              {LOOKS.map((lk) => {
                const merged = { ...cap, ...lk.style, active: { ...cap.active, ...lk.style.active }, anim: { ...cap.anim, ...lk.style.anim } };
                const on = cap.font === lk.style.font && cap.color === lk.style.color && cap.effects.map((e) => e.type).join() === lk.style.effects.map((e) => e.type).join();
                return (
                  <button key={lk.id} className={`look ${on ? 'on' : ''}`} onClick={() => setCap((c) => Object.assign(c, JSON.parse(JSON.stringify({ ...lk.style, tracking: lk.style.tracking || 0 }))))}>
                    <CapCanvas cap={merged} />
                    <span>{lk.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {curTab === 'text' && (
          <>
            <div className="ins-block">
              <div className="ins-h">Font</div>
              <button className="font-btn" onClick={() => setFontOpen(true)} title="Browse all fonts">
                <span style={{ fontFamily: `"${cap.font}", sans-serif`, fontWeight: cap.weight }}>{cap.font}</span>
                <Icon name="chevronRight" size={14} />
              </button>
              {fontState && fontState.family === cap.font && !fontState.installed && (
                <div className="font-warn">
                  <span>Premiere and After Effects only see installed fonts.</span>
                  <button
                    className="btn sm primary"
                    onClick={async () => {
                      const r = await window.api.installFont(cap.font);
                      if (r.ok) {
                        setFontState({ family: cap.font, installed: true });
                        toast(`${cap.font} installed — restart Premiere / After Effects to see it`, 'ok', 5000);
                      } else toast(`Could not install: ${r.error}`, 'err');
                    }}
                  >
                    Install {cap.font}
                  </button>
                </div>
              )}
              <div className="weights">
                {weights.map((w) => (
                  <button key={w} className={`chip sm ${cap.weight === w ? 'on' : ''}`} style={{ fontWeight: w }} onClick={() => setCap((c) => (c.weight = w))}>
                    {WEIGHT_NAMES[w] || w}
                  </button>
                ))}
              </div>
              <Range label="Size" value={cap.size} min={24} max={260} onChange={(v) => setCap((c) => (c.size = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />
              <div className="row between">
                <span className="ins-l">Case</span>
                <Seg
                  size="sm"
                  value={cap.caps}
                  onChange={(v) => setCap((c) => (c.caps = v))}
                  options={[
                    { value: 'upper', label: 'AA' },
                    { value: 'none', label: 'Aa' },
                    { value: 'lower', label: 'aa' },
                  ]}
                />
              </div>
              <Range label="Letter spacing" value={cap.tracking || 0} min={-10} max={30} onChange={(v) => setCap((c) => (c.tracking = v), false)} begin={begin} end={end} />
            </div>
            <div className="ins-block">
              <div className="ins-h">Color</div>
              <Color value={cap.color} onChange={(v) => setCap((c) => (c.color = v))} />
              {editable && (
                <Range
                  label="Outline"
                  value={stroke && stroke.on ? stroke.width : 0}
                  min={0}
                  max={30}
                  begin={begin}
                  end={end}
                  fmt={(v) => (v ? `${v}px` : 'off')}
                  onChange={(v) =>
                    setCap((c) => {
                      let s = c.effects.find((e) => e.type === 'stroke');
                      if (!s) c.effects.unshift((s = newEffect('stroke')));
                      s.width = Math.max(1, v);
                      s.on = v > 0;
                    }, false)
                  }
                />
              )}
            </div>
            {!editable && (
              <div className="ins-block">
                <div className="ins-h">Spoken word</div>
                <Seg
                  size="sm"
                  value={cap.active.style}
                  onChange={(v) => setCap((c) => (c.active.style = v))}
                  options={[
                    { value: 'none', label: 'Off' },
                    { value: 'color', label: 'Color' },
                    { value: 'box', label: 'Box' },
                    { value: 'grow', label: 'Grow' },
                  ]}
                />
                {cap.active.style !== 'none' && <Color value={cap.active.color} onChange={(v) => setCap((c) => (c.active.color = v))} />}
              </div>
            )}
            <div className="ins-block">
              <div className="ins-h">Rhythm</div>
              <div className="row between">
                <span className="ins-l">Words per caption</span>
                <Seg size="sm" value={cap.words} onChange={(v) => setCap((c) => (c.words = v))} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
              </div>
              <div className="row between">
                <span className="ins-l">Language</span>
                <Seg
                  size="sm"
                  value={settings.premiere.captions.language}
                  onChange={(v) => window.api.setSettings({ premiere: { captions: { language: v } } })}
                  options={[
                    { value: 'de', label: 'DE' },
                    { value: 'en', label: 'EN' },
                    { value: 'auto', label: 'Auto' },
                  ]}
                />
              </div>
            </div>
          </>
        )}

        {curTab === 'effects' && (
          <div className="ins-block">
            <Sortable
              items={cap.effects}
              getKey={(e) => e.id}
              gap={5}
              className="fx-stack"
              onMove={(from, to) => setCap((c) => c.effects.splice(to, 0, c.effects.splice(from, 1)[0]))}
              renderItem={(e, i, { grip }) => (
                <div className={`fx-item ${e.on ? '' : 'off'} ${openFx === e.id ? 'open' : ''}`}>
                  <div className="fx-row" onClick={() => setOpenFx(openFx === e.id ? null : e.id)}>
                    <span {...grip} onClick={(ev) => ev.stopPropagation()}>
                      <GripDots />
                    </span>
                    <span className="fx-dot" style={{ background: e.color }} />
                    <b>{EFFECTS[e.type].label}</b>
                    <div className="grow" />
                    <button className="icon-btn xs ghost" onClick={(ev) => (ev.stopPropagation(), setCap((c) => (c.effects[i].on = !c.effects[i].on)))} title={e.on ? 'Turn off' : 'Turn on'}>
                      <Icon name={e.on ? 'eye' : 'eyeOff'} size={13} />
                    </button>
                    <button className="icon-btn xs ghost" title="Remove" onClick={(ev) => (ev.stopPropagation(), setCap((c) => c.effects.splice(i, 1)))}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  {openFx === e.id && (
                    <div className="fx-body">
                      <Color value={e.color} onChange={(v) => setCap((c) => (c.effects[i].color = v))} />
                      {e.type === 'stroke' && <Range label="Width" value={e.width} min={1} max={40} onChange={(v) => setCap((c) => (c.effects[i].width = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />}
                      {e.type === 'shadow' && (
                        <>
                          <Range label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} onChange={(v) => setCap((c) => (c.effects[i].opacity = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
                          <Range label="Softness" value={e.blur} min={0} max={80} onChange={(v) => setCap((c) => (c.effects[i].blur = v), false)} begin={begin} end={end} />
                          <Range label="Distance" value={e.distance} min={0} max={60} onChange={(v) => setCap((c) => (c.effects[i].distance = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />
                          <Range label="Angle" value={e.angle} min={0} max={359} onChange={(v) => setCap((c) => (c.effects[i].angle = v), false)} begin={begin} end={end} fmt={(v) => `${v}°`} />
                        </>
                      )}
                      {e.type === 'glow' && (
                        <>
                          <Range label="Radius" value={e.radius} min={5} max={240} onChange={(v) => setCap((c) => (c.effects[i].radius = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />
                          <Range label="Intensity" value={Math.round(e.intensity * 100)} min={10} max={250} onChange={(v) => setCap((c) => (c.effects[i].intensity = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
                        </>
                      )}
                      {e.type === 'box' && (
                        <>
                          <Range label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} onChange={(v) => setCap((c) => (c.effects[i].opacity = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
                          <Range label="Padding" value={Math.round(e.pad * 100)} min={0} max={80} onChange={(v) => setCap((c) => (c.effects[i].pad = v / 100), false)} begin={begin} end={end} />
                          <Range label="Corners" value={Math.round(e.radius * 100)} min={0} max={60} onChange={(v) => setCap((c) => (c.effects[i].radius = v / 100), false)} begin={begin} end={end} />
                        </>
                      )}
                      {e.type === 'extrude' && (
                        <>
                          <Range label="Depth" value={e.depth} min={1} max={40} onChange={(v) => setCap((c) => (c.effects[i].depth = v), false)} begin={begin} end={end} fmt={(v) => `${v}px`} />
                          <Range label="Angle" value={e.angle} min={0} max={359} onChange={(v) => setCap((c) => (c.effects[i].angle = v), false)} begin={begin} end={end} fmt={(v) => `${v}°`} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            />
            <div className="ins-h">Add</div>
            <div className="fx-tiles">
              {Object.entries(EFFECTS).map(([type, e]) => {
                const demo = { ...cap, effects: [{ ...EFFECTS[type].defaults, id: 'demo-' + type, type, on: true }], active: { ...cap.active, style: 'none' } };
                return (
                  <button
                    key={type}
                    className="fx-tile"
                    onClick={() => {
                      const add = newEffect(type);
                      setCap((c) => (type === 'stroke' ? c.effects.unshift(add) : c.effects.push(add)));
                      setOpenFx(add.id);
                    }}
                    title={`Add ${e.label}`}
                  >
                    <CapCanvas cap={demo} chunk={DEMO1} width={150} height={84} fill={0.5} />
                    <span>{e.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {curTab === 'motion' && (
          <>
            <div className="ins-block">
              <div className="ins-h">In</div>
              <div className="anim-grid">
                {ANIM_IN.map((a) => (
                  <button key={a} className={`anim-tile ${cap.anim.in === a ? 'on' : ''}`} onClick={() => setCap((c) => (c.anim.in = a))}>
                    <span className={`aa am-${a}`}>Aa</span>
                    <em>{ANIM_LABEL[a]}</em>
                  </button>
                ))}
              </div>
            </div>
            <div className="ins-block">
              <div className="ins-h">Out</div>
              <div className="anim-grid">
                {ANIM_OUT.map((a) => (
                  <button key={a} className={`anim-tile ${cap.anim.out === a ? 'on' : ''}`} onClick={() => setCap((c) => (c.anim.out = a))}>
                    <span className={`aa amo-${a}`}>Aa</span>
                    <em>{ANIM_LABEL[a]}</em>
                  </button>
                ))}
              </div>
            </div>
            <div className="ins-block">
              <Seg
                size="sm"
                value={cap.anim.mode}
                onChange={(v) => setCap((c) => (c.anim.mode = v))}
                options={[
                  { value: 'caption', label: 'Whole caption' },
                  { value: 'word', label: 'Word by word' },
                ]}
              />
              <Range label="Speed" value={Math.round((cap.anim.speed || 1) * 100)} min={50} max={200} onChange={(v) => setCap((c) => (c.anim.speed = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
            </div>
          </>
        )}
        {fontOpen && (
          <FontPicker
            value={cap}
            sample={settings.studio.sample ? settings.studio.sample.split(/\s+/).slice(0, 3).join(' ').toUpperCase() : 'WAIT FOR IT'}
            favorites={settings.studio.favorites}
            onPreview={(f) => onFontPreview(f)}
            onPick={(f) => {
              onFontPreview(null);
              setCap((c) => Object.assign(c, f));
              window.api.setSettings({ studio: { recentFonts: [f.font, ...(settings.studio.recentFonts || []).filter((x) => x !== f.font)].slice(0, 12) } });
              setFontOpen(false);
            }}
            onClose={() => (onFontPreview(null), setFontOpen(false))}
            onToggleFav={(fam) => {
              const favs = settings.studio.favorites || [];
              window.api.replaceSetting('studio.favorites', favs.includes(fam) ? favs.filter((x) => x !== fam) : [...favs, fam]);
            }}
          />
        )}
      </>
    );
  }

  return (
    <aside className="st-right">
      <div className="ins-head">
        <Icon name={icon} size={15} />
        <b>{title}</b>
        <div className="grow" />
        {sel && (
          <button className="icon-btn xs ghost" title="Back to the preset (Esc)" onClick={() => (setSel(null), setFraming(false))}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <div className="ins-body">{body}</div>
    </aside>
  );
}
