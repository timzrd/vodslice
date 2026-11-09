// Shared setup for the headless dev harnesses: a throwaway data dir (.devdata/) with tool binaries
// copied from the installed app (%APPDATA%\Vodslice\bin) so nothing is downloaded twice.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, '.devdata');

function setup() {
  const { Store } = require(path.join(ROOT, 'electron/store.cjs'));
  const { Tools } = require(path.join(ROOT, 'electron/tools.cjs'));
  const bin = path.join(DATA, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const installed = path.join(process.env.APPDATA || '', 'Vodslice', 'bin');
  for (const f of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'deno.exe']) {
    const src = path.join(installed, f);
    const dst = path.join(bin, f);
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  // whisper (large): link instead of copy when possible
  const wSrc = path.join(installed, 'whisper');
  const wDst = path.join(bin, 'whisper');
  if (!fs.existsSync(wDst) && fs.existsSync(wSrc)) {
    try {
      fs.symlinkSync(wSrc, wDst, 'junction');
    } catch {}
  }
  const store = new Store(DATA);
  store.patch({ output: { baseDir: path.join(DATA, 'out') }, tools: { lastCheck: Date.now() } });
  const tools = new Tools(bin, store);
  return { ROOT, DATA, store, tools };
}

module.exports = { setup, ROOT, DATA };
