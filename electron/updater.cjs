// In-app updates from the GitHub releases of timzrd/vodslice (public repo).
const { app } = require('electron');

let state = { state: 'idle' };
let updater = null;

function init(broadcast) {
  if (!app.isPackaged) {
    state = { state: 'dev' };
    return;
  }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (e) {
    state = { state: 'error', error: 'Updater not available' };
    return;
  }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  const set = (s) => {
    state = { ...state, ...s };
    broadcast('update', state);
  };
  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
  updater.on('update-available', (i) => set({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : '' }));
  updater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  updater.on('error', (e) => set({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 4000);
  setInterval(check, 6 * 3600 * 1000);
}

module.exports = {
  init,
  status: () => ({ ...state, current: app.getVersion() }),
  check: () => (updater ? updater.checkForUpdates().then(() => true).catch(() => false) : false),
  download: () => (updater ? updater.downloadUpdate().then(() => true).catch(() => false) : false),
  install: () => updater && updater.quitAndInstall(true, true),
};
