import { useEffect, useState } from 'react';
import { Icon, Spinner } from './ui.jsx';

/** Shows up in the title bar when a new version is on GitHub: one click downloads, second click restarts. */
export default function UpdatePill({ busyJobs }) {
  const [u, setU] = useState(null);
  useEffect(() => {
    window.api.updateStatus().then(setU);
    return window.api.onUpdate(setU);
  }, []);
  if (!u || !['available', 'downloading', 'ready'].includes(u.state)) return null;

  if (u.state === 'available')
    return (
      <button className="update-pill" onClick={() => window.api.updateDownload()} title={u.notes ? u.notes.replace(/<[^>]+>/g, '') : `Vodslice ${u.version}`}>
        <Icon name="download" size={13} /> Update {u.version}
      </button>
    );
  if (u.state === 'downloading')
    return (
      <span className="update-pill busy">
        <Spinner size={11} /> Updating {u.percent || 0}%
        <span className="update-bar" style={{ width: `${u.percent || 0}%` }} />
      </span>
    );
  return (
    <button
      className="update-pill ready"
      onClick={() => {
        if (busyJobs && !window.confirm('Downloads are still running. Restart now and cancel them?')) return;
        window.api.updateInstall();
      }}
      title="Restart Vodslice to finish the update"
    >
      <Icon name="refresh" size={13} /> Restart to update
    </button>
  );
}
