import { Icon, Kbd } from './ui.jsx';
import { fmt, fmtShort } from '../lib/time.js';
import { ago } from './Browse.jsx';
import { useMenu } from './ContextMenu.jsx';

function ProjectCard({ p, onOpen, onDelete, onRename, current }) {
  const openMenu = useMenu();
  const fc = p.facecam;
  return (
    <div
      className={`pj ${current ? 'current' : ''}`}
      onClick={() => onOpen(p)}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: 'Open', icon: 'scissors', primary: true, onClick: () => onOpen(p) },
          { label: 'Rename', icon: 'edit', onClick: () => onRename(p) },
          '-',
          { label: 'Delete project', icon: 'trash', danger: true, onClick: () => onDelete(p) },
        ])
      }
    >
      <div className="pj-thumb" style={p.thumbnail ? { backgroundImage: `url("${p.thumbnail}")` } : undefined}>
        {fc && <span className="pj-fc" style={{ left: `${fc.x * 100}%`, top: `${fc.y * 100}%`, width: `${fc.w * 100}%`, height: `${fc.h * 100}%` }} />}
        <span className={`pj-site site-${p.site}`}>{p.site === 'twitch' ? 'Twitch' : p.site === 'youtube' ? 'YouTube' : ''}</span>
        {p.duration ? <span className="pj-dur">{fmt(p.duration)}</span> : null}
        <div className="pj-marks">
          {p.marks.map((m, i) => (
            <span key={i} style={{ left: `${m.s * 100}%`, width: `max(3px, ${(m.e - m.s) * 100}%)`, background: m.c }} />
          ))}
        </div>
        <button
          className="pj-del icon-btn xs"
          title="Delete project"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(p);
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="pj-body">
        <b>{p.name}</b>
        <span>
          {p.channel}
          {p.sources > 1 ? ` · ${p.sources} videos` : ''}
        </span>
        <span className="pj-stats">
          <em>{p.clips ? `${p.clips} clip${p.clips > 1 ? 's' : ''} · ${fmtShort(p.clipsDuration)}` : 'No clips yet'}</em>
          <em>{ago(p.updated)}</em>
        </span>
      </div>
    </div>
  );
}

/** Start screen: recent projects (with their facecam box + clip marks), channels, finished downloads. */
export default function Home({ projects, currentId, recentChannels, history, settings, onOpen, onDelete, onRename, onNew, onOpenChannel, onFocusInput }) {
  const recent = (history || []).filter((h) => h.outputs && h.outputs.length).slice(0, 4);
  return (
    <div className="home">
      <div className="home-inner">
        <section className="home-hero">
          <div>
            <h1>What are we clipping today?</h1>
            <p>Paste a VOD / clip link, or type a streamer's name to browse their YouTube or Twitch channel.</p>
          </div>
          <div className="home-actions">
            <button className="btn primary" onClick={onFocusInput}>
              <Icon name="search" size={15} /> Search or paste <Kbd>Ctrl V</Kbd>
            </button>
            <button className="btn" onClick={onNew}>
              <Icon name="plus" size={15} /> New project
            </button>
          </div>
        </section>

        {recentChannels && recentChannels.length > 0 && (
          <section>
            <div className="home-h">
              <h2>Channels</h2>
            </div>
            <div className="recent-ch">
              {recentChannels.map((r) => (
                <button key={`${r.site}:${r.ref}`} className={`rch site-${r.site}`} onClick={() => onOpenChannel(r)} title={`${r.site === 'twitch' ? 'Twitch' : 'YouTube'} · ${r.name}`}>
                  {r.avatar ? <img src={r.avatar} alt="" /> : <span className="rch-ph" />}
                  <span>{r.name}</span>
                  <i className={`site-dot site-${r.site}`} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="home-h">
            <h2>Projects</h2>
            <span className="muted">{projects.length ? 'Saved automatically · right-click to rename or delete' : ''}</span>
          </div>
          {projects.length ? (
            <div className="pj-grid">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} current={p.id === currentId} onOpen={onOpen} onDelete={onDelete} onRename={onRename} />
              ))}
            </div>
          ) : (
            <div className="home-empty">
              <Icon name="film" size={22} />
              <span>Your projects show up here — every stream you open is saved with its facecam box and clips.</span>
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section>
            <div className="home-h">
              <h2>Recent downloads</h2>
              <button className="chip sm" onClick={() => window.api.openPath(settings.output.baseDir)}>
                <Icon name="folder" size={12} /> Open main folder
              </button>
            </div>
            <div className="recent-grid">
              {recent.map((h) => (
                <div key={h.id} className="recent-card">
                  <div className="rc-thumb" style={h.thumbnail ? { backgroundImage: `url("${h.thumbnail}")` } : undefined} />
                  <div className="rc-body">
                    <b>{h.outputs.map((o) => o.name).join(', ')}</b>
                    <span className="muted">{h.title}</span>
                  </div>
                  <div className="rc-actions">
                    <span
                      className="drag-out"
                      draggable
                      title="Drag files into your editor"
                      onDragStart={(e) => {
                        e.preventDefault();
                        window.api.startDrag(h.outputs.flatMap((o) => o.files));
                      }}
                    >
                      <Icon name="grip" size={14} />
                    </span>
                    <button className="icon-btn sm" title="Open folder" onClick={() => window.api.openPath(h.outputs[0].dir)}>
                      <Icon name="folder" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
