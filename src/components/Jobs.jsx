import { useEffect, useState } from 'react';
import { Icon, Spinner } from './ui.jsx';
import { fmtBytes, fmtEta } from '../lib/time.js';

const OPEN_MSG = {
  OK: ['Imported into Premiere — the sequence is in your project panel', 'ok'],
  NO_PROJECT: ['Open a project in Premiere first, then click again (path is copied: Ctrl+I → Ctrl+V)', 'warn'],
  NOT_RUNNING: ['Starting Premiere — open your project, then click again', 'warn'],
  NOT_INSTALLED: ['Premiere Pro not found — the XML path is copied to the clipboard', 'warn'],
};

/** Build (if needed) and import every output of a job into Premiere. */
export function PremiereButton({ job, notify, compact }) {
  const [busy, setBusy] = useState(null);
  const outs = (job.outputs || []).filter((o) => o.dir);
  useEffect(() => {
    if (!busy) return;
    return window.api.onPremiere((e) => outs.some((o) => o.dir === e.dir) && setBusy({ label: e.label, p: e.p }));
  }, [!!busy]); // eslint-disable-line
  const ready = outs.length && outs.every((o) => o.premiere && o.premiere.xml);
  const go = async () => {
    if (busy) return;
    for (const o of outs) {
      let xml = o.premiere && o.premiere.xml;
      if (!xml) {
        setBusy({ label: 'Preparing', p: 0 });
        const r = await window.api.premiereBuild({ dir: o.dir, name: o.name, prefix: o.prefix || '' });
        if (!r.ok) {
          setBusy(null);
          return notify && notify(`Premiere: ${r.error}`, 'err', 8000);
        }
        xml = r.project.files.xml;
        o.premiere = { ...(o.premiere || {}), xml, words: r.project.files.words, dir: o.dir };
      }
      setBusy({ label: 'Opening in Premiere', p: 1 });
      const res = await window.api.premiereOpen(xml);
      const [msg, tone] = OPEN_MSG[res.code] || ['Could not reach Premiere — path copied: Ctrl+I → Ctrl+V → Enter', 'warn'];
      notify && notify(msg, tone, tone === 'ok' ? 3500 : 7000);
      if (!res.ok) break;
      await new Promise((r) => setTimeout(r, 900));
    }
    setBusy(null);
  };
  if (!outs.length) return null;
  return (
    <button className={`pr-btn ${ready ? 'ready' : ''} ${compact ? 'compact' : ''}`} onClick={go} disabled={!!busy} title={ready ? 'Import the vertical sequence into the open Premiere project' : 'Create captions + vertical sequence, then import into Premiere'}>
      {busy ? <Spinner size={12} /> : <span className="pr-logo">Pr</span>}
      {!compact && <span>{busy ? `${busy.label}${busy.p > 0 && busy.p < 1 ? ` ${Math.round(busy.p * 100)}%` : ''}` : 'Open in Premiere'}</span>}
    </button>
  );
}

export const ACTIVE = ['queued', 'preparing', 'downloading', 'processing'];

export function jobFiles(job) {
  return (job.outputs || []).flatMap((o) => o.files || []);
}

export function JobRow({ job, compact, notify, onCaptions }) {
  const active = ACTIVE.includes(job.status);
  const pct = Math.round((job.progress || 0) * 100);
  const files = jobFiles(job);
  const dir = job.outputs && job.outputs[0] && job.outputs[0].dir;
  const names = (job.names || []).length > 2 ? `${job.names[0]} – ${job.names.at(-1)}` : (job.names || []).join(', ');
  const meta =
    job.status === 'done'
      ? `Done · ${files.length} file${files.length === 1 ? '' : 's'}${job.warning ? ` · ${job.warning}` : ''}`
      : job.status === 'error'
        ? job.error || 'Failed'
        : job.status === 'canceled'
          ? 'Canceled'
          : [job.stage, `${pct}%`, job.speed > 0 ? `${fmtBytes(job.speed)}/s` : '', fmtEta(job.eta)].filter(Boolean).join(' · ');

  const dragStart = (e) => {
    e.preventDefault();
    window.api.startDrag(files);
  };

  return (
    <div className={`job job-${job.status} ${compact ? 'compact' : ''}`}>
      {!compact && <div className="job-thumb" style={job.thumbnail ? { backgroundImage: `url("${job.thumbnail}")` } : undefined} />}
      <div className="job-main">
        <div className="job-top">
          <span className="job-name">{names || job.title}</span>
          {!compact && <span className="job-title">{job.title}</span>}
        </div>
        <div className="bar">
          <span style={{ width: `${job.status === 'done' ? 100 : pct}%` }} />
        </div>
        <div className="job-meta" title={job.error || ''}>
          {active && job.status !== 'queued' && <Spinner size={10} />}
          {job.status === 'done' && <Icon name="check" size={12} />}
          {job.status === 'error' && <Icon name="alert" size={12} />}
          <span>{meta}</span>
        </div>
      </div>
      <div className="job-actions">
        {job.status === 'done' && (
          <>
            <PremiereButton job={job} notify={notify} compact={compact} />
            {!compact && onCaptions && (job.outputs || []).some((o) => o.premiere && o.premiere.words) && (
              <button className="icon-btn sm" title="Edit captions" onClick={() => onCaptions(job)}>
                <Icon name="edit" size={14} />
              </button>
            )}
            {!compact &&
              files.map((f) => {
                const name = f.split(/[\\/]/).pop().replace(/\.mp4$/i, '');
                return (
                  <span
                    key={f}
                    className="file-chip"
                    draggable
                    title={`Drag ${name} into your editor`}
                    onDragStart={(e) => {
                      e.preventDefault();
                      window.api.startDrag([f]);
                    }}
                  >
                    <Icon name={/facecam/i.test(name) ? (/enhanced/i.test(name) ? 'sparkles' : 'user') : 'film'} size={11} />
                    {name.replace(/^.* - /, '')}
                  </span>
                );
              })}
            <span className="drag-out" draggable onDragStart={dragStart} title="Drag all files into your editor">
              <Icon name="grip" size={14} />
              {!compact && <span>All</span>}
            </span>
            <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(dir)}>
              <Icon name="folder" size={15} />
            </button>
          </>
        )}
        <button className="icon-btn sm ghost" title={active ? 'Cancel' : 'Remove from list'} onClick={() => window.api.cancelJob(job.id)}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Jobs({ jobs, open, onToggle, notify, onCaptions }) {
  if (!jobs.length) return null;
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const avg = active.length ? active.reduce((a, j) => a + (j.progress || 0), 0) / active.length : 1;
  const done = jobs.filter((j) => j.status === 'done').length;
  return (
    <div className={`jobs ${open ? 'open' : ''}`}>
      <div className="jobs-head" onClick={onToggle}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        <span className="h-title">Downloads</span>
        <span className="h-sub">
          {active.length ? `${active.length} running · ${Math.round(avg * 100)}%` : `${done} finished`}
        </span>
        {active.length > 0 && (
          <div className="bar thin grow">
            <span style={{ width: `${avg * 100}%` }} />
          </div>
        )}
        <div className="grow" />
        {jobs.length > active.length && (
          <button
            className="chip sm"
            onClick={(e) => {
              e.stopPropagation();
              window.api.clearJobs();
            }}
          >
            Clear finished
          </button>
        )}
      </div>
      {open && (
        <div className="jobs-list">
          {[...jobs].reverse().map((j) => (
            <JobRow key={j.id} job={j} notify={notify} onCaptions={onCaptions} />
          ))}
        </div>
      )}
    </div>
  );
}
