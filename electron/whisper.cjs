// Local speech-to-text with whisper.cpp (no cloud). Binaries + models are installed on first use.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODELS = {
  'large-v3-turbo': { file: 'ggml-large-v3-turbo-q5_0.bin', dtw: 'large.v3.turbo', label: 'Large v3 Turbo — best (GPU)', mb: 547 },
  medium: { file: 'ggml-medium-q5_0.bin', dtw: 'medium', label: 'Medium — good on CPU', mb: 514 },
  small: { file: 'ggml-small-q5_1.bin', dtw: 'small', label: 'Small — fastest', mb: 181 },
};
const VAD = { file: 'ggml-silero-v5.1.2.bin', url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin' };

function sh(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout || 15000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
  });
}

class Whisper {
  constructor(tools) {
    this.tools = tools;
    this.dir = path.join(tools.binDir, 'whisper');
    fs.mkdirSync(this.dir, { recursive: true });
    this.gpu = null;
    this.busy = null;
  }

  exe(kind) {
    return path.join(this.dir, kind, 'whisper-cli.exe');
  }
  modelPath(id) {
    return path.join(this.dir, (MODELS[id] || MODELS['large-v3-turbo']).file);
  }

  async hasNvidia() {
    if (this.gpu != null) return this.gpu;
    const r = await sh('nvidia-smi', ['-L']);
    this.gpu = r.ok && /GPU \d/.test(r.out);
    return this.gpu;
  }

  status() {
    return {
      cuda: fs.existsSync(this.exe('cuda')),
      cpu: fs.existsSync(this.exe('cpu')),
      gpu: this.gpu,
      models: Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, { label: m.label, mb: m.mb, installed: fs.existsSync(this.modelPath(id)) }])),
    };
  }

  async latestAssets() {
    const r = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15', { headers: { 'User-Agent': 'Vodslice' } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const rel = (await r.json()).find((x) => x.assets && x.assets.some((a) => a.name === 'whisper-bin-x64.zip'));
    if (!rel) throw new Error('No whisper.cpp Windows build found');
    return rel.assets;
  }

  async installBinary(kind, onProgress) {
    const assets = await this.latestAssets();
    const a =
      kind === 'cuda'
        ? assets.find((x) => /cuda-11\.8.*x64\.zip$|cublas-11\.8.*x64\.zip$/.test(x.name)) || assets.find((x) => /(cuda|cublas)-12.*x64\.zip$/.test(x.name))
        : assets.find((x) => x.name === 'whisper-bin-x64.zip');
    if (!a) throw new Error(`No whisper.cpp ${kind} build found`);
    const zip = path.join(this.dir, `${kind}.zip`);
    await this.tools.download(a.browser_download_url, zip, kind === 'cuda' ? 'Whisper (GPU)' : 'Whisper', onProgress);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vodslice-w-'));
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    onProgress && onProgress({ label: 'Extracting Whisper', progress: 1 });
    await new Promise((res, rej) => execFile(tar, ['-xf', zip, '-C', tmp], { windowsHide: true, timeout: 600000 }, (e) => (e ? rej(e) : res())));
    // the exe sits in "Release/" (or the root) together with its DLLs
    const find = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isFile() && e.name === 'whisper-cli.exe') return d;
        if (e.isDirectory()) {
          const r = find(p);
          if (r) return r;
        }
      }
      return null;
    };
    const src = find(tmp);
    if (!src) throw new Error('whisper-cli.exe not found in archive');
    const dst = path.join(this.dir, kind);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (/\.(exe|dll)$/i.test(f) && (/whisper-cli|\.dll$/i.test(f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }

  /** Make sure binary (GPU build on NVIDIA, else CPU), the chosen model and the VAD model exist. */
  async ensure(model, onProgress) {
    while (this.busy) await this.busy;
    this.busy = (async () => {
      const gpu = await this.hasNvidia();
      if (gpu && !fs.existsSync(this.exe('cuda'))) await this.installBinary('cuda', onProgress);
      if (!fs.existsSync(this.exe('cpu'))) await this.installBinary('cpu', onProgress);
      const m = MODELS[model] || MODELS['large-v3-turbo'];
      if (!fs.existsSync(this.modelPath(model))) await this.tools.download(HF + m.file, this.modelPath(model), `Speech model (${m.mb} MB)`, onProgress);
      const vad = path.join(this.dir, VAD.file);
      if (!fs.existsSync(vad)) await this.tools.download(VAD.url, vad, 'Voice detection model', onProgress);
    })().finally(() => (this.busy = null));
    return this.busy;
  }

  run(exe, args, { onProgress, job }) {
    return new Promise((resolve, reject) => {
      const p = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
      if (job) job.procs.add(p);
      let err = '';
      const onData = (d) => {
        const s = String(d);
        err = (err + s).slice(-6000);
        const m = s.match(/progress\s*=\s*(\d+)%/g);
        if (m && onProgress) onProgress(Number(m.at(-1).match(/(\d+)/)[1]) / 100);
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', onData);
      p.on('error', reject);
      p.on('close', (code) => {
        if (job) job.procs.delete(p);
        if (job && job.canceled) return reject(new Error('Canceled'));
        code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(' ') || `whisper exit ${code}`));
      });
    });
  }

  /**
   * Transcribe a 16 kHz mono WAV. Returns words [{ w, start, end, p }] in seconds.
   * Token timestamps (measured more accurate than DTW here) + Silero VAD against hallucinations on music/game
   * audio. Starts/ends are snapped to the real speech edges afterwards (align.cjs).
   */
  async transcribe(wav, { model = 'large-v3-turbo', language = 'de', onProgress, job, prompt } = {}) {
    const m = MODELS[model] || MODELS['large-v3-turbo'];
    const outBase = wav.replace(/\.wav$/i, '');
    const vad = path.join(this.dir, VAD.file);
    const args = (gpuOk) => [
      '-m', this.modelPath(model),
      '-f', wav,
      '-l', language,
      '-ojf', '-of', outBase,
      '--vad', '-vm', vad, '-vspd', '150', '-vsd', '200', '-vp', '120',
      '-sns',
      '-pp', '-np',
      '-t', String(Math.max(2, Math.min(8, os.cpus().length - 2))),
      ...(prompt ? ['--prompt', prompt] : []),
      ...(gpuOk ? [] : ['-ng']),
    ];
    const gpu = (await this.hasNvidia()) && fs.existsSync(this.exe('cuda'));
    let used = gpu ? 'gpu' : 'cpu';
    try {
      await this.run(gpu ? this.exe('cuda') : this.exe('cpu'), args(gpu), { onProgress, job });
    } catch (e) {
      if (!gpu || (job && job.canceled)) throw e;
      // GPU not usable (driver/VRAM) -> CPU build
      used = 'cpu';
      await this.run(this.exe('cpu'), args(false), { onProgress, job });
    }
    const json = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8'));
    return { words: wordsFromJson(json), device: used };
  }
}

