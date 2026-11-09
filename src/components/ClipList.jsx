import TimeField from './TimeField.jsx';
import { Icon, Kbd, Spinner } from './ui.jsx';
import { fmt, fmtShort } from '../lib/time.js';
import { frameStyle } from '../lib/storyboard.js';
import { useMenu } from './ContextMenu.jsx';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function Thumb({ info, thumbs, t }) {
  const st = info ? frameStyle(info, thumbs, t, 72, 40) : null;
  return <span className="clip-thumb" style={st || undefined} />;
}

function Check({ on, onChange, title }) {
  return (
    <button
      className={`check ${on ? 'on' : ''}`}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      {on && <Icon name="check" size={12} stroke={3} />}
    </button>
  );
}

/**
 * Clip bin: every marked clip of the project. The checkbox decides what the Download button takes;
 * downloaded clips stay (marked ✓) and get unchecked. Right-click for single-clip actions.
 */
export default function ClipList({
  clips,
  sources,
  srcState,
  activeSrc,
  activeId,
  settings,
  onSelect,
  onActivateClip,
  onChangeSeg,
  onDeleteSeg,
  onAddSeg,
  onAddClip,
  onDeleteClip,
  onPlaySeg,
  onFromPlayhead,
  onAddLink,
  onToggle,
  onToggleAll,
  onDownloadClip,
  onDuplicate,
  adding,
}) {
  const openMenu = useMenu();
  const checked = clips.filter((c) => c.on !== false);
  const total = checked.reduce((a, c) => a + c.segments.reduce((b, s) => b + Math.max(0, s.end - s.start), 0), 0);
  const multiSrc = new Set(clips.map((c) => c.src)).size > 1;
  const allOn = clips.length > 0 && checked.length === clips.length;

  const menuFor = (c, ci) => [
    { head: `Clip ${ci + 1}` },
    { label: 'Download this clip', icon: 'download', primary: true, onClick: () => onDownloadClip(c.id) },
    { label: 'Play', icon: 'play', onClick: () => onPlaySeg(c.segments[0]) },
    { label: c.on !== false ? 'Uncheck (skip on download)' : 'Check for download', icon: 'check', onClick: () => onToggle(c.id, c.on === false) },
    '-',
    { label: 'Add part at playhead', icon: 'plus', kbd: 'Shift N', onClick: () => onAddSeg(c.id) },
    { label: 'Duplicate', icon: 'copy', onClick: () => onDuplicate(c.id) },
    '-',
    { label: 'Delete clip', icon: 'trash', danger: true, kbd: 'Del', onClick: () => onDeleteClip(c.id) },
  ];

  return (
    <div className="clips">
      <div className="clips-head">
        {clips.length > 0 && <Check on={allOn} onChange={(v) => onToggleAll(v)} title={allOn ? 'Uncheck all' : 'Check all (Ctrl+A)'} />}
        <span className="h-title">Clips</span>
        <span className="h-sub">{clips.length ? `${checked.length}/${clips.length} · ${fmtShort(total)}` : ''}</span>
        <div className="grow" />
        <button className="chip sm" onClick={onAddLink} disabled={adding} title="Add a Twitch clip / video link from the clipboard">
          {adding ? <Spinner size={10} /> : <Icon name="link" size={11} />} {adding ? 'Adding…' : 'Paste link'}
        </button>
      </div>
      <div className="clips-list">
        {!clips.length && (
          <div className="clips-empty">
            <Icon name="scissors" size={22} />
            <p>No clips yet</p>
            <p className="muted">
              Drag on the timeline, or press <Kbd>I</Kbd> and <Kbd>O</Kbd> at the playhead.
            </p>
          </div>
        )}
        {clips.map((c, ci) => {
          const info = sources[c.src];
          const thumbs = srcState[c.src] && srcState[c.src].thumbs;
          const dur = c.segments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
          const isActive = c.segments.some((s) => s.id === activeId);
          const D = info ? info.duration : 0;
          const hd = D >= 36000 ? 2 : 1;
          const on = c.on !== false;
          const first = c.segments[0];
          return (
            <div
              key={c.id}
              className={`clip ${isActive ? 'active' : ''} ${c.sent ? 'sent' : ''} ${on ? 'checked' : 'unchecked'}`}
              style={{ '--c': first ? first.color : 'var(--accent)' }}
              onPointerDown={(e) => e.button === 0 && !isActive && onActivateClip(c.id)}
              onContextMenu={(e) => {
                if (e.target.closest('.tf')) return;
                openMenu(e, menuFor(c, ci));
              }}
            >
              <div className="clip-head">
                <Check on={on} onChange={(v) => onToggle(c.id, v)} title={on ? 'Included in the next download — click to skip' : 'Skipped — click to include'} />
                <Thumb info={info} thumbs={thumbs} t={first ? first.start + Math.min(5, (first.end - first.start) / 2) : 0} />
                <div className="clip-title">
                  <span className="clip-name">
                    <span className="clip-num">{ci + 1}</span>
                    <span className="clip-range">{first ? `${fmt(first.start)} – ${fmt(c.segments.at(-1).end)}` : ''}</span>
                  </span>
                  <span className="clip-meta">
                    {multiSrc && info && (
                      <>
                        <i className={`site-dot site-${info.site}`} />
                        <span className="clip-src">{info.kind === 'clip' ? info.title : info.channel}</span>
                        <span className="dot-sep">·</span>
                      </>
                    )}
                    {fmtShort(dur)}
                    {c.segments.length > 1 && <span className="dot-sep">·</span>}
                    {c.segments.length > 1 && `${c.segments.length} parts`}
                    {c.sent && (
                      <span className="sent-badge" title="Already downloaded">
                        <Icon name="check" size={10} /> done
                      </span>
                    )}
                  </span>
                </div>
                <button
                  className="icon-btn xs ghost clip-dl"
                  title="Download only this clip"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadClip(c.id);
                  }}
                >
                  <Icon name="download" size={13} />
                </button>
                <button
                  className="icon-btn xs ghost"
                  title="More (right-click)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => openMenu(e, menuFor(c, ci))}
                >
                  <Icon name="more" size={14} />
                </button>
              </div>
              {isActive &&
                c.segments.map((s, si) => (
                  <div key={s.id} className={`segrow ${s.id === activeId ? 'active' : ''}`} style={{ '--c': s.color }} onPointerDown={() => s.id !== activeId && onSelect(s.id)}>
                    <span className="segrow-bar" />
                    <span className="segrow-label">{c.segments.length > 1 ? `${ci + 1}${LETTERS[si]}` : ci + 1}</span>
                    <div className="segrow-times">
                      <div className="tf-wrap">
                        <button className="mini-btn" title="Set start to playhead (I)" onClick={() => onFromPlayhead(s.id, 'start')}>
                          <Icon name="in" size={11} />
                        </button>
                        <TimeField value={s.start} max={Math.max(0, Math.floor(D) - 1)} hourDigits={hd} settings={settings} accent={s.color} onChange={(v) => onChangeSeg(s.id, { start: v }, 'start')} />
                      </div>
                      <span className="arrow">→</span>
                      <div className="tf-wrap">
                        <TimeField value={s.end} min={1} max={Math.floor(D)} hourDigits={hd} settings={settings} accent={s.color} onChange={(v) => onChangeSeg(s.id, { end: v }, 'end')} />
                        <button className="mini-btn" title="Set end to playhead (O)" onClick={() => onFromPlayhead(s.id, 'end')}>
                          <Icon name="out" size={11} />
                        </button>
                      </div>
                    </div>
                    <span className="segrow-dur">{fmtShort(s.end - s.start)}</span>
                    <div className="segrow-actions">
                      <button className="icon-btn xs ghost" title="Preview this part" onClick={() => onPlaySeg(s)}>
                        <Icon name="play" size={11} />
                      </button>
                      {c.segments.length > 1 && (
                        <button className="icon-btn xs ghost" title="Remove part" onClick={() => onDeleteSeg(s.id)}>
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              {isActive && (
                <button className="add-seg" onClick={() => onAddSeg(c.id)} title="Add another time range — it gets joined into this clip (Shift+N)">
                  <Icon name="plus" size={12} /> Add part <span className="muted">· joined into this clip</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="add-clip" onClick={onAddClip} disabled={!activeSrc} title="New clip at the playhead (N)">
        <Icon name="plus" size={15} /> New clip <Kbd>N</Kbd>
      </button>
    </div>
  );
}
