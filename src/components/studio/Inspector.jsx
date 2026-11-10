import { useEffect, useRef, useState } from 'react';
import { Icon, Seg, Toggle } from '../ui.jsx';
import { frameSize, LOOKS, EFFECTS, ANIM_IN, ANIM_OUT, newEffect, captionState } from '../../../electron/layout.mjs';
import { drawCaption, ensureFont, measureCaption } from '../../lib/captionDraw.js';
import { WEIGHT_NAMES, BUNDLED } from '../../lib/fonts.js';
import FontPicker from './FontPicker.jsx';

const SWATCHES = ['#ffffff', '#ffd23f', '#ffe14d', '#4ade80', '#2bff88', '#39c6ff', '#8b5cf6', '#ff6fae', '#ff4d4d', '#ff9f43', '#000000'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Number you can drag left/right (or click to type) — no mouse wheel needed. */
function Num({ value, onChange, min = -99999, max = 99999, step = 1, unit = '', begin, end, label }) {
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
      if (!drag.current.moved) setEdit(String(Math.round(value * 100) / 100));
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
          {Math.round(value * 10) / 10}
          {unit}
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

function Color({ value, onChange, label }) {
  return (
    <div className="ins-color">
      {label && <span className="ic-l">{label}</span>}
      <div className="ic-row">
        <label className="ic-pick" style={{ background: value }} title="Any color">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
        {SWATCHES.map((c) => (
          <button key={c} className={`ic-sw ${c.toLowerCase() === (value || '').toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} title={c} />
        ))}
      </div>
    </div>
  );
}

const DEMO = { start: 0, end: 1, words: [{ w: 'wait', start: 0, end: 0.3 }, { w: 'for', start: 0.3, end: 0.6 }, { w: 'it', start: 0.6, end: 1 }] };

/** A caption look rendered with the real caption renderer. */
function LookCard({ cap, onClick, on, name }) {
  const ref = useRef(null);
  const key = JSON.stringify(cap);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const c = ref.current;
      if (!c || !alive) return;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const st = captionState([DEMO], 0.45, { ...cap, anim: { ...cap.anim, in: 'none', out: 'none', mode: 'caption' } });
      const m = measureCaption(ctx, DEMO, cap, { x: 0, y: 0, w: 100000 }, 1);
      const k = Math.min(0.5, (c.width * 0.84) / Math.max(1, m.width), (c.height * 0.6) / (cap.size * (cap.lineHeight || 1.08)));
      drawCaption(ctx, st, cap, { x: c.width / 2 / k, y: c.height / 2 / k, w: 100000 }, { k });
    };
    draw();
    ensureFont(cap).then(draw);
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line
  return (
    <button className={`look ${on ? 'on' : ''}`} onClick={onClick} title={`Apply “${name}” (keeps size, words and position)`}>
      <canvas ref={ref} width={300} height={110} />
      <span>{name}</span>
    </button>
  );
}

const ANIM_LABEL = { none: 'None', fade: 'Fade', pop: 'Pop', bounce: 'Bounce', rise: 'Rise', slide: 'Slide', zoom: 'Zoom', blur: 'Blur in', sink: 'Sink', shrink: 'Shrink' };

export default function Inspector({ preset, sel, setSel, patch, patchLayer, begin, end, settings, tab, setTab, framing, setFraming, onFontPreview, clip, realWords, onGoEdit, hasFacecam }) {
  const [W, H] = frameSize(preset.ratio);
  const [fontOpen, setFontOpen] = useState(false);
  const [openFx, setOpenFx] = useState(null);
  const cap = preset.captions;
  const setCap = (fn, rec) => patch((p) => (fn(p.captions, p), p), rec);
  const l = sel ? preset.layers.find((x) => x.type === sel) : null;

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
        <button className="chip sm" title="Center horizontally" onClick={() => patchLayer(sel, (x) => (x.rect = { ...x.rect, x: (1 - x.rect.w) / 2 }))}>
          ↔ Center
        </button>
      </div>
    </div>
  );

  const framingBlock = l && l.view && (
    <div className="ins-block">
      <div className="ins-h">
        Framing
        <span className="ins-sub">which part of the {sel === 'facecam' ? 'cam' : 'video'} fills the box</span>
      </div>
      <Range label="Zoom" value={Math.round(l.view.zoom * 100)} min={100} max={400} step={1} fmt={(v) => `${v}%`} begin={begin} end={end} onChange={(v) => patchLayer(sel, (x) => (x.view = { ...x.view, zoom: v / 100 }), false)} />
      <div className="row gap">
        <button className={`btn sm ${framing ? 'primary' : ''}`} onClick={() => setFraming(!framing)} title="Double-click the box or press Enter">
          <Icon name="frame" size={13} /> {framing ? 'Done framing' : 'Adjust framing'}
        </button>
        <button className="btn sm" onClick={() => patchLayer(sel, (x) => (x.view = { zoom: 1, cx: 0.5, cy: 0.5 }))}>
          Reset
        </button>
      </div>
    </div>
  );

  let body = null;
  let title = 'Preset';
  let icon = 'layers';

  if (!sel) {
    body = (
      <>
        <div className="ins-block">
          <div className="ins-h">Preset</div>
          <p className="ins-p">
            <b>{preset.name}</b> builds every Premiere sequence: {preset.ratio} · {W}×{H}. Click a layer on the video to change it.
          </p>
          <label className="row between">
            <span>Captions</span>
            <Toggle checked={preset.layers.find((x) => x.type === 'captions').on} onChange={(v) => patchLayer('captions', (x) => (x.on = v))} />
          </label>
        </div>
        <div className="ins-block tips">
          <div className="ins-h">Handy</div>
          <ul>
            <li><b>Drag</b> boxes — they snap to edges, centers and each other (<b>Alt</b> = free)</li>
            <li><b>Shift</b> + corner keeps the ratio</li>
            <li><b>Double-click</b> gameplay / facecam to choose what fills the box</li>
            <li><b>Arrows</b> nudge 1 px (Shift 10) · <b>Tab</b> next layer</li>
            <li><b>Ctrl+Z</b> undo · <b>Space</b> play</li>
            <li>Drag a <b>text effect</b> from the left onto the video</li>
          </ul>
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
        <div className="ins-block">
          <p className="ins-p">
            {clip ? 'Uses the Facecam file of this clip.' : hasFacecam ? 'The cam comes from the facecam box in Edit — any size fits, it is scaled to fill this box.' : 'No facecam box yet: draw it once on the video in Edit (or press D there to detect it).'}
          </p>
          {!clip && (
            <button className="btn sm" onClick={onGoEdit}>
              <Icon name="scissors" size={13} /> Facecam box in Edit
            </button>
          )}
        </div>
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
            <span>Export the chat overlay</span>
            <Toggle checked={!!settings.chat.enabled} onChange={(v) => window.api.setSettings({ chat: { enabled: v } })} />
          </label>
          <Range label="Text size" value={settings.chat.fontSize} min={16} max={48} onChange={(v) => window.api.setSettings({ chat: { fontSize: v } })} fmt={(v) => `${v}px`} />
          <p className="ins-p">The chat is rendered exactly at the size of this box (Twitch VODs/clips, YouTube streams with chat replay).</p>
        </div>
      </>
    );
  } else if (sel === 'captions') {
    title = 'Captions';
    icon = 'type';
    const font = BUNDLED.find((f) => f.family === cap.font);
    const weights = font ? font.weights : cap.fontWeights && cap.fontWeights.length ? cap.fontWeights : [400, 700, 900];
    body = (
      <>
        <div className="ins-tabs">
          {[
            ['look', 'Looks', 'wand'],
            ['text', 'Text', 'type'],
            ['effects', 'Effects', 'fx'],
            ['motion', 'Motion', 'motion'],
          ].map(([k, label, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <Icon name={ic} size={13} /> {label}
            </button>
          ))}
        </div>

        {tab === 'look' && (
          <div className="ins-block">
            <div className="looks">
              {LOOKS.map((lk) => {
                const merged = { ...cap, ...lk.style, active: { ...cap.active, ...lk.style.active }, anim: { ...cap.anim, ...lk.style.anim } };
                return (
                  <LookCard
                    key={lk.id}
                    name={lk.name}
                    cap={merged}
                    on={cap.font === lk.style.font && cap.color === lk.style.color && (cap.effects || []).map((e) => e.type).join() === lk.style.effects.map((e) => e.type).join()}
                    onClick={() => setCap((c) => Object.assign(c, JSON.parse(JSON.stringify({ ...lk.style, tracking: lk.style.tracking || 0 }))))}
                  />
                );
              })}
            </div>
            <p className="ins-p">Then fine-tune font, effects and motion in the other tabs — everything is saved in this preset.</p>
          </div>
        )}

        {tab === 'text' && (
          <>
            <div className="ins-block">
              <div className="ins-h">Font</div>
              <button className="font-btn" onClick={() => setFontOpen(true)} title="Browse all fonts">
                <span style={{ fontFamily: `"${cap.font}", sans-serif`, fontWeight: cap.weight }}>{cap.font}</span>
                <Icon name="chevronRight" size={14} />
              </button>
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
              <label className="row between">
                <span className="ins-l">Keep punctuation</span>
                <Toggle checked={!!cap.punct} onChange={(v) => setCap((c) => (c.punct = v))} />
              </label>
              <Range label="Letter spacing" value={cap.tracking || 0} min={-10} max={30} onChange={(v) => setCap((c) => (c.tracking = v), false)} begin={begin} end={end} />
              <Range label="Line height" value={Math.round((cap.lineHeight || 1.08) * 100)} min={80} max={160} onChange={(v) => setCap((c) => (c.lineHeight = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
            </div>
            <div className="ins-block">
              <div className="ins-h">Color</div>
              <Color value={cap.color} onChange={(v) => setCap((c) => (c.color = v))} />
            </div>
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
              {cap.active.style !== 'none' && (
                <>
                  <Color value={cap.active.color} onChange={(v) => setCap((c) => (c.active.color = v))} />
                  <Range label="Scale" value={Math.round((cap.active.scale || 1) * 100)} min={100} max={140} onChange={(v) => setCap((c) => (c.active.scale = v / 100), false)} begin={begin} end={end} fmt={(v) => `${v}%`} />
                </>
              )}
            </div>
            <div className="ins-block">
              <div className="ins-h">Rhythm</div>
              <div className="row between">
                <span className="ins-l">Words per caption</span>
                <Seg size="sm" value={cap.words} onChange={(v) => setCap((c) => (c.words = v))} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
              </div>
              <Range label="Max characters" value={cap.maxChars} min={6} max={36} onChange={(v) => setCap((c) => (c.maxChars = v), false)} begin={begin} end={end} />
              <div className="row between">
                <span className="ins-l">Spoken language</span>
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
              {!realWords && (
                <label className="ins-sample">
                  <span className="ins-l">Preview text</span>
                  <input className="input sm" value={settings.studio.sample || ''} onChange={(e) => window.api.setSettings({ studio: { sample: e.target.value } })} spellCheck={false} />
                </label>
              )}
            </div>
          </>
        )}

        {tab === 'effects' && (
          <div className="ins-block">
            <div className="ins-h">
              Effect stack
              <span className="ins-sub">top = right under the text</span>
            </div>
            {!cap.effects.length && <p className="ins-p">No effects. Add one below or drag one from the left onto the video.</p>}
            <div className="fx-stack">
              {cap.effects.map((e, i) => (
                <div key={e.id} className={`fx-item ${e.on ? '' : 'off'} ${openFx === e.id ? 'open' : ''}`}>
                  <div className="fx-row" onClick={() => setOpenFx(openFx === e.id ? null : e.id)}>
                    <button className="icon-btn xs ghost" onClick={(ev) => (ev.stopPropagation(), setCap((c) => (c.effects[i].on = !c.effects[i].on)))} title={e.on ? 'Turn off' : 'Turn on'}>
                      <Icon name={e.on ? 'eye' : 'eyeOff'} size={13} />
                    </button>
                    <span className="fx-dot" style={{ background: e.color }} />
                    <b>{EFFECTS[e.type].label}</b>
                    <div className="grow" />
                    <button className="icon-btn xs ghost" disabled={i === 0} title="Move up" onClick={(ev) => (ev.stopPropagation(), setCap((c) => c.effects.splice(i - 1, 0, c.effects.splice(i, 1)[0])))}>
                      <Icon name="arrowUp" size={12} />
                    </button>
                    <button className="icon-btn xs ghost" disabled={i === cap.effects.length - 1} title="Move down" onClick={(ev) => (ev.stopPropagation(), setCap((c) => c.effects.splice(i + 1, 0, c.effects.splice(i, 1)[0])))}>
                      <Icon name="arrowDown" size={12} />
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
              ))}
            </div>
            <div className="fx-add">
              {Object.entries(EFFECTS).map(([type, e]) => (
                <button
                  key={type}
                  className="chip sm"
                  onClick={() => {
                    const fx = newEffect(type);
                    setCap((c) => (type === 'stroke' ? c.effects.unshift(fx) : c.effects.push(fx)));
                    setOpenFx(fx.id);
                  }}
                >
                  <Icon name="plus" size={11} /> {e.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'motion' && (
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
              <div className="ins-h">Out <span className="ins-sub">plays when a pause follows</span></div>
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
              <div className="row between">
                <span className="ins-l">Animate</span>
                <Seg
                  size="sm"
                  value={cap.anim.mode}
                  onChange={(v) => setCap((c) => (c.anim.mode = v))}
                  options={[
                    { value: 'caption', label: 'Whole caption' },
                    { value: 'word', label: 'Word by word' },
                  ]}
                />
              </div>
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
