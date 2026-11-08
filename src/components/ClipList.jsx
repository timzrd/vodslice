import TimeField from './TimeField.jsx';
import { Icon, Kbd } from './ui.jsx';
import { fmtShort } from '../lib/time.js';

export default function ClipList({
  clips,
  activeId,
  duration,
  settings,
  clipNames,
  onSelect,
  onChangeSeg,
  onCommit,
  onDeleteSeg,
  onAddSeg,
  onAddClip,
  onDeleteClip,
  onPlaySeg,
  onFromPlayhead,
}) {
  const total = clips.reduce((a, c) => a + c.segments.reduce((b, s) => b + Math.max(0, s.end - s.start), 0), 0);
  return (
    <div className="clips">
      <div className="clips-head">
        <span className="h-title">Clips</span>
        <span className="h-sub">
          {clips.length ? `${clips.length} clip${clips.length > 1 ? 's' : ''} · ${fmtShort(total)}` : 'Full video'}
        </span>
      </div>
      <div className="clips-list">
        {!clips.length && (
          <div className="clips-empty">
            <Icon name="film" size={22} />
            <p>No clips — the whole video will be downloaded.</p>
            <p className="muted">
              Add a clip or drag on the timeline to grab only what you need.
            </p>
          </div>
        )}
        {clips.map((c, ci) => {
          const dur = c.segments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
          const isActive = c.segments.some((s) => s.id === activeId);
          return (
            <div key={c.id} className={`clip ${isActive ? 'active' : ''}`}>
              <div className="clip-head">
                <span className="clip-num">{ci + 1}</span>
                <span className="clip-name" title="Output name">
                  {clipNames[ci] || `Clip ${ci + 1}`}
                </span>
                <span className="clip-dur">{fmtShort(dur)}</span>
                <button className="icon-btn xs ghost" title="Delete clip" onClick={() => onDeleteClip(c.id)}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {c.segments.map((s, si) => (
                <div
                  key={s.id}
                  className={`segrow ${s.id === activeId ? 'active' : ''}`}
                  style={{ '--c': s.color }}
                  onPointerDown={() => s.id !== activeId && onSelect(s.id)}
                >
                  <span className="segrow-bar" />
                  <span className="segrow-label">{s.label}</span>
                  <div className="segrow-times">
                    <div className="tf-wrap">
                      <button className="mini-btn" title="Set start to playhead (I)" onClick={() => onFromPlayhead(s.id, 'start')}>
                        <Icon name="in" size={11} />
                      </button>
                      <TimeField value={s.start} max={Math.max(0, Math.floor(duration) - 1)} hourDigits={duration >= 36000 ? 2 : 1} settings={settings} accent={s.color} onChange={(v) => onChangeSeg(s.id, { start: v }, true)} />
                    </div>
                    <span className="arrow">→</span>
                    <div className="tf-wrap">
                      <TimeField value={s.end} min={1} max={Math.floor(duration)} hourDigits={duration >= 36000 ? 2 : 1} settings={settings} accent={s.color} onChange={(v) => onChangeSeg(s.id, { end: v }, true)} />
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
              <button className="add-seg" onClick={() => onAddSeg(c.id)} title="Another time range that gets joined into this same clip (Shift+N)">
                <Icon name="plus" size={13} /> Segment <span className="muted">— joined into clip {ci + 1}</span>
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
