import { useEffect, useState } from 'react';
import { Icon, Seg, Toggle, Spinner, Kbd } from './ui.jsx';
import TopazSettings from './TopazSettings.jsx';
import PremiereSettings from './PremiereSettings.jsx';
import KeyboardMap from './KeyMap.jsx';

function Row({ label, hint, children, wide }) {
  return (
    <div className={`srow ${wide ? 'wide' : ''}`}>
      <div className="srow-l">
        <div className="srow-label">{label}</div>
        {hint && <div className="srow-hint">{hint}</div>}
      </div>
      <div className="srow-r">{children}</div>
    </div>
  );
}

function Section({ title, icon, children, id }) {
  return (
    <section className="ssec" id={id ? `sec-${id}` : undefined}>
      <h3>
        <Icon name={icon} size={15} /> {title}
      </h3>
      {children}
    </section>
  );
}

export default function Settings({ settings, onClose, tools, topaz: topazInit, section }) {
  const s = settings;
  const [topaz, setTopaz] = useState(topazInit);
  useEffect(() => {
    if (!section) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`sec-${section}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [section]);
  const set = (patch) => window.api.setSettings(patch);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    window.api.appInfo().then(setInfo);
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const channels = Array.from(new Set([...Object.keys(s.output.counters || {}), ...Object.keys(s.output.aliases || {}), ...Object.keys(s.facecamPresets || {})]));

  const update = async () => {
    setBusy(true);
    setLog(null);
    try {
      setLog(await window.api.updateTools());
    } catch (e) {
      setLog([e.message]);
    }
    setBusy(false);
  };

  const v = (tools && tools.status && tools.status.versions) || (tools && tools.versions) || {};

  return (
    <div className="drawer-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="drawer-body">
          <Section title="Output" icon="folder">
            <Row label="Main folder" hint="Everything lands here.">
              <div className="path-row">
                <span className="path" title={s.output.baseDir}>
                  {s.output.baseDir || 'Not set'}
                </span>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const p = await window.api.pickFolder(s.output.baseDir);
                    if (p) set({ output: { baseDir: p } });
                  }}
                >
                  Change
                </button>
                <button className="icon-btn sm" title="Open" onClick={() => window.api.openPath(s.output.baseDir)}>
                  <Icon name="external" size={14} />
                </button>
              </div>
            </Row>
            <Row label="Save as" hint={s.output.mode === 'folders' ? 'New numbered folder per download, e.g. “DrDonut 70/Gameplay.mp4”.' : 'All files directly in the main folder, e.g. “DrDonut 70 - Gameplay.mp4”.'}>
              <Seg
                value={s.output.mode}
                onChange={(m) => set({ output: { mode: m } })}
                options={[
                  { value: 'folders', label: 'Numbered folders', icon: 'folders' },
                  { value: 'flat', label: 'One folder', icon: 'folder' },
                ]}
              />
            </Row>
            <Row label="Name" hint="Tokens: {channel} {n} {date} {title}">
              <input className="input" value={s.output.template} onChange={(e) => set({ output: { template: e.target.value } })} spellCheck={false} />
            </Row>
            <Row label="Numbering" hint={s.output.counterMode === 'auto' ? 'Looks at the main folder and continues after the highest number.' : 'Uses the number you set per channel and counts up from there.'}>
              <Seg
                value={s.output.counterMode}
                onChange={(m) => set({ output: { counterMode: m } })}
                options={[
                  { value: 'auto', label: 'Auto from folder' },
                  { value: 'manual', label: 'Manual counter' },
                ]}
              />
            </Row>
            {channels.length > 0 && (
              <Row label="Channels" hint="Display name used in folder names, and the next number (manual mode)." wide>
                <div className="chan-table">
                  {channels.map((k) => (
                    <div className="chan-row" key={k}>
                      <span className="chan-key" title={k}>
                        {k.replace(/^(youtube|twitch):/, '')}
                        <em>{k.split(':')[0]}</em>
                      </span>
                      <input
                        className="input sm"
                        placeholder="Display name"
                        value={(s.output.aliases || {})[k] || ''}
                        onChange={(e) => window.api.replaceSetting('output.aliases', { ...(s.output.aliases || {}), [k]: e.target.value })}
                      />
                      <input
                        className="input sm num"
                        type="number"
                        min="1"
                        title="Next number (manual mode)"
                        value={(s.output.counters || {})[k] || ''}
                        placeholder="#"
                        onChange={(e) => window.api.replaceSetting('output.counters', { ...(s.output.counters || {}), [k]: Number(e.target.value) || 1 })}
                      />
                      {(s.facecamPresets || {})[k] && (
                        <button
                          className="chip sm"
                          title="Forget the saved facecam box for this channel"
                          onClick={() => {
                            const p = { ...s.facecamPresets };
                            delete p[k];
                            window.api.replaceSetting('facecamPresets', p);
                          }}
                        >
                          <Icon name="user" size={11} /> Reset box
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Row>
            )}
            <Row label="File names">
              <div className="pair">
                <input className="input sm" value={s.output.gameplayName} onChange={(e) => set({ output: { gameplayName: e.target.value } })} />
                <input className="input sm" value={s.output.facecamName} onChange={(e) => set({ output: { facecamName: e.target.value } })} />
              </div>
            </Row>
            <Row label="Multiple clips" hint="Default — can be switched per download.">
              <Seg
                value={s.output.clipMode}
                onChange={(m) => set({ output: { clipMode: m } })}
                options={[
                  { value: 'separate', label: 'Own folders' },
                  { value: 'together', label: 'Same folder' },
                  { value: 'merge', label: 'Merge all' },
                ]}
              />
            </Row>
          </Section>

          <Section title="Quality" icon="film">
            <Row label="Max resolution">
              <Seg
                value={s.quality.maxHeight}
                onChange={(m) => set({ quality: { maxHeight: m } })}
                options={[
                  { value: 0, label: 'Best' },
                  { value: 1440, label: '1440p' },
                  { value: 1080, label: '1080p' },
                  { value: 720, label: '720p' },
                ]}
              />
            </Row>
            <Row
              label="Codec"
              hint={
                s.quality.codec === 'convert'
                  ? 'Highest resolution. VP9/AV1 gets converted to H.264 on your GPU so every editor opens it.'
                  : s.quality.codec === 'best'
                    ? 'Highest resolution in the original codec (VP9/AV1 possible). Fastest.'
                    : 'Only native H.264 streams (YouTube 1440p+ is VP9/AV1 only).'
              }
            >
              <Seg
                value={s.quality.codec}
                onChange={(m) => set({ quality: { codec: m } })}
                options={[
                  { value: 'convert', label: 'Editor-safe' },
                  { value: 'best', label: 'Original' },
                  { value: 'h264', label: 'H.264 only' },
                ]}
              />
            </Row>
            <Row label="Cutting" hint={s.cut.mode === 'fast' ? 'No re-encode, lossless. Starts on the nearest keyframe (≤2 s earlier).' : 'Frame-exact start/end, re-encoded at high quality (GPU).'}>
              <Seg
                value={s.cut.mode}
                onChange={(m) => set({ cut: { mode: m } })}
                options={[
                  { value: 'fast', label: 'Fast & lossless' },
                  { value: 'exact', label: 'Frame-exact' },
                ]}
              />
            </Row>
            <Row label="Extra handles" hint="Seconds added before and after every segment — room for transitions.">
              <div className="slider-row">
                <input type="range" min="0" max="10" step="1" value={s.cut.padding} onChange={(e) => set({ cut: { padding: Number(e.target.value) } })} />
                <span className="val">{s.cut.padding}s</span>
              </div>
            </Row>
          </Section>

          <Section title="Facecam" icon="user">
            <Row label="Facecam export on by default">
              <Toggle checked={s.facecam.enabled} onChange={(c) => set({ facecam: { enabled: c } })} />
            </Row>
            <Row label="Auto-detect" hint="When a channel has no saved box yet, find the cam automatically after loading.">
              <Toggle checked={s.facecam.autoDetect} onChange={(c) => set({ facecam: { autoDetect: c } })} />
            </Row>
            <Row label="Facecam quality" hint="Lower = cleaner input for AI upscaling (bigger file).">
              <div className="slider-row">
                <input type="range" min="0" max="23" step="1" value={s.facecam.crf} onChange={(e) => set({ facecam: { crf: Number(e.target.value) } })} />
                <span className="val">CRF {s.facecam.crf}</span>
              </div>
            </Row>
            <Row label="Keep audio in facecam file" hint="Handy for syncing in the editor.">
              <Toggle checked={s.facecam.includeAudio} onChange={(c) => set({ facecam: { includeAudio: c } })} />
            </Row>
          </Section>

          <Section title="Time picker" icon="clock">
            <Row label="Drag direction" hint="Press on hours / minutes / seconds and move the mouse.">
              <Seg
                value={s.ui.dragInvert ? 'down' : 'up'}
                onChange={(m) => set({ ui: { dragInvert: m === 'down' } })}
                options={[
                  { value: 'up', label: 'Up = more' },
                  { value: 'down', label: 'Down = more' },
                ]}
              />
            </Row>
            <Row label="Drag speed">
              <div className="slider-row">
                <input type="range" min="2" max="16" step="1" value={18 - s.ui.dragSensitivity} onChange={(e) => set({ ui: { dragSensitivity: 18 - Number(e.target.value) } })} />
                <span className="val">{s.ui.dragSensitivity}px/step</span>
              </div>
            </Row>
          </Section>

          <Section title="Downloads" icon="download" id="downloads">
            <Row label="Parallel connections" hint="More = faster on fast internet.">
              <div className="slider-row">
                <input type="range" min="4" max="32" step="2" value={s.download.connections} onChange={(e) => set({ download: { connections: Number(e.target.value) } })} />
                <span className="val">{s.download.connections}</span>
              </div>
            </Row>
            <Row label="Downloads at once">
              <Seg
                value={s.download.concurrentJobs}
                onChange={(m) => set({ download: { concurrentJobs: m } })}
                options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))}
              />
            </Row>
            <Row
              label="YouTube / Twitch login"
              hint="Uses your own login from the browser — for “Sign in to confirm you’re not a bot”, sub-only and age-restricted videos. Firefox works best; Chrome / Edge lock their cookies while they are open, use a cookies.txt then."
            >
              <select
                className="input sm"
                value={s.download.cookiesFile ? '__file' : s.download.cookiesFromBrowser}
                onChange={async (e) => {
                  const v = e.target.value;
                  if (v === '__file') {
                    const f = await window.api.pickFile([{ name: 'cookies.txt', extensions: ['txt'] }]);
                    if (f) set({ download: { cookiesFile: f, cookiesFromBrowser: '' } });
                  } else set({ download: { cookiesFromBrowser: v, cookiesFile: '' } });
                }}
              >
                <option value="">None</option>
                <option value="firefox">Firefox</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="brave">Brave</option>
                <option value="opera">Opera</option>
                <option value="__file">{s.download.cookiesFile ? `File: ${s.download.cookiesFile.split(/[\\/]/).pop()}` : 'cookies.txt file…'}</option>
              </select>
            </Row>
          </Section>

          <Section title="Behavior" icon="settings">
            <Row label="Notification when done">
              <Toggle checked={s.ui.notify} onChange={(c) => set({ ui: { notify: c } })} />
            </Row>
            <Row label="Open folder when done">
              <Toggle checked={s.ui.openFolderWhenDone} onChange={(c) => set({ ui: { openFolderWhenDone: c } })} />
            </Row>
            <Row label="Mini overlay on minimize" hint="Shows the progress overlay when you minimize during a download.">
              <Toggle checked={s.ui.miniAutoShow} onChange={(c) => set({ ui: { miniAutoShow: c } })} />
            </Row>
          </Section>

          <Section title="Premiere" icon="film" id="premiere">
            <PremiereSettings settings={s} />
          </Section>

          <Section title="Topaz Video AI" icon="sparkles" id="topaz">
            <TopazSettings settings={s} topaz={topaz} onRescan={() => window.api.topazStatus(true).then(setTopaz)} />
          </Section>

          <Section title="Tools" icon="refresh">
            <Row label="yt-dlp" hint="Downloader core">
              <span className="ver">{v.ytdlp || '—'}</span>
            </Row>
            <Row label="FFmpeg">
              <span className="ver">{v.ffmpeg || '—'}</span>
            </Row>
            <Row label="Deno" hint="JS runtime yt-dlp needs for YouTube">
              <span className="ver">{v.deno || '—'}</span>
            </Row>
            <Row label="Auto-update" hint="yt-dlp is checked twice a day — sites change often.">
              <Toggle checked={s.tools.autoUpdate} onChange={(c) => set({ tools: { autoUpdate: c } })} />
            </Row>
            <Row label="">
              <div className="path-row">
                <button className="btn" onClick={update} disabled={busy}>
                  {busy ? <Spinner /> : <Icon name="refresh" size={14} />} {busy ? (tools && tools.progress && tools.progress.label) || 'Updating…' : 'Update everything now'}
                </button>
                {info && (
                  <button className="chip sm" onClick={() => window.api.openPath(info.userData)}>
                    Data folder
                  </button>
                )}
              </div>
            </Row>
            {log && (
              <pre className="log">
                {log.join('\n')}
              </pre>
            )}
          </Section>

          <Section title="Hotkeys" icon="keyboard" id="keys">
            <KeyboardMap />
          </Section>
          <p className="about">Vodslice {info && info.version}</p>
        </div>
      </aside>
    </div>
  );
}
