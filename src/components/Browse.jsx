import { useEffect, useRef } from 'react';
import { Icon, Spinner } from './ui.jsx';
import { fmt } from '../lib/time.js';
import { useMenu } from './ContextMenu.jsx';

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const u = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [n, name] of u) if (s >= n) return `${Math.floor(s / n)} ${name}${Math.floor(s / n) > 1 ? 's' : ''} ago`;
  return 'just now';
}

function Card({ item, site, onPick, openMenu }) {
  const ref = useRef(null);
  const meta = [item.views, item.published || ago(item.publishedAt)].filter(Boolean).join(' • ');
  const pick = () => onPick(item, ref.current ? ref.current.getBoundingClientRect() : null);
  return (
    <div
      className="bc"
      onClick={pick}
      onContextMenu={(e) =>
        openMenu(e, [
          { label: 'Open in editor', icon: 'scissors', primary: true, onClick: pick },
          { label: `Open on ${site === 'twitch' ? 'Twitch' : 'YouTube'}`, icon: 'external', onClick: () => window.api.openExternal(item.url) },
          { label: 'Copy link', icon: 'copy', onClick: () => window.api.writeClipboard(item.url) },
        ])
      }
      title={item.title}
    >
      <div className="bc-thumb" ref={ref}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" draggable={false} /> : <span className="bc-noimg">{item.live ? 'Live now' : 'Processing'}</span>}
        {item.live ? <span className="bc-badge live">LIVE</span> : item.duration ? <span className="bc-badge">{item.durationText || fmt(item.duration)}</span> : null}
        <span className="bc-hover">
          <Icon name="scissors" size={18} /> Clip this
        </span>
      </div>
      <div className="bc-body">
        <b className={item.title ? '' : 'untitled'}>{item.title || (site === 'youtube' ? 'Untitled stream' : 'Untitled')}</b>
        <span>{meta}</span>
        {(item.game || item.by) && <span className="bc-game">{item.by ? `Clipped by ${item.by}` : item.game}</span>}
      </div>
    </div>
  );
}

/** Channel page in the look of the site (YouTube red / Twitch purple), recreated from scraped data. */
export default function Browse({ state, recent, onTab, onMore, onPick, onAlt, onOpenRecent, onSearch }) {
  const openMenu = useMenu();
  const scroller = useRef(null);
  const sentinel = useRef(null);
  const st = state || {};
  const ch = st.channel;
  const site = st.site || (ch && ch.site) || 'youtube';

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !st.next) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onMore(), { root: scroller.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [st.next, st.items && st.items.length, onMore]); // eslint-disable-line

  useEffect(() => {
    if (scroller.current && st.resetScroll) scroller.current.scrollTop = 0;
  }, [st.resetScroll]);

  if (!state) {
    return (
      <div className="browse brw-none">
        <div className="brw-empty">
          <Icon name="compass" size={30} />
          <h2>Browse a channel</h2>
          <p>Type a streamer's name in the bar above — or paste a YouTube / Twitch channel link.</p>
          {recent && recent.length > 0 && (
            <div className="recent-ch">
              {recent.map((r) => (
                <button key={`${r.site}:${r.ref}`} className={`rch site-${r.site}`} onClick={() => onOpenRecent(r)}>
                  {r.avatar ? <img src={r.avatar} alt="" /> : <span className="rch-ph" />}
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`browse brw-${site}`} ref={scroller}>
      <div className="brw-inner">
        {st.status === 'loading' && !ch && (
          <div className="brw-loading">
            <Spinner size={26} />
            <span>{st.label || 'Opening channel…'}</span>
          </div>
        )}
        {st.status === 'error' && !ch && (
          <div className="brw-loading err">
            <Icon name="alert" size={22} />
            <span>{st.error}</span>
          </div>
        )}
        {ch && (
          <>
            {ch.banner && <div className="brw-banner" style={{ backgroundImage: `url("${ch.banner}")` }} />}
            <header className="brw-head">
              {ch.avatar ? <img className="brw-avatar" src={ch.avatar} alt="" /> : <span className="brw-avatar ph" />}
              <div className="brw-info">
                <h1>
                  {ch.name}
                  {ch.live && <span className="brw-live">LIVE · {ch.live.viewers.toLocaleString('en-US')}</span>}
                </h1>
                <div className="brw-meta">{[site === 'twitch' ? ch.handle : ch.handle, ch.subscribers, ch.videoCount].filter(Boolean).join(' • ')}</div>
                {ch.description && <p className="brw-desc">{ch.description}</p>}
              </div>
              <div className="brw-actions">
                <button className="brw-btn" onClick={() => window.api.openExternal(ch.url)}>
                  <Icon name="external" size={14} /> Open on {site === 'twitch' ? 'Twitch' : 'YouTube'}
                </button>
                <button className="brw-btn ghost" onClick={() => onSearch(site === 'twitch' ? 'youtube' : 'twitch', ch.name)} title="Look for this streamer on the other site">
                  {site === 'twitch' ? 'Find on YouTube' : 'Find on Twitch'}
                </button>
              </div>
            </header>
            {st.alternatives && st.alternatives.length > 0 && (
              <div className="brw-alts">
                <span>Not the right channel?</span>
                {st.alternatives.map((a) => (
                  <button key={a.ref} className="brw-alt" onClick={() => onAlt(a)} title={a.subscribers}>
                    {a.avatar ? <img src={a.avatar} alt="" /> : <span className="rch-ph" />}
                    <b>{a.name}</b>
                    <em>{a.subscribers}</em>
                  </button>
                ))}
              </div>
            )}
            <nav className="brw-tabs">
              {(ch.tabs || []).map((t) => (
                <button key={t.id} className={t.id === st.tab ? 'on' : ''} onClick={() => t.id !== st.tab && onTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>
            {st.status === 'loading' && (
              <div className="brw-loading small">
                <Spinner size={18} />
              </div>
            )}
            {st.status !== 'loading' && st.items && !st.items.length && <div className="brw-loading small">Nothing here.</div>}
            <div className="brw-grid">
              {(st.items || []).map((it) => (
                <Card key={it.id} item={it} site={site} onPick={onPick} openMenu={openMenu} />
              ))}
            </div>
            <div ref={sentinel} className="brw-sentinel">
              {st.loadingMore && <Spinner size={18} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
