import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './Editor.jsx';
import Home from './components/Home.jsx';
import Browse from './components/Browse.jsx';
import Settings from './components/Settings.jsx';
import { DownloadsButton } from './components/Jobs.jsx';
import Logo from './components/Logo.jsx';
import UpdatePill from './components/UpdatePill.jsx';
import CaptionsEditor from './components/CaptionsEditor.jsx';
import { MenuProvider } from './components/ContextMenu.jsx';
import { KeysOverlay } from './components/KeyMap.jsx';
import LoginDialog from './components/LoginDialog.jsx';
import { Icon, Spinner, Kbd } from './components/ui.jsx';
import { fmtBytes } from './lib/time.js';
import { ACTIVE } from './components/Jobs.jsx';

let tid = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  /** action = { label, onClick } shows a button in the toast */
  const push = useCallback((text, tone = 'info', ms = 3800, action = null) => {
    const id = ++tid;
    setToasts((t) => [...t.filter((x) => !(action && x.text === text)), { id, text, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  return [toasts, push];
}

/** Thumbnail that flies from the channel grid into the player. */
function Flyer({ src, from, to, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !from || !to) return onDone();
    const a = el.animate(
      [
        { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '12px', opacity: 1 },
        { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: '12px', opacity: 1, offset: 0.85 },
        { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: '12px', opacity: 0 },
      ],
      { duration: 720, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'forwards' }
    );
    a.onfinish = onDone;
    return () => a.cancel();
  }, []); // eslint-disable-line
  return <img ref={ref} className="flyer" src={src} alt="" />;
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [tools, setTools] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [history, setHistory] = useState([]);
  const [topazInfo, setTopazInfo] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [capJob, setCapJob] = useState(null);
  const [dlOpen, setDlOpen] = useState(false);
  const [toasts, toast] = useToasts();
  const [view, setView] = useState('home');
  const [projects, setProjects] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [browse, setBrowse] = useState(null); // channel page state
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState(null); // {q} — choose YouTube / Twitch for a name
  const [busy, setBusy] = useState(false);
  const [flyer, setFlyer] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  const [login, setLogin] = useState(null); // { retry: url | null }
  const editor = useRef(null);
  const input = useRef(null);
  const browseEl = useRef(null);
  const settingsRef = useRef(null);
  settingsRef.current = settings;

  // ---------- boot ----------
  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.toolsStatus().then((t) => setTools({ status: t, progress: t.progress, error: t.error }));
    window.api.jobs().then(setJobs);
    window.api.history().then(setHistory);
    window.api.projects().then((p) => {
      setProjects(p);
    });
    window.api.topazStatus().then(setTopazInfo).catch(() => {});
    const offs = [
      window.api.onSettings(setSettings),
      window.api.onTools((p) => setTools((t) => ({ ...(t || {}), status: p.status || (t && t.status), progress: p.done ? null : p, error: p.error || null }))),
      window.api.onJob((j) => setJobs((list) => (list.some((x) => x.id === j.id) ? list.map((x) => (x.id === j.id ? j : x)) : [...list, j]))),
      window.api.onJobRemoved((id) => setJobs((list) => list.filter((x) => x.id !== id))),
      window.api.onHistory(setHistory),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // job finished / failed toasts
  const prevJobs = useRef({});
  useEffect(() => {
    for (const j of jobs) {
      const p = prevJobs.current[j.id];
      if (p && p !== j.status) {
        if (j.status === 'done') toast(`✓ ${j.names.join(', ')} saved`, 'ok');
        if (j.status === 'error') toast(`Download failed: ${j.error}`, 'err', 8000);
      }
      prevJobs.current[j.id] = j.status;
    }
  }, [jobs, toast]);

  // ---------- projects ----------
  const refreshProjects = useCallback(() => window.api.projects().then(setProjects), []);
  const onProject = useCallback(
    async (snap) => {
      const sum = await window.api.projectSave(snap);
      setCurrentId(snap.id);
      setProjects((list) => [sum, ...list.filter((p) => p.id !== sum.id)]);
    },
    []
  );
  const openProject = async (p) => {
    const full = await window.api.projectGet(p.id);
    if (!full) return toast('Project not found', 'err');
    setCurrentId(p.id);
    setView('edit');
    editor.current.open(full);
  };
  const deleteProject = async (p) => {
    await window.api.projectRemove(p.id);
    if (p.id === currentId) {
      editor.current.newProject();
      setCurrentId(null);
    }
    refreshProjects();
    toast(`Deleted “${p.name}”`, 'info', 2200);
  };
  const newProject = () => {
    editor.current.newProject();
    setCurrentId(null);
    setView('edit');
    setTimeout(() => input.current && input.current.focus(), 50);
  };
  const doRename = async (p, name) => {
    if (!name || !name.trim()) return;
    if (p.id === (editor.current && editor.current.projectId)) editor.current.rename(name.trim());
    else await window.api.projectRename(p.id, name.trim());
    refreshProjects();
  };

  // ---------- channels ----------
  const rememberChannel = (ch) => {
    const s = settingsRef.current;
    const entry = { site: ch.site, ref: ch.ref, name: ch.name, avatar: ch.avatar };
    const list = [entry, ...((s.ui.recentChannels || []).filter((r) => !(r.site === ch.site && r.ref === ch.ref)))].slice(0, 12);
    window.api.replaceSetting('ui.recentChannels', list);
  };
  const openChannel = useCallback(async ({ site, ref, alternatives }) => {
    setView('browse');
    setBrowse((b) => ({ site, ref, status: 'loading', channel: b && b.site === site && b.ref === ref ? b.channel : null, alternatives, items: [], resetScroll: Date.now() }));
    const r = await window.api.browseChannel({ site, ref });
    if (!r.ok) return setBrowse((b) => (b && b.ref === ref ? { ...b, status: 'error', error: r.error } : b));
    setBrowse((b) => (b && b.ref === ref ? { ...b, status: 'ready', channel: r.channel, ref: r.channel.ref, tab: r.tab, items: r.items, next: r.next } : b));
    rememberChannel(r.channel);
  }, []); // eslint-disable-line
  const changeTab = async (tab) => {
    if (!browse) return;
    const { site, ref } = browse;
    setBrowse((b) => ({ ...b, tab, status: 'loading', items: [], next: null }));
    const r = await window.api.browseTab({ site, ref, tab });
    setBrowse((b) => (b && b.ref === ref ? (r.ok ? { ...b, status: 'ready', tab: r.tab || tab, items: r.items, next: r.next } : { ...b, status: 'ready', items: [], error: r.error }) : b));
  };
  const loadingMore = useRef(false);
  const loadMore = useCallback(async () => {
    const b = browse;
    if (!b || !b.next || loadingMore.current) return;
    loadingMore.current = true;
    setBrowse((x) => ({ ...x, loadingMore: true }));
    const r = await window.api.browseMore({ site: b.site, ref: b.ref, tab: b.tab, next: b.next });
    loadingMore.current = false;
    setBrowse((x) => {
      if (!x || x.ref !== b.ref || x.tab !== b.tab) return x;
      if (!r.ok) return { ...x, loadingMore: false, next: null };
      const seen = new Set(x.items.map((i) => i.id));
      return { ...x, loadingMore: false, items: [...x.items, ...r.items.filter((i) => !seen.has(i.id))], next: r.next };
    });
  }, [browse]);
  const searchSite = async (site, q) => {
    setPicker(null);
    setView('browse');
    setBrowse({ site, ref: null, status: 'loading', label: `Searching ${site === 'twitch' ? 'Twitch' : 'YouTube'} for “${q}”…`, items: [] });
    const r = await window.api.browseSearch({ site, q });
    if (!r.ok || !r.results.length) return setBrowse({ site, status: 'error', error: r.ok ? `No ${site === 'twitch' ? 'Twitch' : 'YouTube'} channel found for “${q}”` : r.error });
    openChannel({ site, ref: r.results[0].ref, alternatives: r.results.slice(1, 6) });
  };

  /** A card in the channel grid was clicked: the thumbnail flies into the player, the page shrinks into the bin. */
  const pickVideo = (item, rect) => {
    const ed = editor.current;
    const to = ed.stageRect();
    const bin = ed.binRect();
    if (item.thumbnail && rect && to) setFlyer({ src: item.thumbnail, from: rect, to, key: Date.now() });
    const el = browseEl.current;
    if (el && bin) {
      const r = el.getBoundingClientRect();
      el.animate(
        [
          { transform: 'none', opacity: 1, borderRadius: '0px' },
          { transform: `translate(${bin.left - r.left}px, ${bin.top - r.top}px) scale(${bin.width / r.width}, ${bin.height / r.height})`, opacity: 0, borderRadius: '40px' },
        ],
        { duration: 460, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'none' }
      ).onfinish = () => setView('edit');
      el.style.transformOrigin = '0 0';
    } else setView('edit');
    ed.load(item.url, { title: item.title, thumbnail: item.thumbnail, channel: browse && browse.channel && browse.channel.name, id: item.id });
  };

  // ---------- top field: link, channel or name ----------
  const submit = async (text) => {
    const t = (text ?? query).trim();
    if (!t) return;
    const r = await window.api.parseInput(t);
    if (r.kind === 'video') {
      setQuery('');
      setPicker(null);
      setView('edit');
      input.current && input.current.blur();
      editor.current.load(r.url);
    } else if (r.kind === 'channel') {
      setQuery('');
      setPicker(null);
      input.current && input.current.blur();
      openChannel({ site: r.site, ref: r.ref });
    } else if (r.kind === 'search') setPicker({ q: t });
    else toast('That link is not a video or channel', 'warn');
  };
  const pasteAndGo = async () => {
    const text = await window.api.readClipboard();
    if (!/https?:\/\//i.test(text || '')) return false;
    const r = await window.api.parseInput(text);
    if (r.kind === 'video' || r.kind === 'channel') {
      submit(text);
      return true;
    }
    return false;
  };

  // global keys: Ctrl+V anywhere, Ctrl+, settings, Ctrl+K / Ctrl+F search
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && !typing && !showSettings) {
        e.preventDefault();
        pasteAndGo().then((ok) => !ok && toast('No YouTube / Twitch link in the clipboard', 'warn'));
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        input.current && input.current.focus();
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        const done = [...jobs].reverse().find((j) => j.status === 'done');
        window.api.openPath(done && done.outputs[0] ? done.outputs[0].dir : settingsRef.current.output.baseDir);
      } else if (e.key === 'F1' || (e.key === '?' && !typing)) {
        e.preventDefault();
        setShowKeys((v) => !v);
      } else if (e.key === 'Escape' && picker) setPicker(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // drop a link anywhere
  useEffect(() => {
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (t) submit(t);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  });

  useEffect(() => {
    window.__vs = { ...(window.__vs || {}), setView, openChannel, submit, pickVideo, openProject, projects: () => projects, login: () => setLogin({ retry: null }) };
  });

  if (!settings) return <div className="boot" />;

  const toolSetup = tools && tools.progress && tools.progress.setup;
  const activeJobs = jobs.filter((j) => ACTIVE.includes(j.status));
  const ch = browse && browse.channel;
  const theme = view === 'browse' && browse ? `theme-${browse.site}` : '';

  return (
    <MenuProvider>
      <div className={`app view-${view} ${theme}`}>
        <header className="titlebar">
          <div className="brand">
            <Logo size={22} />
            <span>vodslice</span>
          </div>
          <nav className="tabs">
            <button className={view === 'home' ? 'on' : ''} onClick={() => (refreshProjects(), setView('home'))}>
              <Icon name="home" size={15} /> Home
            </button>
            <button className={view === 'browse' ? 'on' : ''} onClick={() => setView('browse')}>
              <Icon name="compass" size={15} /> Browse
            </button>
            <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>
              <Icon name="scissors" size={15} /> Edit
            </button>
          </nav>
          <div className={`urlbox ${busy ? 'loading' : ''}`}>
            <Icon name="search" size={15} />
            <input
              ref={input}
              value={query}
              placeholder="Paste a link or search a streamer…"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicker(null);
              }}
              onMouseDown={async (e) => {
                const el = e.currentTarget;
                if (document.activeElement === el || query) return;
                const ok = await pasteAndGo();
                if (ok) el.blur();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') {
                  setPicker(null);
                  e.currentTarget.blur();
                }
              }}
              onPaste={(e) => {
                const t = e.clipboardData.getData('text');
                if (/https?:\/\//i.test(t)) {
                  e.preventDefault();
                  submit(t);
                }
              }}
            />
            {busy ? <Spinner /> : query ? (
              <button className="icon-btn xs ghost" title="Clear" onClick={() => (setQuery(''), setPicker(null))}>
                <Icon name="x" size={13} />
              </button>
            ) : (
              <Kbd>Ctrl V</Kbd>
            )}
            {picker && (
              <div className="site-picker">
                <span className="sp-q">
                  Where is <b>{picker.q}</b>?
                </span>
                <button className="sp-btn yt" onClick={() => (setQuery(''), searchSite('youtube', picker.q))}>
                  <span className="sp-logo yt" />
                  YouTube
                </button>
                <button className="sp-btn tw" onClick={() => (setQuery(''), searchSite('twitch', picker.q))}>
                  <span className="sp-logo tw" />
                  Twitch
                </button>
              </div>
            )}
          </div>
          <div className="tb-actions">
            <UpdatePill busyJobs={activeJobs.length > 0} />
            <DownloadsButton jobs={jobs} notify={toast} onCaptions={setCapJob} open={dlOpen} setOpen={setDlOpen} />
            <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setShowSettings(true)}>
              <Icon name="settings" size={17} />
            </button>
          </div>
        </header>

        <div className="views">
          <div className={`view v-edit ${view === 'edit' ? 'shown' : ''}`}>
            <Editor
              ref={editor}
              settings={settings}
              active={view === 'edit'}
              modalOpen={!!showSettings || !!capJob || !!renaming || showKeys || !!login}
              onLogin={(url) => setLogin({ retry: url || null })}
              toast={toast}
              topazInfo={topazInfo}
              jobs={jobs}
              onProject={onProject}
              openSettings={(sec) => setShowSettings(sec || true)}
              onAddMedia={() => {
                input.current && input.current.focus();
                toast('Paste a link or type a streamer name', 'info', 1800);
              }}
              channel={ch}
              onChannel={() => setView('browse')}
              onRenameProject={(p) => p && setRenaming({ id: p.id, name: p.name || '' })}
              onShowKeys={() => setShowKeys(true)}
            />
          </div>
          {view === 'browse' && (
            <div className="view v-browse shown" ref={browseEl}>
              <Browse
                state={browse}
                recent={settings.ui.recentChannels}
                onTab={changeTab}
                onMore={loadMore}
                onPick={pickVideo}
                onAlt={(a) => openChannel({ site: a.site, ref: a.ref, alternatives: (browse.alternatives || []).filter((x) => x.ref !== a.ref) })}
                onOpenRecent={(r) => openChannel(r)}
                onSearch={(site, q) => searchSite(site, q)}
              />
            </div>
          )}
          {view === 'home' && (
            <div className="view v-home shown">
              <Home
                projects={projects}
                currentId={currentId}
                recentChannels={settings.ui.recentChannels}
                history={history}
                settings={settings}
                onOpen={openProject}
                onDelete={deleteProject}
                onRename={(p) => setRenaming({ id: p.id, name: p.name })}
                onNew={newProject}
                onOpenChannel={(r) => openChannel(r)}
                onFocusInput={() => input.current && input.current.focus()}
              />
            </div>
          )}
        </div>

        {flyer && <Flyer key={flyer.key} {...flyer} onDone={() => setFlyer(null)} />}

        {renaming && (
          <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && setRenaming(null)}>
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                doRename(renaming, renaming.name);
                setRenaming(null);
              }}
            >
              <h3>Rename project</h3>
              <input className="input" autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onFocus={(e) => e.target.select()} />
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        )}

        {capJob && <CaptionsEditor job={jobs.find((j) => j.id === capJob.id) || capJob} settings={settings} notify={toast} onClose={() => setCapJob(null)} />}
        {showSettings && <Settings settings={settings} tools={tools} topaz={topazInfo} section={typeof showSettings === 'string' ? showSettings : null} onClose={() => setShowSettings(false)} onLogin={() => setLogin({ retry: null })} />}
        {login && (
          <LoginDialog
            settings={settings}
            onClose={() => setLogin(null)}
            onDone={
              login.retry
                ? () => {
                    const u = login.retry;
                    setView('edit');
                    editor.current.load(u);
                  }
                : null
            }
          />
        )}
        {showKeys && <KeysOverlay onClose={() => setShowKeys(false)} />}

        {toolSetup && (
          <div className="setup">
            <div className="setup-card">
              <Logo size={40} />
              <h2>Setting up</h2>
              <p>Downloading the latest yt-dlp, FFmpeg and Deno. Only happens once.</p>
              <div className="bar">
                <span style={{ width: `${Math.round((tools.progress.progress || 0) * 100)}%` }} />
              </div>
              <p className="muted">
                {tools.progress.label} {tools.progress.total ? `· ${fmtBytes(tools.progress.bytes)} / ${fmtBytes(tools.progress.total)}` : ''}
              </p>
            </div>
          </div>
        )}
        {tools && tools.error && !toolSetup && (
          <div className="banner err">
            <Icon name="alert" size={14} /> Tool setup failed: {tools.error}
            <button className="chip sm" onClick={() => window.api.updateTools()}>
              Retry
            </button>
          </div>
        )}

        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone} ${t.action ? 'has-action' : ''}`}>
              <span>{t.text}</span>
              {t.action && (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    t.action.onClick();
                    setToasts((list) => list.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </MenuProvider>
  );
}
