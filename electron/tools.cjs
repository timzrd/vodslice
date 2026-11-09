// Manages private copies of yt-dlp, ffmpeg/ffprobe and deno (JS runtime required by yt-dlp for YouTube).
// Everything lives in <userData>/bin so nothing depends on PATH, registry entries or other installs.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const SOURCES = {
  ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  ffmpeg: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  deno: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
};

const DAY = 24 * 3600 * 1000;

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout || 120000, maxBuffer: 64 * 1024 * 1024, env: opts.env }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function which(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d.replace(/"/g, ''), name);
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

class Tools {
  constructor(binDir, store) {
    this.binDir = binDir;
    this.store = store;
    fs.mkdirSync(binDir, { recursive: true });
    this.versions = {};
    this.busy = null;
  }

  get paths() {
    const b = this.binDir;
    return {
      ytdlp: path.join(b, 'yt-dlp.exe'),
      ffmpeg: path.join(b, 'ffmpeg.exe'),
      ffprobe: path.join(b, 'ffprobe.exe'),
      deno: path.join(b, 'deno.exe'),
    };
  }

  env() {
    // UTF-8 output from yt-dlp (otherwise Windows' console code page garbles ’ ä ö ü in messages and titles)
    return { ...process.env, PATH: this.binDir + path.delimiter + (process.env.PATH || ''), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  }

  missing() {
    const p = this.paths;
    return Object.entries(p)
      .filter(([, f]) => !fs.existsSync(f))
      .map(([k]) => k);
  }

  async readVersions() {
    const p = this.paths;
    const v = {};
    if (fs.existsSync(p.ytdlp)) v.ytdlp = (await run(p.ytdlp, ['--version'])).stdout.trim();
    if (fs.existsSync(p.ffmpeg)) {
      const out = (await run(p.ffmpeg, ['-hide_banner', '-version'])).stdout;
      const m = /ffmpeg version (\S+)/.exec(out);
      v.ffmpeg = m ? m[1].replace(/-win64.*/, '').slice(0, 28) : 'unknown';
    }
    if (fs.existsSync(p.deno)) {
      const m = /deno (\S+)/.exec((await run(p.deno, ['--version'])).stdout);
      v.deno = m ? m[1] : 'unknown';
    }
    this.versions = v;
    return v;
  }

  status() {
    return { binDir: this.binDir, missing: this.missing(), versions: this.versions, busy: !!this.busy };
  }

  async download(url, dest, label, onProgress) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Vodslice' } });
    if (!res.ok) throw new Error(`Download failed (${res.status}) ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    let last = 0;
    const tmp = dest + '.part';
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => {
      got += c.length;
      const now = Date.now();
      if (now - last > 150) {
        last = now;
        onProgress?.({ label, progress: total ? got / total : 0, bytes: got, total });
      }
    });
    await pipeline(body, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    onProgress?.({ label, progress: 1, bytes: got, total });
  }

  async extractZip(zip, pick, onProgress) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vodslice-x-'));
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    onProgress?.({ label: 'Extracting', progress: 1 });
    const r = await run(tar, ['-xf', zip, '-C', out], { timeout: 300000 });
    if (!r.ok) throw new Error('Extract failed: ' + r.stderr.slice(0, 300));
    const found = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (pick.includes(e.name.toLowerCase())) found[e.name.toLowerCase()] = p;
      }
    };
    walk(out);
    for (const name of pick) {
      if (!found[name]) throw new Error(`${name} not found in archive`);
      const dest = path.join(this.binDir, name);
      try { fs.rmSync(dest, { force: true }); } catch {}
      fs.copyFileSync(found[name], dest);
    }
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }

  async installYtdlp(onProgress) {
    await this.download(SOURCES.ytdlp, this.paths.ytdlp, 'yt-dlp', onProgress);
  }

  async installFfmpeg(onProgress) {
    const zip = path.join(this.binDir, 'ffmpeg.zip');
    await this.download(SOURCES.ffmpeg, zip, 'ffmpeg', onProgress);
    await this.extractZip(zip, ['ffmpeg.exe', 'ffprobe.exe'], onProgress);
    this.store.patch({ tools: { ffmpegStamp: Date.now() } });
  }

  async installDeno(onProgress) {
    const zip = path.join(this.binDir, 'deno.zip');
    await this.download(SOURCES.deno, zip, 'Deno (JS runtime)', onProgress);
    await this.extractZip(zip, ['deno.exe'], onProgress);
    this.store.patch({ tools: { denoStamp: Date.now() } });
  }

  // Make sure every tool exists. Missing tools are downloaded fresh from their official GitHub releases.
  async ensure(onProgress) {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const miss = this.missing();
      if (miss.includes('ytdlp')) await this.installYtdlp(onProgress);
      if (miss.includes('ffmpeg') || miss.includes('ffprobe')) await this.installFfmpeg(onProgress);
      if (miss.includes('deno')) await this.installDeno(onProgress);
      await this.readVersions();
    })().finally(() => (this.busy = null));
    return this.busy;
  }

  // Update tools. force=true updates everything now, otherwise respects intervals.
  async update(onProgress, force = false) {
    await this.ensure(onProgress);
    const t = this.store.get().tools;
    const now = Date.now();
    const log = [];
    onProgress?.({ label: 'Updating yt-dlp', progress: 0 });
    const r = await run(this.paths.ytdlp, ['-U'], { timeout: 180000, env: this.env() });
    const line = (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).pop() || '';
    log.push('yt-dlp: ' + line.trim());
    if (force || !t.denoStamp || now - t.denoStamp > 7 * DAY) {
      onProgress?.({ label: 'Updating Deno', progress: 0 });
      const d = await run(this.paths.deno, ['upgrade', '--quiet'], { timeout: 300000, env: this.env() });
      log.push('deno: ' + (d.ok ? 'ok' : (d.stderr || d.stdout).trim().split(/\r?\n/).pop()));
      this.store.patch({ tools: { denoStamp: now } });
    }
    if (force || !t.ffmpegStamp || now - t.ffmpegStamp > 30 * DAY) {
      try {
        await this.installFfmpeg(onProgress);
        log.push('ffmpeg: updated');
      } catch (e) {
        log.push('ffmpeg: ' + e.message);
      }
    }
    this.store.patch({ tools: { lastCheck: now } });
    await this.readVersions();
    onProgress?.({ label: 'Done', progress: 1, done: true });
    return log;
  }

  ytdlpBaseArgs() {
    const s = this.store.get().download;
    const args = ['--no-warnings', '--ffmpeg-location', this.binDir, '--js-runtimes', `deno:${this.paths.deno}`];
    if (s.cookiesFile) args.push('--cookies', s.cookiesFile);
    else if (s.cookiesFromBrowser) args.push('--cookies-from-browser', s.cookiesFromBrowser);
    return args;
  }

  spawn(tool, args, opts = {}) {
    return spawn(this.paths[tool], args, { windowsHide: true, env: this.env(), ...opts });
  }
}

module.exports = { Tools, run, which };
