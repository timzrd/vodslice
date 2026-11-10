import { useEffect, useMemo, useState } from 'react';
import { Icon, Seg, Toggle, Spinner } from './ui.jsx';
import { chunk, fmtTc } from '../lib/captions.js';
import { activePreset, updateActivePreset } from './studio/presetStore.js';

/**
 * Fix names/slang in the transcript and tune the caption rhythm, then rebuild SRT/overlay/XML —
 * without transcribing again.
 */
export default function CaptionsEditor({ job, settings, onClose, notify }) {
  const outs = (job.outputs || []).filter((o) => o.premiere && o.premiere.words);
  const [tab, setTab] = useState(0);
  const out = outs[tab];
  const [words, setWords] = useState(null);
  const [busy, setBusy] = useState(null);
  // rhythm lives in the active Premiere-tab preset, the timing offset in the Premiere settings
  const preset = activePreset(settings);
  const c = { ...settings.premiere.captions, maxWords: preset.captions.words, maxChars: preset.captions.maxChars, uppercase: preset.captions.caps === 'upper' };
  const setC = (patch) => {
    if ('offsetMs' in patch) window.api.setSettings({ premiere: { captions: { offsetMs: patch.offsetMs } } });
    if ('maxWords' in patch || 'maxChars' in patch || 'uppercase' in patch)
      updateActivePreset(settings, (p) => {
        if ('maxWords' in patch) p.captions.words = patch.maxWords;
        if ('maxChars' in patch) p.captions.maxChars = patch.maxChars;
        if ('uppercase' in patch) p.captions.caps = patch.uppercase ? 'upper' : 'none';
        return p;
      });
  };

  useEffect(() => {
    if (!out) return;
    setWords(null);
    window.api.premiereWords(out.premiere.words).then((d) => setWords(d ? d.words : []));
  }, [out && out.premiere.words]); // eslint-disable-line

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  const chunks = useMemo(() => (words ? chunk(words, c) : []), [words, c]);
  const setWord = (idx, w) => setWords((ws) => ws.map((x, i) => (i === idx ? { ...x, w } : x)));

  const rebuild = async (open) => {
    if (!out) return;
    setBusy('Saving');
    await window.api.premiereSaveWords(out.premiere.words, words.filter((w) => w.w.trim()).map((w) => ({ ...w, w: w.w.trim() })));
    const off = window.api.onPremiere((e) => e.dir === out.dir && setBusy(e.p > 0 && e.p < 1 ? `${e.label} ${Math.round(e.p * 100)}%` : e.label));
    const r = await window.api.premiereBuild({ dir: out.dir, name: out.name, prefix: out.prefix || '', reuse: true });
    off();
    if (!r.ok) {
      setBusy(null);
      return notify(`Captions: ${r.error}`, 'err', 7000);
    }
    if (open) {
      setBusy('Opening in Premiere');
      const res = await window.api.premiereOpen(r.project.files.xml);
      notify(res.ok ? 'Imported into Premiere' : 'Premiere not ready — XML path copied (Ctrl+I → Ctrl+V)', res.ok ? 'ok' : 'warn', 5000);
    } else notify('Captions updated', 'ok', 2000);
    setBusy(null);
  };

  return (
    <div className="drawer-wrap" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <aside className="drawer cap-drawer">
        <header className="drawer-head">
          <h2>Captions</h2>
          {outs.length > 1 && (
            <Seg size="sm" value={tab} onChange={setTab} options={outs.map((o, i) => ({ value: i, label: o.name }))} />
          )}
          <button className="icon-btn" onClick={onClose} disabled={!!busy} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="cap-tools">
          <label>
            <span>Words per caption</span>
            <Seg size="sm" value={c.maxWords} onChange={(v) => setC({ maxWords: v })} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
          </label>
          <label>
            <span>Max characters</span>
            <div className="slider-row">
              <input type="range" min="6" max="32" value={c.maxChars} onChange={(e) => setC({ maxChars: Number(e.target.value) })} />
              <span className="val">{c.maxChars}</span>
            </div>
          </label>
          <label>
            <span>Timing</span>
            <div className="slider-row">
              <input type="range" min="-500" max="500" step="10" value={c.offsetMs} onChange={(e) => setC({ offsetMs: Number(e.target.value) })} />
              <span className="val">{c.offsetMs > 0 ? '+' : ''}{c.offsetMs} ms</span>
            </div>
          </label>
          <label className="row">
            <span>CAPS</span>
            <Toggle checked={c.uppercase} onChange={(v) => setC({ uppercase: v })} />
          </label>
        </div>
        <div className="drawer-body cap-body">
          {!words && (
            <div className="cap-empty">
              <Spinner /> Loading transcript…
            </div>
          )}
          {words && !words.length && <div className="cap-empty">No speech found in this clip.</div>}
          {chunks.map((ch, i) => (
            <div key={i} className="cap-row">
              <span className="cap-time">{fmtTc(ch.start)}</span>
              <div className="cap-words">
                {ch.words.map((w) => (
                  <input
                    key={w.idx}
                    className="cap-word"
                    value={words[w.idx].w}
                    size={Math.max(2, words[w.idx].w.length)}
                    onChange={(e) => setWord(w.idx, e.target.value)}
                    spellCheck={false}
                    title={`${fmtTc(w.start)}–${fmtTc(w.end)} · empty = remove word`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <footer className="cap-foot">
          <span className="muted">Click a word to fix it. Layout and timing apply to SRT, overlay and the Premiere file.</span>
          <div className="grow" />
          <button className="btn" onClick={() => rebuild(false)} disabled={!!busy || !words}>
            {busy ? <Spinner size={12} /> : <Icon name="refresh" size={14} />} {busy || 'Rebuild'}
          </button>
          <button className="pr-btn ready" onClick={() => rebuild(true)} disabled={!!busy || !words}>
            <span className="pr-logo">Pr</span> Rebuild & open
          </button>
        </footer>
      </aside>
    </div>
  );
}
