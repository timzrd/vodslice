import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { JobRow, ACTIVE } from './Jobs.jsx';
import { Icon } from './ui.jsx';
import Logo from './Logo.jsx';

/** Always-on-top mini overlay: live progress + quick folder / drag-out actions. */
export default function Mini() {
  const [jobs, setJobs] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    document.documentElement.classList.add('mini-mode');
    window.api.jobs().then(setJobs);
    const off1 = window.api.onJob((j) => setJobs((list) => (list.some((x) => x.id === j.id) ? list.map((x) => (x.id === j.id ? j : x)) : [...list, j])));
    const off2 = window.api.onJobRemoved((id) => setJobs((list) => list.filter((x) => x.id !== id)));
    return () => {
      off1();
      off2();
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => window.api.miniResize(el.offsetHeight + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = [...jobs].reverse().slice(0, 5);
  const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  const lastDone = [...jobs].reverse().find((j) => j.status === 'done');

  return (
    <div className="mini" ref={ref}>
      <div className="mini-head">
        <Logo size={16} />
        <span className="mini-title">{active ? `${active} downloading` : jobs.length ? 'All done' : 'No downloads'}</span>
        <div className="grow" />
        {lastDone && (
          <button className="icon-btn xs" title="Open latest folder" onClick={() => window.api.openPath(lastDone.outputs[0] && lastDone.outputs[0].dir)}>
            <Icon name="folder" size={13} />
          </button>
        )}
        <button className="icon-btn xs" title="Open Vodslice" onClick={() => window.api.showMain()}>
          <Icon name="external" size={13} />
        </button>
        <button className="icon-btn xs" title="Close overlay" onClick={() => window.api.miniClose()}>
          <Icon name="x" size={13} />
        </button>
      </div>
      {shown.length > 0 && (
        <div className="mini-list">
          {shown.map((j) => (
            <JobRow key={j.id} job={j} compact />
          ))}
        </div>
      )}
    </div>
  );
}
