// Builds the premiere/ folder for one clip folder: transcript -> captions (SRT/ASS/overlay) -> FCP XML.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const captions = require('./captions.cjs');
const premiere = require('./premiere.cjs');
const { snapWords } = require('./align.cjs');

const FORMATS = { '3:4': [1440, 1920], '9:16': [1440, 2560] };

class PremiereExporter {
  constructor({ tools, store, whisper }) {
    this.tools = tools;
    this.store = store;
    this.whisper = whisper;
  }

  ffmpeg(args, { duration, onProgress, job } = {}) {
    return new Promise((resolve, reject) => {
      const p = this.tools.spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args]);
      if (job) job.procs.add(p);
      let err = '';
      let buf = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-3000)));
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (duration && onProgress && line.startsWith('out_time_us=')) onProgress(Math.min(1, Number(line.slice(12)) / 1e6 / duration));
        }
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (job) job.procs.delete(p);
        if (job && job.canceled) return reject(new Error('Canceled'));
        code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.trim().split(/\r?\n/).slice(-2).join(' ')));
      });
    });
  }

  probe(file) {
    return new Promise((resolve) => {
      execFile(this.tools.paths.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,sample_rate,channels:format=duration', '-of', 'json', file], { windowsHide: true }, (e, out) => {
        try {
          const j = JSON.parse(out);
          const v = j.streams.find((s) => s.codec_type === 'video') || {};
          const a = j.streams.find((s) => s.codec_type === 'audio');
          const [n, d] = String(v.r_frame_rate || '30/1').split('/').map(Number);
          resolve({ path: file, width: v.width, height: v.height, fps: d ? n / d : 30, duration: Number(j.format.duration) || 0, hasAudio: !!a, sampleRate: a ? Number(a.sample_rate) : 48000, channels: a ? a.channels : 2 });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /** Locate the clip's media files inside an output folder (or flat-mode prefix). */
  findFiles(dir, prefix = '') {
    const s = this.store.get().output;
    const all = fs.readdirSync(dir);
    const pick = (re) => all.find((f) => re.test(f));
    const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const gp = pick(new RegExp(`^${p}${s.gameplayName || 'Gameplay'}\\.mp4$`, 'i'));
    const fcEnh = pick(new RegExp(`^${p}${s.facecamName || 'Facecam'} .*\\.mp4$`, 'i'));
    const fc = pick(new RegExp(`^${p}${s.facecamName || 'Facecam'}\\.mp4$`, 'i'));
    const ch = pick(new RegExp(`^${p}Chat\\.mov$`, 'i'));
    return {
      gameplay: gp ? path.join(dir, gp) : null,
      facecam: fcEnh ? path.join(dir, fcEnh) : fc ? path.join(dir, fc) : null,
      chat: ch ? path.join(dir, ch) : null,
    };
  }

  /**
   * Create / refresh premiere/<name>.xml (+ srt, ass, overlay, project.json).
   * opts.reuseTranscript: keep words.json (edited transcript) instead of running whisper again.
   */
  async build(dir, { name, prefix = '', gameplayRect = null, job, onStage, reuseTranscript = true } = {}) {
    const st = this.store.get();
    const P = st.premiere;
    const files = this.findFiles(dir, prefix);
    if (!files.gameplay) throw new Error('Gameplay file not found in the clip folder');
    const outDir = path.join(dir, prefix ? `${prefix.trim()} premiere` : 'premiere');
    fs.mkdirSync(outDir, { recursive: true });
    const base = (name || path.basename(dir)).replace(/[<>:"/\\|?*]/g, '');
    const projFile = path.join(outDir, 'project.json');
    const prev = fs.existsSync(projFile) ? JSON.parse(fs.readFileSync(projFile, 'utf8')) : {};
    const stage = (label, p) => onStage && onStage(label, p);

    const g = await this.probe(files.gameplay);
    if (!g || !g.width) throw new Error('Could not read the gameplay file');
    const fc = files.facecam ? await this.probe(files.facecam) : null;
    const chatMedia = files.chat ? await this.probe(files.chat) : null;
    const [W, H] = FORMATS['3:4']; // always 1440×1920: the facecam is cropped to the top area in Premiere
    const split = Math.min(0.6, Math.max(0.15, Number(P.split) || 1 / 3));

    // ---- transcript ----
    let words = null;
    let device = prev.device || null;
    const wordsFile = path.join(outDir, `${base}.words.json`);
    if (P.captions.enabled) {
      if (reuseTranscript && fs.existsSync(wordsFile)) words = JSON.parse(fs.readFileSync(wordsFile, 'utf8')).words;
      else if (g.hasAudio) {
        stage('Preparing speech model', 0);
        await this.whisper.ensure(P.captions.model, (p) => stage(p.label || 'Downloading speech model', p.progress || 0));
        stage('Extracting audio', 0);
        const wav = path.join(outDir, `${base}.16k.wav`);
        await this.ffmpeg(['-i', files.gameplay, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { job });
        stage('Transcribing', 0);
        const r = await this.whisper.transcribe(wav, { model: P.captions.model, language: P.captions.language || 'de', job, onProgress: (p) => stage('Transcribing', p) });
        words = snapWords(r.words, wav);
        device = r.device;
        fs.writeFileSync(wordsFile, JSON.stringify({ words, model: P.captions.model, device, createdAt: Date.now() }, null, 1));
        for (const f of [wav, wav.replace(/\.wav$/, '.json')]) fs.rmSync(f, { force: true });
      }
    }

    // ---- captions ----
    let srt = null;
    let ass = null;
    let overlay = null;
    if (words && words.length) {
      const c = P.captions;
      const capY = c.posY != null ? c.posY * H : Math.round(H * split);
      const r = captions.writeAll(outDir, base, words, {
        maxWords: c.maxWords,
        maxChars: c.maxChars,
        maxDur: c.maxDur,
        pause: c.pause,
        offsetMs: c.offsetMs,
        width: W,
        height: H,
        y: capY,
        font: c.font,
        size: c.size,
        color: c.color,
        highlight: c.highlight,
        outline: c.outline,
        uppercase: c.uppercase,
      });
      srt = r.srt;
      ass = r.ass;
      if (c.overlay) {
        stage('Rendering captions', 0);
        overlay = path.join(outDir, `${base}_captions.mov`);
        const assArg = r.ass.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        await this.ffmpeg(
          [
            '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H}:r=${premiere.rateOf(g.fps).fps}:d=${g.duration.toFixed(3)},format=rgba`,
            '-vf', `ass='${assArg}':alpha=1`,
            '-c:v', 'qtrle', '-pix_fmt', 'argb', overlay,
          ],
          { job, duration: g.duration, onProgress: (p) => stage('Rendering captions', p) }
        );
      }
    }

    // ---- XML ----
    stage('Writing Premiere file', 1);
    const xml = premiere.buildXml({
      name: base,
      width: W,
      height: H,
      split,
      gameplay: g,
      gameplayRect,
      facecam: fc && fc.width ? fc : null,
      overlay: overlay ? { path: overlay, width: W, height: H } : null,
      chat: chatMedia && chatMedia.width ? chatMedia : null,
      calibration: P.calibration || null,
    });
    const xmlPath = path.join(outDir, `${base}.xml`);
    fs.writeFileSync(xmlPath, xml);
    const project = {
      name: base,
      format: `${W}x${H}`,
      split,
      gameplayRect,
      files: { gameplay: files.gameplay, facecam: files.facecam, chat: files.chat, overlay, srt, ass, xml: xmlPath, words: words ? wordsFile : null },
      captions: P.captions,
      device,
      status: 'ready',
      updatedAt: Date.now(),
    };
    fs.writeFileSync(projFile, JSON.stringify(project, null, 1));
    return project;
  }
}

module.exports = { PremiereExporter, FORMATS };
