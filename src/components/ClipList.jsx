import TimeField from './TimeField.jsx';
import { Icon, Kbd } from './ui.jsx';
import { fmtShort } from '../lib/time.js';
import { Storyboard } from './ScrubBar.jsx';

function Thumb({ info, t }) {
  if (!info) return <span className="clip-thumb" />;
  if (info.storyboard && info.kind !== 'clip')
    return (
      <span className="clip-thumb">
        <Storyboard sb={info.storyboard} t={t} width={64} />
      </span>
    );
  return <span className="clip-thumb" style={info.thumbnail ? { backgroundImage: `url("${info.thumbnail}")` } : undefined} />;
}

export default function ClipList({
  clips,
  sources,
  activeSrc,
  activeId,
  settings,
  clipNames,
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
  onClear,
  adding,
}) {
  const total = clips.reduce((a, c) => a + c.segments.reduce((b, s) => b + Math.max(0, s.end - s.start), 0), 0);
  const multiSrc = new Set(clips.map((c) => c.src)).size > 1 || clips.some((c) => c.src !== activeSrc);
  return (
    <div className="clips">
      <div className="clips-head">
        <span className="h-title">Clips</span>
        <span className="h-sub">{clips.length ? `${clips.length} · ${fmtShort(total)}` : 'Full video'}</span>
        <div className="grow" />
        <button className="chip sm" onClick={onAddLink} disabled={adding} title="Add a Twitch clip / video from the clipboard to this list">
          <Icon name="plus" size={11} /> {adding ? 'Adding…' : 'Add link'}
        </button>
        {clips.length > 0 && (
          <button className="icon-btn xs ghost" onClick={onClear} title="Remove all clips (Ctrl+Z brings them back)">
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
      <div className="clips-list">
        {!clips.length && (
          <div className="clips-empty">
            <Icon name="film" size={22} />
            <p>No clips — the whole video will be downloaded.</p>
            <p className="muted">Drag on the timeline, press N, or paste Twitch clip links to collect them here.</p>
          </div>
        )}
        {clips.map((c, ci) => {
          const info = sources[c.src];
          const dur = c.segments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
          const isActive = c.segments.some((s) => s.id === activeId);
          const D = info ? info.duration : 0;
          const hd = D >= 36000 ? 2 : 1;
          return (
            <div
              key={c.id}
              className={`clip ${isActive ? 'active' : ''} ${c.sent ? 'sent' : ''}`}
              onPointerDown={() => !isActive && onActivateClip(c.id)}
              onContextMenu={(e) => {
                if (e.target.closest('.tf')) return;
                e.preventDefault();
                onDeleteClip(c.id);
              }}
            >
              <div className="clip-head">
                <Thumb info={info} t={c.segments[0] ? c.segments[0].start : 0} />
                <div className="clip-title">
                  <span className="clip-name" title="Output name">
                    <span className="clip-num">{ci + 1}</span>
                    {clipNames[ci] || `Clip ${ci + 1}`}
                  </span>
                  <span className="clip-meta">
                    {multiSrc && info && (
                      <>
                        <i className={`site-dot site-${info.site}`} />
                        {info.kind === 'clip' ? (info.site === 'twitch' ? 'Twitch clip' : 'Clip') : info.channel}
                        <span className="dot-sep">·</span>
                      </>
                    )}
                    {fmtShort(dur)}
                    {c.segments.length > 1 && <span className="dot-sep">·</span>}
                    {c.segments.length > 1 && `${c.segments.length} parts`}
                    {c.sent && (
                      <span className="sent-badge" title="Already sent to downloads — edits make it pending again">
                        <Icon name="check" size={10} /> sent
                      </span>
                    )}
                  </span>
                </div>
                <button className="icon-btn xs ghost" title="Delete clip (right-click)" onClick={(e) => (e.stopPropagation(), onDeleteClip(c.id))}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {c.segments.map((s, si) => (
                <div key={s.id} className={`segrow ${s.id === activeId ? 'active' : ''}`} style={{ '--c': s.color }} onPointerDown={() => s.id !== activeId && onSelect(s.id)}>
                  <span className="segrow-bar" />
                  <span className="segrow-label">{c.segments.length > 1 ? `${ci + 1}${'abcdefghijklmnopqrstuvwxyz'[si]}` : ci + 1}</span>
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
                    <button className="icon-btn xs ghost" title="Preview this segment" onClick={() => onPlaySeg(s)}>
                      <Icon name="play" size={11} />
                    </button>
                    <button className="icon-btn xs ghost" title="Remove segment (Del)" onClick={() => onDeleteSeg(s.id)}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="add-seg" onClick={() => onAddSeg(c.id)} title="Add another time range — it gets joined into this clip (Shift+N)">
                <Icon name="plus" size={12} /> Add part
              </button>
            </div>
          );
        })}
      </div>
      <button className="add-clip" onClick={onAddClip} title="New separate clip at the playhead (N)">
        <Icon name="plus" size={16} /> New clip <Kbd>N</Kbd>
      </button>
    </div>
  );
}
