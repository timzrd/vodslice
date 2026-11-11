import { useMemo } from 'react';
import { Icon, Spinner } from './ui.jsx';
import { PremiereButton, AfterEffectsButton, ACTIVE, jobFiles } from './Jobs.jsx';
import { fmtBytes, fmtEta, fmtShort } from '../lib/time.js';

// Every step of a download has its own color, so you see at a glance that the clip is already there while
// Topaz is still enhancing the facecam.
export const PHASES = {
  download: { label: 'Download', icon: 'download', color: '#39c6ff' },
  process: { label: 'Cut', icon: 'scissors', color: '#2dd4bf' },
  chat: { label: 'Chat', icon: 'chat', color: '#ff9f43' },
  enhance: { label: 'Enhance', icon: 'sparkles', color: '#a78bfa' },
  premiere: { label: 'Captions + Premiere', icon: 'film', color: '#8f8fff' },
};

function phaseState(job, p) {
  const list = job.phases || ['download', 'process'];
  if (job.status === 'done') return 'done';
  const cur = list.indexOf(job.phase);
  const i = list.indexOf(p);
  if (job.status === 'error' || job.status === 'canceled') return i < cur ? 'done' : i === cur ? 'failed' : 'todo';
  if (cur < 0) return 'todo';
  return i < cur ? 'done' : i === cur ? 'active' : 'todo';
}

function Pipeline({ job }) {
  const list = job.phases || ['download', 'process'];
  return (
    <div className="pipe">
      {list.map((p, i) => {
        const st = phaseState(job, p);
        const m = PHASES[p];
        return (
          <div key={p} className={`pipe-step ${st}`} style={{ '--pc': m.color }}>
            <span className="ps-ico">{st === 'done' ? <Icon name="check" size={12} /> : st === 'active' ? <Spinner size={11} /> : st === 'failed' ? <Icon name="alert" size={12} /> : <Icon name={m.icon} size={12} />}</span>
            <span className="ps-label">{m.label}</span>
            {i < list.length - 1 && <span className="ps-line" />}
          </div>
        );
      })}
    </div>
  );
}

