import { useState } from 'react';
import { Icon, Seg, Toggle, Spinner, Kbd, Popover } from './ui.jsx';
import { fmt, fmtShort, fmtBytes } from '../lib/time.js';

import { presetSize } from '../../electron/layout.mjs';
import { updateActivePreset } from './studio/presetStore.js';

/** One export option: icon, label, summary, switch; click the row to show its details. */
function Opt({ id, open, setOpen, icon, label, summary, on, onToggle, children, busy, disabled, title }) {
  const isOpen = open === id;
  return (
    <div className={`opt ${on ? 'on' : ''} ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <div className="opt-row" onClick={() => !disabled && children && setOpen(isOpen ? null : id)} title={title}>
        <span className="opt-ico">{busy ? <Spinner size={13} /> : <Icon name={icon} size={15} />}</span>
        <span className="opt-text">
          <b>{label}</b>
          <em>{summary}</em>
        </span>
        {children && <Icon name="chevronDown" size={13} className="opt-caret" />}
        <span onClick={(e) => e.stopPropagation()}>
          <Toggle checked={on} onChange={onToggle} />
        </span>
      </div>
      {isOpen && children && <div className="opt-body">{children}</div>}
    </div>
  );
}

export default function ExportPanel({ x }) {
  const [open, setOpen] = useState(null);
  const s = x.settings;
  const capsOn = !!(x.preset && x.preset.layers.find((l) => l.type === 'captions' && l.on));
  const tz = s.topaz;
  const n = x.selected.length;
  const canDl = n > 0;
  return (
    <div className="export">
      <div className="export-head">
        <span className="h-title">Export</span>
        <span className="h-sub">{x.filesLabel}</span>
      </div>
      <div className="opts">
        <Opt
          id="fc"
          open={open}
          setOpen={setOpen}
          icon="user"
          label="Facecam file"
          summary={x.detecting || (x.facecamOn ? (x.fcKeys.length > 1 ? `${x.fcKeys.length} positions over time` : x.hasBox ? 'Own file · box set' : 'Draw the box on the video') : 'Off — gameplay only')}
          on={x.facecamOn}
          onToggle={x.toggleFacecam}
          busy={!!x.detecting}
          title="Export the facecam as its own file (F)"
        >
          <button className="btn sm full" disabled={!!x.detecting} onClick={() => x.runDetect()}>
            {x.detecting ? <Spinner size={12} /> : <Icon name="sparkles" size={13} />} {x.detecting || (x.fcKeys.length > 1 ? 'Detect this position' : 'Detect automatically')}
            <Kbd>D</Kbd>
          </button>
          <div className="pc-row">
            <span className="pc-label">Positions</span>
            <div className="layout-list">
              {x.fcKeys.map((k, i) => (
                <div key={k.id} className={`layout-row ${x.activeKey && x.activeKey.id === k.id ? 'on' : ''}`}>
                  <button className="layout-jump" onClick={() => x.seek(k.t)}>
                    <b>{i + 1}</b> from {i === 0 ? 'start' : fmt(k.t)}
                  </button>
                  {i > 0 && (
                    <button className="icon-btn xs ghost" title="Remove" onClick={() => x.deleteLayout(k.id)}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button className="add-seg" onClick={x.addLayout} title="The streamer moved the cam? Add a new position from the playhead">
                <Icon name="plus" size={12} /> New position at {fmt(x.playhead)}
              </button>
            </div>
          </div>
          <div className="pc-row">
            <span className="pc-label">Box ratio</span>
            <Seg
              size="sm"
              value={x.aspectLock ? x.aspectLock.toFixed(4) : 'free'}
              onChange={(v) => x.setAspectLock(v === 'free' ? null : Number(v))}
              options={[
                { value: 'free', label: 'Free' },
                { value: (16 / 9).toFixed(4), label: '16:9' },
                { value: (4 / 3).toFixed(4), label: '4:3' },
                { value: (1).toFixed(4), label: '1:1' },
              ]}
            />
            <span className="pc-hint">Shift while resizing keeps the current ratio.</span>
          </div>
        </Opt>

        {x.topazFound && (
          <Opt
            id="tz"
            open={open}
            setOpen={setOpen}
            icon="sparkles"
            label="Enhance facecam"
            summary={x.enhanceOn ? `Topaz · ${x.tzLabel}` : x.facecamOn ? 'Topaz Video AI · off' : 'Needs the facecam file'}
            on={x.enhanceOn}
            disabled={!x.facecamOn}
            onToggle={(v) => window.api.setSettings({ topaz: { enabled: v } })}
            title="Upscale the facecam with Topaz Video AI after the download"
          >
            <div className="opt-list">
              {tz.presets.map((p) => (
                <button key={p.id} className={`menu-item ${x.enhanceOn && p.id === tz.preset ? 'on' : ''}`} onClick={() => window.api.setSettings({ topaz: { enabled: true, preset: p.id } })}>
                  <Icon name="sparkles" size={12} /> {p.name}
                </button>
              ))}
              <button className="menu-item muted" onClick={() => x.openSettings('topaz')}>
                <Icon name="settings" size={12} /> Edit presets…
              </button>
            </div>
          </Opt>
        )}

        <Opt
          id="pr"
          open={open}
          setOpen={setOpen}
          icon="film"
          label="Premiere sequence"
          summary={x.premiereOn ? `${x.preset.name} · ${presetSize(x.preset).join('×')}${capsOn ? ' · captions' : ''}` : 'Vertical edit + captions, ready to open'}
          on={x.premiereOn}
          onToggle={(v) => window.api.setSettings({ premiere: { enabled: v } })}
          title="Build captions + a vertical Premiere sequence after the download (layout from the Premiere tab)"
        >
          <span className="pc-label">Layout preset</span>
          <div className="preset-chips">
            {x.presets.map((p) => (
              <button key={p.id} className={`chip sm ${p.id === x.preset.id ? 'on' : ''}`} onClick={() => window.api.setSettings({ studio: { active: p.id } })}>
                {p.name}
                <span className="muted">{p.ratio}</span>
              </button>
            ))}
          </div>
          <label className="row between">
            <span className="pc-label">Captions</span>
            <Toggle checked={capsOn} onChange={(v) => updateActivePreset(s, (p) => ((p.layers.find((l) => l.type === 'captions').on = v), p))} />
          </label>
          <button className="btn sm full primary" onClick={() => x.onOpenStudio && x.onOpenStudio()}>
            <Icon name="phone" size={13} /> Design layout & captions
          </button>
          <p className="pc-hint">The Premiere tab shows exactly what the sequence will look like — position the cam and gameplay, pick fonts, effects and animations, save presets.</p>
        </Opt>

        <Opt
          id="chat"
          open={open}
          setOpen={setOpen}
          icon="chat"
          label="Chat overlay"
          summary={s.chat && s.chat.enabled ? `Chat.mov · transparent · ${s.chat.width}×${s.chat.height}` : 'Twitch / YouTube chat with emotes'}
          on={!!(s.chat && s.chat.enabled)}
          onToggle={(v) => window.api.setSettings({ chat: { enabled: v } })}
          title="Render the chat of each clip as a transparent video (colored names, 7TV / BTTV / FFZ emotes)"
        >
          <div className="pc-row">
            <span className="pc-label">Size</span>
            <Seg
              size="sm"
              value={`${s.chat.width}x${s.chat.height}`}
              onChange={(v) => {
                const [w, h] = v.split('x').map(Number);
                window.api.setSettings({ chat: { width: w, height: h } });
              }}
              options={[
                { value: '520x820', label: 'Tall' },
                { value: '640x640', label: 'Square' },
                { value: '900x420', label: 'Wide' },
              ]}
            />
          </div>
          <div className="pc-row">
            <span className="pc-label">Text size · {s.chat.fontSize}px</span>
            <input type="range" min="16" max="44" step="1" value={s.chat.fontSize} onChange={(e) => window.api.setSettings({ chat: { fontSize: Number(e.target.value) } })} />
          </div>
          <p className="pc-hint">Twitch VODs and clips (their VOD must still exist) and YouTube streams with chat replay. Lands as Chat.mov next to the gameplay — and on its own track in the Premiere sequence (turn on the Chat layer in the Premiere tab to place it).</p>
        </Opt>

      </div>

      <div className="out-rows">
        <Popover
          up
          trigger={({ toggle }) => (
            <button className="out-chip wide" onClick={toggle} title={s.output.baseDir}>
              <Icon name={s.output.mode === 'folders' ? 'folders' : 'folder'} size={15} />
              <span className="out-path">{(s.output.baseDir || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || 'Choose folder'}</span>
              <Icon name="chevronRight" size={12} className="sep" />
              <span className="out-name">{x.outName || '—'}</span>
            </button>
          )}
        >
          {({ close }) => x.folderCard(close)}
        </Popover>
        <div className="out-line">
          <Popover
            up
            trigger={({ toggle }) => (
              <button className="out-chip" onClick={toggle} title="Quality of the video in the player (each video keeps its own)">
                <b>{x.q ? x.q.label : '—'}</b>
                <span className="muted">{x.q ? x.q.codec : ''}</span>
                {x.q && x.q.codec !== 'H.264' && s.quality.codec === 'convert' && <span className="tag">→ H.264</span>}
                <Icon name="chevronDown" size={12} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="menu tall">
                {(x.qualities || []).map((qq) => (
                  <button
                    key={qq.key}
                    className={`menu-item ${x.q && qq.key === x.q.key ? 'on' : ''}`}
                    onClick={() => {
                      x.setQuality(qq.key);
                      close();
                    }}
                  >
                    <b>{qq.label}</b>
                    <span className="muted">{qq.codec}</span>
                    {qq.tbr ? <span className="muted r">{fmtBytes((qq.tbr * 1000 * Math.max(60, x.totalDur)) / 8)}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          {n > 1 && (
            <Seg
              size="sm"
              value={x.clipMode}
              onChange={x.setClipMode}
              title="How several clips are saved"
              options={[
                { value: 'separate', label: 'Folders', title: 'Every clip gets its own numbered folder' },
                { value: 'together', label: 'One folder', title: 'All clips as separate files in one folder' },
                { value: 'merge', label: 'Merge', title: 'Join all clips into one video' },
              ]}
            />
          )}
        </div>
      </div>

      <button className={`dl-btn ${canDl ? 'ready' : ''}`} onClick={() => x.download()} disabled={!canDl} title={canDl ? 'Download the checked clips (Ctrl+Enter)' : 'Mark a clip on the timeline first'}>
        <Icon name="download" size={19} />
        <span className="dl-main">{canDl ? `Download ${n} clip${n > 1 ? 's' : ''}` : 'No clip checked'}</span>
        <span className="dl-sub">
          {canDl ? `${fmtShort(x.totalDur)}${x.estBytes ? ` · ~${fmtBytes(x.estBytes)}` : ''}` : 'Drag on the timeline or press I / O'}
        </span>
      </button>
    </div>
  );
}
