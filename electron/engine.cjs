// Job engine: download only the needed parts of a VOD, cut, merge, export Gameplay + Facecam files.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const hls = require('./hls.cjs');
const probe = require('./probe.cjs');
const naming = require('./naming.cjs');

let jobSeq = 0;
const now = () => Date.now();

function hdrString(headers) {
  return Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join('');
}

class Canceled extends Error {
  constructor() {
    super('Canceled');
  }
}

class Engine extends EventEmitter {
  constructor({ tools, store }) {
    super();
    this.tools = tools;
    this.store = store;
    this.jobs = new Map();
    this.running = new Set();
    this.encoders = null;
  }

  list() {
    return [...this.jobs.values()].map((j) => j.state);
  }

  emitJob(job, force = false) {
    const t = now();
    if (!force && t - (job.lastEmit || 0) < 200) return;
    job.lastEmit = t;
    this.emit('job', { ...job.state });
  }

  set(job, patch, force = false) {
    Object.assign(job.state, patch);
    this.emitJob(job, force);
  }

  async detectEncoders() {
    if (this.encoders) return this.encoders;
    const enc = { nvenc: false };
    try {
      await this.ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'], {});
      enc.nvenc = true;
    } catch {}
    this.encoders = enc;
    return enc;
  }

  /** Run ffmpeg; resolves on success. onProgress gets 0..1 when duration is given. */
  ffmpeg(args, { duration, onProgress, job } = {}) {
    return new Promise((resolve, reject) => {
      const full = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args];
      const p = this.tools.spawn('ffmpeg', full);
      if (job) job.procs.add(p);
      let err = '';
      let buf = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (duration && onProgress && line.startsWith('out_time_us=')) {
            const us = Number(line.slice(12));
            if (us > 0) onProgress(Math.min(1, us / 1e6 / duration));
          }
        }
      });
      p.on('error', reject);
      p.on('close', (code) => {
        if (job) job.procs.delete(p);
        if (job && job.canceled) return reject(new Canceled());
        if (code === 0) resolve();
        else reject(new Error('ffmpeg: ' + (err.trim().split(/\r?\n/).slice(-2).join(' ') || `exit ${code}`)));
      });
    });
  }

  ffprobe(file) {
    return new Promise((resolve) => {
      const p = this.tools.spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        try {
          const j = JSON.parse(out);
          resolve({ width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) || 0 });
        } catch {
          resolve(null);
        }
      });
    });
  }

  enqueue(spec) {
    const settings = this.store.get();
    const id = `j${now().toString(36)}${(jobSeq++).toString(36)}`;
    const clips = (spec.clips || [])
      .map((c) => ({ ...c, segments: [...(c.segments || [])].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start) }))
      .filter((c) => c.segments.length);
    const full = !clips.length;
    const clipMode = full ? 'merge' : spec.clipMode || settings.output.clipMode;
    const baseDir = spec.baseDir || settings.output.baseDir;
    const count = clipMode === 'separate' ? clips.length : 1;
    const names = naming.reserve(this.store, {
      channelKey: spec.channelKey,
      channel: spec.channel,
      title: spec.title,
      count,
      startNumber: spec.startNumber,
      baseDir,
    });
    const totalDuration = full ? spec.duration : clips.reduce((a, c) => a + c.segments.reduce((b, s) => b + (s.end - s.start), 0), 0);
    const job = {
      id,
      spec: { ...spec, clips, full, clipMode, baseDir },
      names,
      procs: new Set(),
      abort: new AbortController(),
      canceled: false,
      state: {
        id,
        url: spec.url,
        title: spec.title,
        channel: names.channel,
        thumbnail: spec.thumbnail,
        status: 'queued',
        stage: 'Queued',
        progress: 0,
        speed: 0,
        eta: null,
        names: names.names,
        clipCount: full ? 1 : clips.length,
        totalDuration,
        outputs: [],
        error: null,
        createdAt: now(),
        quality: spec.qualityLabel || '',
      },
    };
    this.jobs.set(id, job);
    this.emitJob(job, true);
    this.pump();
    return job.state;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (['done', 'error', 'canceled'].includes(job.state.status)) {
      this.jobs.delete(id);
      this.emit('removed', id);
      return;
    }
    job.canceled = true;
    job.abort.abort();
    for (const p of job.procs) {
      try {
        p.kill();
      } catch {}
    }
    if (job.state.status === 'queued') {
      job.names.release();
      this.set(job, { status: 'canceled', stage: 'Canceled' }, true);
    }
  }

  clearFinished() {
    for (const [id, j] of this.jobs) {
      if (['done', 'error', 'canceled'].includes(j.state.status)) {
        this.jobs.delete(id);
        this.emit('removed', id);
      }
    }
  }

  pump() {
    const limit = Math.max(1, this.store.get().download.concurrentJobs || 1);
    for (const job of this.jobs.values()) {
      if (this.running.size >= limit) break;
      if (job.state.status !== 'queued' || this.running.has(job.id)) continue;
      this.running.add(job.id);
      this.run(job)
        .catch(() => {})
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
        });
    }
  }

  async run(job) {
    const tmp = path.join(job.spec.baseDir, '.vodslice-tmp', job.id);
    try {
      fs.mkdirSync(tmp, { recursive: true });
      await this.process(job, tmp);
      job.names.release();
      this.set(job, { status: 'done', stage: 'Done', progress: 1, speed: 0, eta: 0, finishedAt: now() }, true);
      this.emit('done', job.state);
    } catch (e) {
      job.names.release();
      if (job.canceled || e instanceof Canceled || /Canceled|aborted/i.test(e.message)) {
        this.set(job, { status: 'canceled', stage: 'Canceled', speed: 0 }, true);
      } else {
        console.error(e);
        this.set(job, { status: 'error', stage: 'Failed', error: e.message, speed: 0 }, true);
        this.emit('failed', job.state);
      }
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        const parent = path.dirname(tmp);
        if (fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent);
      } catch {}
    }
  }

  checkCancel(job) {
    if (job.canceled) throw new Canceled();
  }

  async process(job, tmp) {
    const s = job.spec;
    const settings = this.store.get();
    this.set(job, { status: 'preparing', stage: 'Preparing' }, true);
    await this.tools.ensure();
    const info = await probe.fullInfo(this.tools, s.cacheId, s.url);
    this.checkCancel(job);
    const quals = probe.buildQualities(info);
    const q = quals.find((x) => x.key === s.quality) || quals[0];
    if (!q) throw new Error('No downloadable video formats found');
    const fmt = (id) => info.formats.find((f) => f.format_id === id);
    const vf = fmt(q.video);
    const af = q.audio ? fmt(q.audio) : null;
    const pad = Math.max(0, Number(settings.cut.padding) || 0);
    const dur = info.duration || s.duration || 0;
    const clamp = (t) => Math.max(0, dur ? Math.min(dur, t) : t);

    // Flatten segments with padding
    const ranges = [];
    if (s.full) ranges.push({ clip: 0, start: 0, end: dur || 1e9 });
    else
      s.clips.forEach((c, ci) =>
        c.segments.forEach((seg) => ranges.push({ clip: ci, start: clamp(seg.start - pad), end: clamp(seg.end + pad) }))
      );

    // ---- Download ----
    const streams = [{ kind: 'v', f: vf, weight: af ? 0.93 : 1 }];
    if (af) streams.push({ kind: 'a', f: af, weight: 0.07 });
    for (const st of streams) {
      st.headers = { ...(st.f.http_headers || {}) };
      st.hls = probe.isHls(st.f);
      if (st.hls) {
        st.playlist = await hls.loadPlaylist(st.f.url, st.headers, job.abort.signal);
        if (st.playlist.encrypted) st.hls = false;
      }
    }
    const conns = Math.max(2, settings.download.connections || 16);
    const prog = { fraction: new Array(ranges.length * streams.length).fill(0), bytes: 0, t0: now(), samples: [] };
    const dlWeight = 0.82;
    const updateDl = () => {
      let total = 0;
      ranges.forEach((r, ri) =>
        streams.forEach((st, si) => {
          const rw = (r.end - r.start) / ranges.reduce((a, x) => a + (x.end - x.start), 0);
          total += prog.fraction[ri * streams.length + si] * st.weight * rw;
        })
      );
      const t = now();
      prog.samples.push([t, prog.bytes]);
      while (prog.samples.length > 2 && t - prog.samples[0][0] > 3000) prog.samples.shift();
      const [t0, b0] = prog.samples[0];
      const speed = t > t0 ? ((prog.bytes - b0) / (t - t0)) * 1000 : 0;
      const elapsed = (t - prog.t0) / 1000;
      const eta = total > 0.02 ? (elapsed / total) * (1 - total) : null;
      this.set(job, { progress: total * dlWeight, speed, eta, stage: 'Downloading' });
    };
    this.set(job, { status: 'downloading', stage: 'Downloading' }, true);

    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      r.files = {};
      await Promise.all(
        streams.map(async (st, si) => {
          const slot = ri * streams.length + si;
          const out = path.join(tmp, `r${ri}_${st.kind}${st.hls ? (st.playlist.map ? '.mp4' : '.ts') : '.mkv'}`);
          if (st.hls) {
            let lastBytes = 0;
            const res = await hls.downloadRange({
              url: st.f.url,
              headers: st.headers,
              playlist: st.playlist,
              start: r.start,
              end: r.end,
              outFile: out,
              connections: st.kind === 'v' ? conns : Math.max(4, Math.round(conns / 2)),
              signal: job.abort.signal,
              onProgress: (p) => {
                prog.bytes += p.bytes - lastBytes;
                lastBytes = p.bytes;
                prog.fraction[slot] = p.done / p.count;
                updateDl();
              },
            });
            r.files[st.kind] = { file: out, offset: r.start - res.fileStart, raw: true };
          } else {
            // Fallback: let ffmpeg seek inside the remote file (slower, but works for any http format).
            const len = r.end - r.start;
            await this.ffmpeg(
              [
                ...(Object.keys(st.headers).length ? ['-headers', hdrString(st.headers)] : []),
                '-ss', String(r.start), '-i', st.f.url, '-t', String(len),
                '-map', st.kind === 'v' ? '0:v:0' : '0:a:0', '-c', 'copy', out,
              ],
              {
                duration: len,
                job,
                onProgress: (p) => {
                  prog.fraction[slot] = p;
                  updateDl();
                },
              }
            );
            r.files[st.kind] = { file: out, offset: 0, raw: false };
          }
          prog.fraction[slot] = 1;
          updateDl();
        })
      );
      this.checkCancel(job);
    }

    // ---- Process ----
    this.set(job, { status: 'processing', stage: 'Cutting', speed: 0, eta: null, progress: dlWeight }, true);
    const enc = await this.detectEncoders();
    // Re-encode when frame-exact cuts are wanted or when VP9/AV1 should become editor-safe H.264.
    const convert = settings.quality.codec === 'convert' && q.codec !== 'H.264';
    const exact = settings.cut.mode === 'exact' || convert;
    const procSteps = [];
    const stepProgress = (i, n) => (p) => this.set(job, { progress: dlWeight + (1 - dlWeight) * ((i + p) / n) });

    // Count steps for progress: cut per range + per group (concat, gameplay crop, facecam)
    const groups = this.buildGroups(job, ranges);
    const fc = s.facecam && s.facecam.enabled && s.facecam.rect ? s.facecam.rect : null;
    const crop916 = s.gameplayCrop && s.gameplayCrop.mode === '9x16' ? s.gameplayCrop : null;
    const nSteps = ranges.length + groups.length * (1 + (fc ? 1 : 0) + (crop916 ? 1 : 0));
    let step = 0;

    // Cut each range to an mp4 part
    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      const v = r.files.v;
      const a = r.files.a;
      // Separate HLS audio is often raw ADTS: remux into m4a so seeking is sample-accurate.
      let aFile = a && a.file;
      if (a && a.raw) {
        const m4a = path.join(tmp, `r${ri}_a.m4a`);
        await this.ffmpeg(['-i', a.file, '-map', '0:a:0', '-c', 'copy', m4a], { job });
        aFile = m4a;
      }
      const len = r.end - r.start;
      const part = path.join(tmp, `part${ri}.mp4`);
      const args = ['-ss', v.offset.toFixed(3), '-i', v.file];
      if (a) args.push('-ss', a.offset.toFixed(3), '-i', aFile);
      args.push('-t', len.toFixed(3), '-map', '0:v:0', '-map', a ? '1:a:0' : '0:a:0?');
      if (exact) args.push(...this.videoEncodeArgs(enc, convert ? 16 : 17), '-c:a', 'aac', '-b:a', '192k');
      else args.push('-c', 'copy');
      args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', part);
      const verb = convert ? 'Converting' : 'Cutting';
      this.set(job, { stage: ranges.length > 1 ? `${verb} ${ri + 1}/${ranges.length}` : verb });
      await this.ffmpeg(args, { duration: len, job, onProgress: stepProgress(step, nSteps) });
      r.part = part;
      for (const f of Object.values(r.files)) fs.rmSync(f.file, { force: true });
      step++;
      this.checkCancel(job);
    }

    // Build outputs per group
    const outputs = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      fs.mkdirSync(g.dir, { recursive: true });
      let src = g.ranges[0].part;
      const gDur = g.ranges.reduce((acc, r) => acc + (r.end - r.start), 0);
      if (g.ranges.length > 1) {
        this.set(job, { stage: groups.length > 1 ? `Merging ${gi + 1}/${groups.length}` : 'Merging' });
        const list = path.join(tmp, `concat${gi}.txt`);
        fs.writeFileSync(list, g.ranges.map((r) => `file '${r.part.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
        src = path.join(tmp, `merged${gi}.mp4`);
        await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', src], {
          duration: gDur,
          job,
          onProgress: stepProgress(step, nSteps),
        });
      }
      step++;
      const meta = await this.ffprobe(src);
      const W = (meta && meta.width) || q.width;
      const H = (meta && meta.height) || q.height;
      const files = [];

      // Facecam first (needs the uncropped source)
      if (fc) {
        this.set(job, { stage: groups.length > 1 ? `Facecam ${gi + 1}/${groups.length}` : 'Exporting facecam' });
        const c = this.cropPx(fc, W, H);
        const out = naming.uniquePath(path.join(g.dir, `${g.prefix}${settings.output.facecamName || 'Facecam'}.mp4`));
        const args = ['-i', src, '-map', '0:v:0'];
        if (settings.facecam.includeAudio) args.push('-map', '0:a:0?', '-c:a', 'copy');
        else args.push('-an');
        args.push(
          '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`,
          '-c:v', 'libx264', '-preset', 'slow', '-crf', String(settings.facecam.crf ?? 10),
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out
        );
        await this.ffmpeg(args, { duration: gDur, job, onProgress: stepProgress(step, nSteps) });
        files.push(out);
        step++;
      }

      const gpOut = naming.uniquePath(path.join(g.dir, `${g.prefix}${settings.output.gameplayName || 'Gameplay'}.mp4`));
      if (crop916) {
        this.set(job, { stage: 'Cropping 9:16' });
        const cw = Math.min(W, Math.round((H * 9) / 16 / 2) * 2);
        const rx = typeof crop916.x === 'number' ? crop916.x : (1 - cw / W) / 2;
        const cx = Math.max(0, Math.min(W - cw, Math.round((rx * W) / 2) * 2));
        await this.ffmpeg(
          ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `crop=${cw}:${H}:${cx}:0`, ...this.videoEncodeArgs(enc, 16), '-c:a', 'copy', '-movflags', '+faststart', gpOut],
          { duration: gDur, job, onProgress: stepProgress(step, nSteps) }
        );
        step++;
      } else {
        fs.renameSync(src, gpOut);
      }
      files.unshift(gpOut);
      outputs.push({ dir: g.dir, name: g.name, files });
      this.set(job, { outputs: [...outputs] }, true);
    }
    // Remaining parts cleanup handled by tmp removal
    return outputs;
  }

  videoEncodeArgs(enc, q) {
    if (enc.nvenc) return ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', String(q), '-b:v', '0', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
    return ['-c:v', 'libx264', '-preset', 'fast', '-crf', String(q - 2), '-pix_fmt', 'yuv420p'];
  }

  cropPx(r, W, H) {
    let w = Math.max(16, Math.round((r.w * W) / 2) * 2);
    let h = Math.max(16, Math.round((r.h * H) / 2) * 2);
    w = Math.min(w, W - (W % 2));
    h = Math.min(h, H - (H % 2));
    let x = Math.round((r.x * W) / 2) * 2;
    let y = Math.round((r.y * H) / 2) * 2;
    x = Math.max(0, Math.min(W - w, x));
    y = Math.max(0, Math.min(H - h, y));
    return { x, y, w, h };
  }

  buildGroups(job, ranges) {
    const s = job.spec;
    const o = this.store.get().output;
    const flat = o.mode === 'flat';
    const base = s.baseDir;
    const names = job.names.names;
    const groups = [];
    const mk = (name, rs, prefix) => ({
      name,
      dir: flat ? base : path.join(base, name),
      prefix: flat ? `${name} - ${prefix}` : prefix,
      ranges: rs,
    });
    if (s.full || s.clipMode === 'merge') groups.push(mk(names[0], ranges, ''));
    else if (s.clipMode === 'separate') s.clips.forEach((c, ci) => groups.push(mk(names[ci], ranges.filter((r) => r.clip === ci), '')));
    else s.clips.forEach((c, ci) => groups.push(mk(names[0], ranges.filter((r) => r.clip === ci), `Clip ${ci + 1} - `)));
    return groups;
  }
}

module.exports = { Engine };
