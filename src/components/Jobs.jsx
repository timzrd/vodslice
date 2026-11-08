import { Icon, Spinner } from './ui.jsx';
import { fmtBytes, fmtEta } from '../lib/time.js';

export const ACTIVE = ['queued', 'preparing', 'downloading', 'processing'];

export function jobFiles(job) {
  return (job.outputs || []).flatMap((o) => o.files || []);
}

export function JobRow({ job, compact }) {
  const active = ACTIVE.includes(job.status);
  const pct = Math.round((job.progress || 0) * 100);
  const files = jobFiles(job);
  const dir = job.outputs && job.outputs[0] && job.outputs[0].dir;
  const names = (job.names || []).length > 2 ? `${job.names[0]} – ${job.names.at(-1)}` : (job.names || []).join(', ');
  const meta =
    job.status === 'done'
      ? `Done · ${files.length} file${files.length === 1 ? '' : 's'}`
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
            <span className="drag-out" draggable onDragStart={dragStart} title="Drag the files straight into your editor">
              <Icon name="grip" size={14} />
              {!compact && <span>Drag</span>}
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

export default function Jobs({ jobs, open, onToggle }) {
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
            <JobRow key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}