/** Merge whisper tokens into words with DTW times. */
function wordsFromJson(json) {
  const words = [];
  for (const seg of json.transcription || []) {
    const segEnd = (seg.offsets && seg.offsets.to) / 1000;
    let cur = null;
    for (const t of seg.tokens || []) {
      const text = t.text || '';
      if (!text || /^\[_|^<\|/.test(text)) continue; // special tokens
      const time = t.t_dtw != null && t.t_dtw >= 0 ? t.t_dtw / 100 : (t.offsets ? t.offsets.from / 1000 : null);
      const startsWord = /^\s/.test(text) || !cur;
      if (startsWord) {
        if (cur) words.push(cur);
        cur = { w: text.trim(), start: time, end: t.offsets ? t.offsets.to / 1000 : time, p: t.p || 1 };
      } else {
        cur.w += text;
        if (t.offsets) cur.end = Math.max(cur.end, t.offsets.to / 1000);
        cur.p = Math.min(cur.p, t.p || 1);
      }
    }
    if (cur) {
      cur.end = Math.max(cur.end || 0, Math.min(segEnd || cur.end, (cur.start || 0) + 1.2));
      words.push(cur);
    }
  }
  // clean: drop empty/punctuation-only, end = next start (bounded)
  const out = words.filter((x) => x.w && /[\p{L}\p{N}]/u.test(x.w) && x.start != null);
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const maxEnd = out[i].start + Math.max(0.15, Math.min(1.2, 0.08 * out[i].w.length + 0.25));
    out[i].end = next ? Math.min(next.start, Math.max(out[i].start + 0.12, Math.min(out[i].end || maxEnd, maxEnd))) : Math.max(out[i].start + 0.2, Math.min(out[i].end || maxEnd, maxEnd));
  }
  return out;
}

module.exports = { Whisper, MODELS, wordsFromJson };
