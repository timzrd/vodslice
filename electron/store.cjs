// Tiny JSON-backed persistent store (settings, history, per-channel memory).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  output: {
    baseDir: '',               // empty = ask on first download (falls back to Videos/Vodslice)
    mode: 'folders',           // 'folders' = numbered folder per download | 'flat' = everything in baseDir
    template: '{channel} {n}', // folder (or file prefix) name
    counterMode: 'auto',       // 'auto' = scan baseDir for highest number | 'manual' = use stored counters
    counters: {},              // channelKey -> next number (manual mode)
    aliases: {},               // channelKey -> display name used in {channel}
    gameplayName: 'Gameplay',
    facecamName: 'Facecam',
    clipMode: 'separate',      // 'separate' | 'together' | 'merge'
  },
  quality: {
    maxHeight: 0,              // 0 = best available
    codec: 'convert',          // 'convert' = best resolution, re-encoded to H.264 if VP9/AV1 | 'best' = keep original codec | 'h264' = prefer native H.264 formats
  },
  cut: {
    mode: 'fast',              // 'fast' = keyframe stream copy | 'exact' = frame-accurate re-encode
    padding: 0,                // seconds added before/after each segment
  },
  facecam: {
    enabled: true,
    autoDetect: true,          // auto-detect when no remembered box exists for a channel
    crf: 10,                   // libx264 CRF for facecam export (lower = better, good for AI upscaling)
    includeAudio: true,
  },
  gameplay: {
    crop: 'full',              // 'full' | '9x16'
  },
  download: {
    connections: 16,
    concurrentJobs: 2,
    cookiesFromBrowser: '',    // '' | 'firefox' | 'chrome' | 'edge' | 'brave' ...
    cookiesFile: '',
  },
  ui: {
    dragInvert: false,         // time picker: false = drag up increases
    dragSensitivity: 7,        // px per step
    openFolderWhenDone: false,
    notify: true,
    miniAutoShow: true,        // show mini overlay when the main window is minimized during a download
    miniBounds: null,
    windowBounds: null,
  },
  tools: {
    autoUpdate: true,
    lastCheck: 0,
  },
  facecamPresets: {},          // channelKey -> {x,y,w,h} normalized
  cropPresets: {},             // channelKey -> {x} normalized (9:16 crop position)
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base[k];
    const o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o) ? deepMerge(b, o) : o;
  }
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
    this.histFile = path.join(dir, 'history.json');
    this.data = deepMerge(DEFAULTS, this.read(this.file, {}));
    this.history = this.read(this.histFile, []);
    this.listeners = new Set();
  }
  read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }
  write(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  get() {
    return this.data;
  }
  patch(p) {
    // Objects that are full maps (presets, counters, aliases) are replaced only when explicitly passed.
    this.data = deepMerge(this.data, p);
    this.save();
    return this.data;
  }
  save() {
    this.write(this.file, this.data);
    for (const l of this.listeners) l(this.data);
  }
  onChange(fn) {
    this.listeners.add(fn);
  }
  addHistory(entry) {
    this.history = [entry, ...this.history.filter((h) => h.id !== entry.id)].slice(0, 60);
    this.write(this.histFile, this.history);
  }
}

module.exports = { Store, DEFAULTS, deepMerge };
