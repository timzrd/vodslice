const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  replaceSetting: (key, value) => ipcRenderer.invoke('settings:replace', key, value),
  onSettings: on('settings'),
  history: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistory: on('history'),
  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  updateTools: () => ipcRenderer.invoke('tools:update'),
  onTools: on('tools:progress'),
  probe: (url) => ipcRenderer.invoke('probe', url),
  frames: (cacheId, times, height) => ipcRenderer.invoke('frames', cacheId, times, height),
  peekName: (args) => ipcRenderer.invoke('name:peek', args),
  addJob: (spec) => ipcRenderer.invoke('job:add', spec),
  cancelJob: (id) => ipcRenderer.invoke('job:cancel', id),
  jobs: () => ipcRenderer.invoke('job:list'),
  clearJobs: () => ipcRenderer.invoke('job:clear'),
  onJob: on('job'),
  onJobRemoved: on('job:removed'),
  pickFolder: (current) => ipcRenderer.invoke('dialog:folder', current),
  pickFile: (filters) => ipcRenderer.invoke('dialog:file', filters),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  openExternal: (u) => ipcRenderer.invoke('shell:external', u),
  startDrag: (files) => ipcRenderer.send('drag:start', files),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t) => ipcRenderer.invoke('clipboard:write', t),
  toggleMini: () => ipcRenderer.invoke('mini:toggle'),
  miniState: () => ipcRenderer.invoke('mini:state'),
  onMiniState: on('mini:state'),
  miniResize: (h) => ipcRenderer.send('mini:resize', h),
  miniClose: () => ipcRenderer.send('mini:close'),
  showMain: () => ipcRenderer.send('main:show'),
  appInfo: () => ipcRenderer.invoke('app:info'),
});
