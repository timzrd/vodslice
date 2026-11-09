const { app, BrowserWindow, ipcMain, protocol, net, session, dialog, shell, clipboard, Notification, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { Tools } = require('./tools.cjs');
const { Engine } = require('./engine.cjs');
const probe = require('./probe.cjs');
const frames = require('./frames.cjs');
const naming = require('./naming.cjs');
const topaz = require('./topaz.cjs');
const updater = require('./updater.cjs');
const { Whisper } = require('./whisper.cjs');
const { PremiereExporter } = require('./premiereExport.cjs');
const { importIntoPremiere } = require('./premiereOpen.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(DIST, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const ICON_PNG = path.join(DIST, 'icon.png');
const BG = '#0b0c0f';

// Dev runs use their own taskbar identity so Windows never caches the Electron icon for the real app.
app.setAppUserModelId(app.isPackaged ? 'app.vodslice' : 'app.vodslice.dev');
// Look like a regular Chrome to CDNs (googlevideo / ttvnw).
app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|vodslice)\/\S+/gi, '');

if (process.env.VODSLICE_TEST_SCRIPT) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

if (!process.env.VODSLICE_TEST_SCRIPT && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'vsproxy', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

let store;
let tools;
let engine;
let whisper;
let exporter;
let main = null;
let mini = null;
let miniAuto = false;
const toolState = { progress: null, error: null };

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

function defaultBaseDir() {
  return path.join(app.getPath('videos'), 'Vodslice');
}

function createMain() {
  const s = store.get().ui;
  const b = s.windowBounds || {};
  main = new BrowserWindow({
    width: b.width || 1360,
    height: b.height || 860,
    x: b.x,
    y: b.y,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: BG,
    title: 'Vodslice',
    icon: ICON,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#a3a9b3', height: 48 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  if (b.maximized && !process.env.VODSLICE_TEST_SCRIPT) main.maximize();
  if (process.env.VODSLICE_TEST_SCRIPT) {
    // automated test runs render off-screen so they don't get in the user's way
    main.setBounds({ x: -5000, y: 0, width: 1360, height: 860 });
    main.setSkipTaskbar(true);
  }
  main.loadURL('app://bundle/index.html');
  main.once('ready-to-show', () => main.show());
  const saveBounds = () => {
    if (!main || main.isDestroyed() || main.isMinimized() || process.env.VODSLICE_TEST_SCRIPT) return;
    store.patch({ ui: { windowBounds: { ...main.getNormalBounds(), maximized: main.isMaximized() } } });
  };
  main.on('resize', debounce(saveBounds, 500));
  main.on('move', debounce(saveBounds, 500));
  main.on('minimize', () => {
    const active = engine.list().some((j) => ['queued', 'preparing', 'downloading', 'processing'].includes(j.status));
    if (store.get().ui.miniAutoShow && active && !mini) {
      miniAuto = true;
      createMini();
    }
  });
  main.on('restore', () => {
    if (miniAuto && mini) mini.close();
    miniAuto = false;
  });
  main.on('close', (e) => {
    if (app.isQuitting) return;
    const active = engine.list().filter((j) => ['queued', 'preparing', 'downloading', 'processing'].includes(j.status));
    if (!active.length) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(main, {
      type: 'question',
      buttons: ['Keep downloading in mini overlay', 'Quit and cancel downloads', 'Back'],
      defaultId: 0,
      cancelId: 2,
      title: 'Downloads running',
      message: `${active.length} download${active.length > 1 ? 's are' : ' is'} still running.`,
    });
    if (r === 0) {
      main.hide();
      createMini();
    } else if (r === 1) {
      app.isQuitting = true;
      active.forEach((j) => engine.cancel(j.id));
      setTimeout(() => app.quit(), 300);
    }
  });
  main.on('closed', () => {
    main = null;
    if (mini) mini.close();
  });
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.VODSLICE_TEST_SCRIPT) runTestScript(process.env.VODSLICE_TEST_SCRIPT);
}

function createMini() {
  if (mini) {
    mini.show();
    return;
  }
  const saved = store.get().ui.miniBounds;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 340;
  mini = new BrowserWindow({
    width: w,
    height: 120,
    x: saved ? saved.x : wa.x + wa.width - w - 16,
    y: saved ? saved.y : wa.y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  mini.setAlwaysOnTop(true, 'floating');
  mini.loadURL('app://bundle/index.html#mini');
  mini.on('moved', () => {
    if (mini) store.patch({ ui: { miniBounds: mini.getBounds() } });
  });
  mini.on('closed', () => {
    mini = null;
    broadcast('mini:state', false);
    // Main window was hidden to keep downloading in the overlay: closing the overlay brings it back.
    if (main && !main.isDestroyed() && !main.isVisible()) {
      main.show();
      main.focus();
    }
  });
  broadcast('mini:state', true);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function toolsProgress(p) {
  toolState.progress = p;
  broadcast('tools:progress', { ...p, status: tools.status() });
}

async function bootTools() {
  try {
    await tools.readVersions();
    if (tools.missing().length) {
      toolsProgress({ label: 'Setting up tools', progress: 0, setup: true });
      await tools.ensure((p) => toolsProgress({ ...p, setup: true }));
      toolsProgress({ label: 'Ready', progress: 1, done: true, setup: true });
    }
    const t = store.get().tools;
    if (t.autoUpdate && Date.now() - (t.lastCheck || 0) > 12 * 3600 * 1000) {
      await tools.update((p) => toolsProgress({ ...p, background: true }));
    }
    broadcast('tools:progress', { done: true, status: tools.status() });
  } catch (e) {
    toolState.error = e.message;
    broadcast('tools:progress', { error: e.message, status: tools.status() });
  }
}

function notifyDone(job) {
  const s = store.get();
  const out = job.outputs || [];
  const firstDir = out[0] && out[0].dir;
  store.addHistory({
    id: job.id,
    title: job.title,
    channel: job.channel,
    thumbnail: job.thumbnail,
    url: job.url,
    outputs: out,
    at: Date.now(),
    duration: job.totalDuration,
  });
  broadcast('history', store.history);
  if (s.ui.notify && Notification.isSupported()) {
    const n = new Notification({
      title: 'Download finished',
      body: `${out.map((o) => o.name).join(', ')} â€” ${job.title}`.slice(0, 200),
      icon: ICON_PNG,
      silent: false,
    });
    n.on('click', () => firstDir && shell.openPath(firstDir));
    n.show();
  }
  if (s.ui.openFolderWhenDone && firstDir) shell.openPath(firstDir);
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:set', (_e, patch) => store.patch(patch));
  ipcMain.handle('settings:replace', (_e, key, value) => {
    // Replace a whole map (e.g. facecamPresets) instead of merging.
    const d = store.get();
    const parts = key.split('.');
    let o = d;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts.at(-1)] = value;
    store.save();
    return d;
  });
  ipcMain.handle('history:get', () => store.history);
  ipcMain.handle('history:clear', () => {
    store.history = [];
    store.write(store.histFile, []);
    broadcast('history', []);
  });
  ipcMain.handle('tools:status', () => ({ ...tools.status(), progress: toolState.progress, error: toolState.error }));
  ipcMain.handle('tools:update', async () => {
    const log = await tools.update((p) => toolsProgress(p), true);
    broadcast('tools:progress', { done: true, status: tools.status() });
    return log;
  });
  ipcMain.handle('probe', async (_e, url) => {
    if (tools.busy) await tools.busy;
    if (tools.missing().length) await tools.ensure((p) => toolsProgress({ ...p, setup: true }));
    return probe.probe(tools, url, store.get().quality);
  });
  ipcMain.handle('frames', (_e, cacheId, times, height) => frames.grabFrames(tools, cacheId, times, height));
  ipcMain.handle('name:peek', (_e, args) => naming.peek(store.get(), args));
  ipcMain.handle('job:add', (_e, spec) => {
    const s = store.get();
    if (!spec.baseDir && !s.output.baseDir) store.patch({ output: { baseDir: defaultBaseDir() } });
    const st = engine.enqueue(spec);
    if (store.get().ui.miniAutoShow && main && main.isMinimized()) createMini();
    return st;
  });
  ipcMain.handle('job:cancel', (_e, id) => engine.cancel(id));
  ipcMain.handle('job:list', () => engine.list());
  ipcMain.handle('job:clear', () => engine.clearFinished());
  ipcMain.handle('dialog:folder', async (e, current) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: current || undefined });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:file', async (e, filters) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('shell:open', (_e, p) => {
    if (p && fs.existsSync(p)) return shell.openPath(p);
    if (p) {
      fs.mkdirSync(p, { recursive: true });
      return shell.openPath(p);
    }
  });
  ipcMain.handle('shell:show', (_e, p) => p && shell.showItemInFolder(p));
  ipcMain.handle('shell:external', (_e, url) => /^https?:\/\//.test(url) && shell.openExternal(url));
  ipcMain.on('drag:start', (e, files) => {
    const list = (files || []).filter((f) => fs.existsSync(f));
    if (!list.length) return;
    const icon = nativeImage.createFromPath(ICON_PNG).resize({ width: 48, height: 48 });
    e.sender.startDrag({ file: list[0], files: list, icon });
  });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_e, t) => clipboard.writeText(String(t)));
  ipcMain.handle('mini:toggle', () => {
    if (mini) mini.close();
    else {
      miniAuto = false;
      createMini();
    }
    return !!mini;
  });
  ipcMain.handle('mini:state', () => !!mini);
  ipcMain.on('mini:resize', (_e, h) => {
    if (!mini) return;
    const b = mini.getBounds();
    const nh = Math.max(60, Math.min(600, Math.round(h)));
    if (b.height !== nh) mini.setBounds({ ...b, height: nh });
  });
  ipcMain.on('mini:close', () => mini && mini.close());
  ipcMain.on('main:show', () => {
    if (!main) createMain();
    else {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
  });
  // ---- Premiere export ----
  ipcMain.handle('premiere:build', async (e, o) => {
    const send = (label, p) => broadcast('premiere:progress', { dir: o.dir, label, p });
    try {
      const proj = await exporter.build(o.dir, { name: o.name, prefix: o.prefix || '', gameplayRect: o.gameplayRect || null, reuseTranscript: o.reuse !== false, onStage: send });
      send('Ready', 1);
      return { ok: true, project: proj };
    } catch (err) {
      send('Failed', 1);
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('premiere:open', async (_e, xml) => {
    clipboard.writeText(xml);
    return importIntoPremiere(xml);
  });
  ipcMain.handle('premiere:words', (_e, file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('premiere:saveWords', (_e, file, words) => {
    const prev = (() => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return {};
      }
    })();
    fs.writeFileSync(file, JSON.stringify({ ...prev, words, editedAt: Date.now() }, null, 1));
    return true;
  });
  ipcMain.handle('whisper:status', async () => {
    await whisper.hasNvidia();
    return whisper.status();
  });
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => {
    app.isQuitting = true;
    updater.install();
  });
  ipcMain.handle('topaz:status', async (_e, force) => {
    const t = await topaz.detect(!!force);
    engine.topaz = t.found ? { ffmpeg: t.ffmpeg, modelDir: t.modelDir } : null;
    return t;
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), defaultBaseDir: defaultBaseDir() }));
}

function runTestScript(file) {
  main.webContents.on('console-message', (e) => {
    const lvl = e.level != null ? e.level : '';
    if (lvl === 'warning' || lvl === 'error' || lvl === 2 || lvl === 3) console.log(`[renderer:${lvl}]`, e.message);
  });
  main.webContents.once('did-finish-load', async () => {
    const ctx = {
      main,
      get mini() {
        return mini;
      },
      createMini,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      exec: (js, w = main) => w.webContents.executeJavaScript(js, true),
      capture: async (name, w = main) => {
        const img = await w.webContents.capturePage();
        const out = path.join(process.env.VODSLICE_TEST_OUT || app.getPath('temp'), name + '.png');
        fs.writeFileSync(out, img.toPNG());
        console.log('[test] captured', out);
        return out;
      },
      engine,
      store,
    };
    try {
      await require(file)(ctx);
    } catch (e) {
      console.error('[test] failed', e);
    }
    if (!process.env.VODSLICE_TEST_KEEP) app.quit();
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new Store(userData);
  if (!store.get().output.baseDir) store.patch({ output: { baseDir: defaultBaseDir() } });
  tools = new Tools(path.join(userData, 'bin'), store);
  engine = new Engine({ tools, store });
  whisper = new Whisper(tools);
  exporter = new PremiereExporter({ tools, store, whisper });
  engine.premiere = exporter;
  engine.on('job', (j) => broadcast('job', j));
  engine.on('removed', (id) => broadcast('job:removed', id));
  engine.on('done', notifyDone);
  topaz.detect().then((t) => (engine.topaz = t.found ? { ffmpeg: t.ffmpeg, modelDir: t.modelDir } : null));
  store.onChange((d) => broadcast('settings', d));

  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || !rel) rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // YouTube media URLs are bound to the IP family yt-dlp used (often IPv6) while Chromium may connect via
  // IPv4 and get 403. The preview is therefore streamed through Node, which connects the same way yt-dlp did.
  protocol.handle('vsproxy', async (req) => {
    const u = new URL(req.url).searchParams.get('u');
    if (!u || !/^https:\/\/[^/]*googlevideo\.com\//.test(u)) return new Response('Bad request', { status: 400 });
    const h = {};
    if (probe.lastUserAgent) h['User-Agent'] = probe.lastUserAgent;
    const range = req.headers.get('range');
    if (range) h.Range = range;
    try {
      const r = await fetch(u, { headers: h });
      if (process.env.VODSLICE_TEST_SCRIPT) console.log('[proxy]', req.method, range, '->', r.status, r.headers.get('content-length'));
      const out = new Headers();
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
        const v = r.headers.get(k);
        if (v) out.set(k, v);
      }
      out.set('access-control-allow-origin', '*');
      return new Response(r.body, { status: r.status, headers: out });
    } catch (e) {
      return new Response(String(e.message), { status: 502 });
    }
  });

  // Media CDNs: allow the app:// page to read HLS playlists/segments (hls.js uses XHR).
  const ses = session.defaultSession;
  // No telemetry from the bundled face-detection runtime.
  ses.webRequest.onBeforeRequest({ urls: ['https://*.googleapis.com/*'] }, (d, cb) => cb({ cancel: /odml|play\.googleapis|firebase/i.test(d.url) }));
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (d, cb) => {
    const h = d.requestHeaders;
    delete h.Origin;
    delete h.origin;
    delete h.Referer;
    // Signed CDN URLs can be tied to the client yt-dlp used: send the same User-Agent.
    if (probe.lastUserAgent && /googlevideo\.com|ttvnw\.net|cloudfront\.net|twitch/i.test(d.url)) h['User-Agent'] = probe.lastUserAgent;
    cb({ requestHeaders: h });
  });
  ses.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    for (const k of Object.keys(h)) if (/^access-control-allow-(origin|headers|credentials)$/i.test(k)) delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    h['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: h });
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-read', 'clipboard-sanitized-write', 'pointerLock', 'notifications'].includes(perm)));

  registerIpc();
  createMain();
  bootTools();
  updater.init(broadcast);
});

app.on('second-instance', () => {
  if (main) {
    if (main.isMinimized()) main.restore();
    main.focus();
  }
});

app.on('window-all-closed', () => app.quit());
