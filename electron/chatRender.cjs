// Renders chat messages into a transparent overlay video (QuickTime Animation, alpha) for editors.
// Drawing happens in a hidden renderer window (canvas: fonts, emote images); it sends one PNG per chat state,
// ffmpeg turns the states into a constant-frame-rate .mov with exact durations.
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');

let seq = 0;

class ChatRenderer {
  constructor({ preload, url }) {
    this.preload = preload;
    this.url = url;
    this.jobs = new Map();
    ipcMain.on('chatrender:frame', (_e, id, i, t, bytes) => {
      const j = this.jobs.get(id);
      if (!j) return;
      const file = path.join(j.dir, `f${String(i).padStart(5, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(bytes));
      j.frames.push({ i, t, file });
      if (j.onProgress && j.total) j.onProgress(Math.min(1, j.frames.length / j.total));
    });
    ipcMain.on('chatrender:start', (_e, id, total) => {
      const j = this.jobs.get(id);
      if (j) j.total = total;
    });
    ipcMain.on('chatrender:done', (_e, id) => {
      const j = this.jobs.get(id);
      if (j) j.resolve();
    });
    ipcMain.on('chatrender:error', (_e, id, msg) => {
      const j = this.jobs.get(id);
      if (j) j.reject(new Error(msg));
    });
  }

  /**
   * @param o.messages [{t (output seconds, may be < 0 for pre-filled history), name, color, parts}]
   * @param o.duration output length (s); o.width/height/fontSize; o.dir temp folder; o.out .mov path
   * @param o.ffmpeg (args, {duration, onProgress}) => Promise
   */
  async render(o) {
    const id = `cr${Date.now().toString(36)}${seq++}`;
    fs.mkdirSync(o.dir, { recursive: true });
    const win = new BrowserWindow({
      show: false,
      width: Math.min(1600, o.width + 40),
      height: Math.min(1600, o.height + 40),
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: false },
    });
    const job = { dir: o.dir, frames: [], onProgress: o.onProgress ? (p) => o.onProgress(p * 0.7) : null };
    const done = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.jobs.set(id, job);
    const abort = () => job.reject(new Error('Canceled'));
    if (o.signal) o.signal.addEventListener('abort', abort);
    // the page loads its drawing code lazily: wait until it says it's listening
    let onReady;
    const ready = new Promise((resolve) => {
      onReady = (e) => e.sender === win.webContents && resolve();
      ipcMain.on('chatrender:ready', onReady);
    });
    try {
      await win.loadURL(`${this.url}#chatrender`);
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Chat renderer did not start')), 20000))]);
      win.webContents.send('chatrender:job', {
        id,
        width: o.width,
        height: o.height,
        fontSize: o.fontSize,
        fps: 15,
        duration: o.duration,
        messages: o.messages,
      });
      await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('Chat render timed out')), 10 * 60 * 1000))]);
    } finally {
      ipcMain.removeListener('chatrender:ready', onReady);
      this.jobs.delete(id);
      if (o.signal) o.signal.removeEventListener('abort', abort);
      if (!win.isDestroyed()) win.destroy();
    }
    const frames = job.frames.sort((a, b) => a.i - b.i);
    if (!frames.length) throw new Error('Chat render produced no frames');
    // concat list with exact durations; the last image is listed twice so its duration applies
    const lines = [];
    frames.forEach((f, k) => {
      const next = k + 1 < frames.length ? frames[k + 1].t : o.duration;
      const d = Math.max(1 / 30, next - f.t);
      lines.push(`file '${f.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, `duration ${d.toFixed(4)}`);
    });
    lines.push(`file '${frames.at(-1).file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    const list = path.join(o.dir, 'frames.txt');
    fs.writeFileSync(list, lines.join('\n'));
    await o.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=argb', '-t', o.duration.toFixed(3), '-c:v', 'qtrle', '-pix_fmt', 'argb', o.out], {
      duration: o.duration,
      onProgress: o.onProgress ? (p) => o.onProgress(0.7 + p * 0.3) : null,
    });
    for (const f of frames) fs.rmSync(f.file, { force: true });
    fs.rmSync(list, { force: true });
    return { file: o.out, frames: frames.length };
  }
}

module.exports = { ChatRenderer };
