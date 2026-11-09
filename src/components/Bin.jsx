import { Icon, Spinner } from './ui.jsx';
import { fmt } from '../lib/time.js';
import { useMenu } from './ContextMenu.jsx';

/**
 * Media bin (left of the player, like an NLE's project panel): every video of this project.
 * The channel you browsed sits on top so you can jump back and pick the next stream.
 */
export default function Bin({ sources, order, activeSrc, clips, pending, channel, onActivate, onRemove, onAdd, onChannel, onDownloadFull, project, onRename }) {
  const openMenu = useMenu();
  const count = (id) => clips.filter((c) => c.src === id).length;
  const list = order.filter((id) => sources[id]);
  return (
    <aside className="bin">
      <div className="bin-head">
        <span className="h-title" title={project ? project.name : ''}>
          Media
        </span>
        <div className="grow" />
        <button className="icon-btn xs" title="Add a video (paste a link or browse a channel)" onClick={onAdd}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {channel && (
        <button className={`bin-channel site-${channel.site}`} onClick={onChannel} title={`Back to ${channel.name}`}>
          {channel.avatar ? <img src={channel.avatar} alt="" /> : <span className="bc-ph" />}
          <span className="bc-text">
            <b>{channel.name}</b>
            <em>{channel.site === 'twitch' ? 'Twitch' : 'YouTube'} channel · browse</em>
          </span>
          <Icon name="chevronRight" size={14} />
        </button>
      )}
      <div className="bin-list">
        {list.map((id) => {
          const s = sources[id];
          const n = count(id);
          return (
            <div
              key={id}
              className={`bin-item ${id === activeSrc ? 'active' : ''} ${s.stale ? 'stale' : ''}`}
              onClick={() => onActivate(id)}
              onContextMenu={(e) =>
                openMenu(e, [
                  { head: s.title || s.channel },
                  { label: 'Show in player', icon: 'play', onClick: () => onActivate(id) },
                  { label: 'Open original', icon: 'external', onClick: () => window.api.openExternal(s.url) },
                  { label: 'Copy link', icon: 'copy', onClick: () => window.api.writeClipboard(s.url) },
                  { label: 'Download the whole video', icon: 'download', onClick: () => onDownloadFull(id) },
                  '-',
                  { label: n ? `Remove from project (${n} clip${n > 1 ? 's' : ''})` : 'Remove from project', icon: 'trash', danger: true, onClick: () => onRemove(id) },
                ])
              }
              title={s.title}
            >
              <div className="bi-thumb" style={s.thumbnail ? { backgroundImage: `url("${s.thumbnail}")` } : undefined}>
                <span className="bi-dur">{fmt(s.duration)}</span>
                {n > 0 && <span className="bi-count">{n}</span>}
                {s.stale && (
                  <span className="bi-load">
                    <Spinner size={14} />
                  </span>
                )}
              </div>
              <div className="bi-text">
                <b>{s.title || 'Untitled stream'}</b>
                <em>
                  <i className={`site-dot site-${s.site}`} />
                  {s.kind === 'clip' ? `${s.site === 'twitch' ? 'Twitch clip' : 'Clip'} · ${s.channel}` : s.channel}
                </em>
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="bin-item active pending">
            <div className="bi-thumb" style={pending.thumbnail ? { backgroundImage: `url("${pending.thumbnail}")` } : undefined}>
              <span className="bi-load">
                <Spinner size={16} />
              </span>
            </div>
            <div className="bi-text">
              <b>{pending.title || 'Loading…'}</b>
              <em>Reading formats…</em>
            </div>
          </div>
        )}
        {!list.length && !pending && (
          <button className="bin-empty" onClick={onAdd}>
            <Icon name="plus" size={18} />
            <span>Add a video</span>
            <em>Paste a link or search a streamer above</em>
          </button>
        )}
      </div>
      {project && (
        <button className="bin-project" onClick={onRename} title="Rename project">
          <Icon name="folder" size={12} />
          <span>{project.name || 'Untitled project'}</span>
          <Icon name="edit" size={11} />
        </button>
      )}
    </aside>
  );
}