function BigJob({ job, notify, onCaptions, onStudio }) {
  const active = ACTIVE.includes(job.status);
  const pct = Math.round((job.progress || 0) * 100);
  const files = jobFiles(job);
  const dir = job.outputs && job.outputs[0] && job.outputs[0].dir;
  const phase = PHASES[job.phase] || null;
  const color = job.status === 'done' ? 'var(--ok)' : job.status === 'error' ? 'var(--err)' : phase ? phase.color : 'var(--muted)';
  const names = (job.names || []).length > 2 ? `${job.names[0]} – ${job.names.at(-1)}` : (job.names || []).join(', ');
  const ready = job.status === 'done' || job.filesReady;
  const status =
    job.status === 'done'
      ? `Done · ${files.length} file${files.length === 1 ? '' : 's'}`
      : job.status === 'error'
        ? job.error || 'Failed'
        : job.status === 'canceled'
          ? 'Canceled'
          : job.status === 'queued'
            ? 'Waiting for a free slot'
            : [job.stage, job.speed > 0 ? `${fmtBytes(job.speed)}/s` : '', fmtEta(job.eta)].filter(Boolean).join(' · ');
  return (
    <div className={`bigjob bj-${job.status} ${ready && active ? 'files-ready' : ''}`} style={{ '--jc': color }}>
      <div className="bj-thumb" style={job.thumbnail ? { backgroundImage: `url("${job.thumbnail}")` } : undefined}>
        {ready && active && (
          <span className="bj-badge">
            <Icon name="check" size={11} /> Clip ready
          </span>
        )}
      </div>
      <div className="bj-main">
        <div className="bj-top">
          <b className="bj-name">{names || job.title}</b>
          <span className="bj-title">
            {job.channel} · {job.title}
          </span>
        </div>
        <Pipeline job={job} />
        <div className="bj-bar">
          <span style={{ width: `${job.status === 'done' ? 100 : pct}%` }} />
        </div>
        <div className="bj-meta" title={job.error || ''}>
          <span className="bj-status">{status}</span>
          {active && job.status !== 'queued' && <span className="bj-pct">{pct}%</span>}
          {job.totalDuration ? <span className="muted">{fmtShort(job.totalDuration)}</span> : null}
          {job.quality ? <span className="muted">{job.quality}</span> : null}
          {job.preset ? <span className="muted">Preset: {job.preset}</span> : null}
          {job.warning ? (
            <span className="bj-warn" title={job.warning}>
              <Icon name="alert" size={11} /> {job.warning}
            </span>
          ) : null}
        </div>
        {ready && files.length > 0 && (
          <div className="bj-files">
            {files.map((f) => {
              const name = f.split(/[\\/]/).pop().replace(/\.(mp4|mov)$/i, '');
              return (
                <span
                  key={f}
                  className="file-chip"
                  draggable
                  title={`Drag ${name} into Premiere`}
                  onDragStart={(e) => {
                    e.preventDefault();
                    window.api.startDrag([f]);
                  }}
                >
                  <Icon name={/chat$/i.test(name) ? 'chat' : /facecam/i.test(name) ? (/enhanced/i.test(name) ? 'sparkles' : 'user') : 'film'} size={11} />
                  {name.replace(/^.* - /, '')}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="bj-actions">
        {job.status === 'done' && (
          <div className="bj-apps">
            <PremiereButton job={job} notify={notify} />
            <AfterEffectsButton job={job} notify={notify} />
          </div>
        )}
        {ready && (
          <button className="btn sm" onClick={() => onStudio(job)} title="Preview this clip in the Premiere tab with its real files and captions">
            <Icon name="phone" size={13} /> Preview layout
          </button>
        )}
        <div className="bj-icons">
          {job.status === 'done' && onCaptions && (job.outputs || []).some((o) => o.premiere && o.premiere.words) && (
            <button className="icon-btn sm" title="Edit captions" onClick={() => onCaptions(job)}>
              <Icon name="edit" size={14} />
            </button>
          )}
          {ready && (
            <span
              className="icon-btn sm bj-drag"
              draggable
              title="Drag all files into your editor"
              onDragStart={(e) => {
                e.preventDefault();
                window.api.startDrag(files);
              }}
            >
              <Icon name="grip" size={14} />
            </span>
          )}
          {dir && (
            <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(dir)}>
              <Icon name="folder" size={15} />
            </button>
          )}
          <button className="icon-btn sm ghost" title={active ? 'Cancel' : 'Remove from list'} onClick={() => window.api.cancelJob(job.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Downloads tab: running jobs with their pipeline, finished ones, and earlier downloads from history. */
export default function DownloadsView({ jobs, history, notify, onCaptions, onStudio, onClear }) {
  const running = jobs.filter((j) => ACTIVE.includes(j.status));
  const finished = [...jobs.filter((j) => !ACTIVE.includes(j.status))].reverse();
  const ids = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);
  const earlier = (history || []).filter((h) => !ids.has(h.id)).slice(0, 30);
  const avg = running.length ? running.reduce((a, j) => a + (j.progress || 0), 0) / running.length : 0;
  return (
    <div className="dlv">
      <div className="dlv-inner">
        <header className="dlv-head">
          <h1>Downloads</h1>
          <span className="dlv-sub">{running.length ? `${running.length} running · ${Math.round(avg * 100)}%` : jobs.length ? `${finished.length} finished this session` : 'Nothing running'}</span>
          <div className="grow" />
          <div className="dlv-legend">
            {Object.entries(PHASES).map(([k, m]) => (
              <span key={k} style={{ '--pc': m.color }}>
                <i /> {m.label}
              </span>
            ))}
          </div>
          {finished.length > 0 && (
            <button className="chip sm" onClick={onClear}>
              Clear finished
            </button>
          )}
          <button className="icon-btn sm" title="Mini overlay (always on top)" onClick={() => window.api.toggleMini()}>
            <Icon name="pip" size={14} />
          </button>
        </header>

        {!jobs.length && !earlier.length && (
          <div className="dlv-empty">
            <Icon name="download" size={28} />
            <b>No downloads yet</b>
            <span>Mark clips in Edit and hit Download — they show up here with every step.</span>
          </div>
        )}

        {running.length > 0 && (
          <section>
            <h2>Running</h2>
            {running.map((j) => (
              <BigJob key={j.id} job={j} notify={notify} onCaptions={onCaptions} onStudio={onStudio} />
            ))}
          </section>
        )}
        {finished.length > 0 && (
          <section>
            <h2>This session</h2>
            {finished.map((j) => (
              <BigJob key={j.id} job={j} notify={notify} onCaptions={onCaptions} onStudio={onStudio} />
            ))}
          </section>
        )}
        {earlier.length > 0 && (
          <section>
            <h2>Earlier</h2>
            <div className="dlv-earlier">
              {earlier.map((h) => {
                const dir = h.outputs && h.outputs[0] && h.outputs[0].dir;
                return (
                  <div key={h.id} className="ear">
                    <div className="ear-thumb" style={h.thumbnail ? { backgroundImage: `url("${h.thumbnail}")` } : undefined} />
                    <div className="ear-main">
                      <b>{(h.outputs || []).map((o) => o.name).join(', ') || h.title}</b>
                      <span>
                        {h.channel} · {new Date(h.at).toLocaleDateString()} {h.duration ? `· ${fmtShort(h.duration)}` : ''}
                      </span>
                    </div>
                    <button className="icon-btn sm" title="Preview in the Premiere tab" onClick={() => onStudio(h)}>
                      <Icon name="phone" size={14} />
                    </button>
                    {dir && (
                      <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(dir)}>
                        <Icon name="folder" size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
