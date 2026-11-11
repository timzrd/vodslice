import { useEffect, useRef, useState } from 'react';
import { Icon, Spinner } from './ui.jsx';
import { fmtBytes, fmtEta } from '../lib/time.js';

const PHASE_COLOR = { download: '#39c6ff', process: '#2dd4bf', chat: '#ff9f43', enhance: '#a78bfa', premiere: '#8f8fff' };

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
        o.premiere = { ...(o.premiere || {}), xml, words: r.project.files.words, srt: r.project.files.srt, jsx: r.project.files.jsx, mode: r.project.captionsMode, dir: o.dir };
      }
      setBusy({ label: 'Opening in Premiere', p: 1 });
      const pr = o.premiere || {};
      const res = await window.api.premiereOpen(xml, pr.mode === 'editable' && pr.srt ? [pr.srt] : []);
      if (res.ok && pr.mode === 'editable' && pr.srt) notify && notify('Captions: drag the .srt from the project panel onto the sequence — it becomes an editable captions track', 'info', 8000);
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

/** Opens the editable-captions script of every output in After Effects. */
export function AfterEffectsButton({ job, notify }) {
  const [ae, setAe] = useState(null);
  useEffect(() => {
    window.api.aeStatus().then(setAe).catch(() => setAe(null));
  }, []);
  const scripts = (job.outputs || []).map((o) => o.premiere && o.premiere.jsx).filter(Boolean);
  if (!ae || !scripts.length) return null;
  return (
    <button
      className="ae-btn"
      title="Captions as real text layers (preset font + position) in After Effects"
      onClick={async () => {
        for (const f of scripts) {
          const r = await window.api.aeRun(f);
          if (!r.ok) return notify && notify(r.error, 'err');
        }
        notify && notify(`Starting ${ae.name} — the captions comp opens in your project`, 'ok', 5000);
      }}
    >
      <span className="ae-logo">Ae</span> Captions
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
          : [job.filesReady ? 'Clip ready' : '', job.stage, `${pct}%`, job.speed > 0 ? `${fmtBytes(job.speed)}/s` : '', fmtEta(job.eta)].filter(Boolean).join(' · ');

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
          <span style={{ width: `${job.status === 'done' ? 100 : pct}%`, background: active && PHASE_COLOR[job.phase] ? PHASE_COLOR[job.phase] : undefined }} />
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
                const name = f.split(/[\\/]/).pop().replace(/\.(mp4|mov)$/i, '');
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
                    <Icon name={/chat$/i.test(name) ? 'chat' : /facecam/i.test(name) ? (/enhanced/i.test(name) ? 'sparkles' : 'user') : 'film'} size={11} />
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

/** Title-bar button with a progress ring; opens the download list (drag files from there into Premiere). */
export function DownloadsButton({ jobs, notify, onCaptions, open, setOpen }) {
  const ref = useRef(null);
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const avg = active.length ? active.reduce((a, j) => a + (j.progress || 0), 0) / active.length : 0;
  const done = jobs.filter((j) => j.status === 'done').length;
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && !e.target.closest('.ctx-menu') && setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h, true);
      window.removeEventListener('keydown', k);
    };
  }, [open, setOpen]);
  const R = 13;
  const C = 2 * Math.PI * R;
  return (
    <div className="dl-wrap" ref={ref}>
      <button className={`dl-top ${active.length ? 'busy' : ''} ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="Downloads">
        <svg width="30" height="30" viewBox="0 0 30 30" className="dl-ring">
          <circle cx="15" cy="15" r={R} className="ring-bg" />
          {active.length > 0 && <circle cx="15" cy="15" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - avg)} />}
        </svg>
        <Icon name="download" size={15} />
        {active.length > 0 ? <span className="dl-pct">{Math.round(avg * 100)}%</span> : done > 0 ? <span className="dl-count">{done}</span> : null}
      </button>
      {open && (
        <div className="dl-panel">
          <div className="jobs-head">
            <span className="h-title">Downloads</span>
            <span className="h-sub">{active.length ? `${active.length} running · ${Math.round(avg * 100)}%` : jobs.length ? `${done} finished` : ''}</span>
            <div className="grow" />
            {jobs.length > active.length && (
              <button className="chip sm" onClick={() => window.api.clearJobs()}>
                Clear finished
              </button>
            )}
            <button className="icon-btn xs" title="Mini overlay (always on top)" onClick={() => window.api.toggleMini()}>
              <Icon name="pip" size={14} />
            </button>
          </div>
          <div className="jobs-list">
            {!jobs.length && <div className="dl-empty">Nothing downloaded yet — check clips and hit Download.</div>}
            {[...jobs].reverse().map((j) => (
              <JobRow key={j.id} job={j} notify={notify} onCaptions={onCaptions} />
            ))}
          </div>
        </div>
      )}
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
