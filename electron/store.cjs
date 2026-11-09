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
    crop: 'full',              // 'full' | 'crop'
    aspect: '9:16',            // crop window: '9:16' | '1:1' | '4:3' | '16:9'
  },
  topaz: {
    enabled: false,            // enhance the facecam with Topaz Video AI after download
    preset: 'face2x',
    keepOriginal: true,        // keep Facecam.mp4 next to "Facecam Enhanced.mp4"
    suffix: 'Enhanced',
    presets: [
      { id: 'face2x', name: 'Face 2× · Iris', model: 'iris-3', scale: 2, auto: true, preblur: 0, noise: 0, details: 0, halo: 0, blur: 0, compression: 0, blend: 0.2, grain: 0, qp: 16 },
      { id: 'face4x', name: 'Face 4× · Iris', model: 'iris-3', scale: 4, auto: true, preblur: 0, noise: 0, details: 0, halo: 0, blur: 0, compression: 0, blend: 0.2, grain: 0, qp: 16 },
      { id: 'detail2x', name: 'Detail 2× · Proteus', model: 'prob-4', scale: 2, auto: true, preblur: 0, noise: 0, details: 0, halo: 0, blur: 0, compression: 0, blend: 0, grain: 0, qp: 16 },
    ],
  },
  download: {
    connections: 16,
    concurrentJobs: 2,
    cookiesFromBrowser: '',    // '' | 'firefox' | 'chrome' | 'edge' | 'brave' ...
    cookiesFile: '',
  },
  ui: {
    volume: 0.8,               // preview volume 0..1
    muted: false,
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
  premiere: {
    enabled: false,            // build the Premiere sequence automatically after each download
    format: '3:4',             // '3:4' = 1440×1920 | '9:16' = 1440×2560
    split: 1 / 3,              // facecam share of the height
    open: 'premiere',          // after building: 'premiere' = open it in Premiere | 'folder' | 'none'
    calibration: null,         // optional {kx, ky} if Premiere maps positions differently
    captions: {
      enabled: true,
      overlay: true,           // animated captions as transparent video on V3
      language: 'de',          // 'de' | 'en' | 'auto'
      model: 'large-v3-turbo',
      maxWords: 3,
      maxChars: 18,
      maxDur: 1.5,
      pause: 0.3,
      offsetMs: 0,             // shift all captions (negative = earlier)
      font: 'Arial Black',
      size: 84,
      color: '#ffffff',
      highlight: '#ffd23f',
      outline: 7,
      uppercase: true,
      posY: null,              // null = on the facecam/gameplay line
    },
  },
  premiereLayouts: {},         // channelKey -> {gameplayRect} for the vertical layout
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
