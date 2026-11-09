import { Icon, Spinner, Kbd } from './ui.jsx';

export default function Empty({ loading, error, onPaste, history, settings }) {
  const recent = (history || []).filter((h) => h.outputs && h.outputs.length).slice(0, 6);
  return (
    <main className="empty">
      <div className="hero">
        <button className={`paste-zone ${loading ? 'loading' : ''}`} onClick={onPaste} disabled={loading}>
          {loading ? <Spinner size={28} /> : <Icon name="link" size={30} />}
          <span className="pz-title">{loading ? 'Reading video…' : 'Paste a link'}</span>
          <span className="pz-sub">
            {loading ? 'Getting formats, length and preview' : (
              <>
                YouTube & Twitch VODs or clips · click here or press <Kbd>Ctrl V</Kbd>
              </>
            )}
          </span>
        </button>
        {error && (
          <div className="hero-err">
            <Icon name="alert" size={14} /> {error}
          </div>
        )}
        <div className="hero-feats">
          <span>
            <Icon name="scissors" size={14} /> Only the parts you need
          </span>
          <span>
            <Icon name="user" size={14} /> Facecam as its own file
          </span>
          <span>
            <Icon name="folders" size={14} /> Auto-numbered folders
          </span>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <div className="recent-head">
            <span className="h-title">Recent</span>
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
        </div>
      )}
    </main>
  );
}
