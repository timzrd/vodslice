// Job engine: download only the needed parts of one or more videos, cut, merge, export Gameplay + Facecam.
//
// Job spec:
//   sources: { [cacheId]: { url, title, channel, channelKey, duration, thumbnail, quality, facecamRect, cropX } }
//   clips:   [{ src: cacheId, segments: [{ start, end }] }]   (empty = full video of the only source)
//   clipMode: 'separate' | 'together' | 'merge', facecamOn, cropOn, startNumber, baseDir
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn: spawnExe } = require('node:child_process');
const hls = require('./hls.cjs');
const probe = require('./probe.cjs');
const naming = require('./naming.cjs');
const chat = require('./chat.cjs');

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

const ACTIVE = ['queued', 'preparing', 'downloading', 'processing'];

class Engine extends EventEmitter {
  constructor({ tools, store }) {
    super();
    this.tools = tools;
    this.store = store;
    this.jobs = new Map();
    this.running = new Set();
    this.encoders = null;
    this.premiere = null; // PremiereExporter, set by main
    this.chatRenderer = null; // ChatRenderer, set by main
  }

  warn(job, msg) {
    this.set(job, { warning: [job.state.warning, msg].filter(Boolean).join(' · ') }, true);
  }

  /** Chat overlay per output: messages of every range (mapped onto the output timeline) → transparent Chat.mov. */
  async chatStep(job, groups, outputs, srcs, tmp) {
    const C = this.store.get().chat || {};
    const pre = Math.max(0, Number(C.prefill != null ? C.prefill : 15));
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const label = groups.length > 1 ? `Chat ${gi + 1}/${groups.length}` : 'Chat';
      try {
        this.set(job, { stage: `${label}: reading messages`, eta: null }, true);
        const msgs = [];
        let acc = 0;
        for (let k = 0; k < g.ranges.length; k++) {
          const r = g.ranges[k];
          const dur = (r.meta && r.meta.duration) || r.end - r.start;
          // a bit of history before the first range so the overlay doesn't start empty
          const list = await chat.fetchRange(srcs[r.src].src, r.start - (k === 0 ? pre : 0), r.start + dur, { signal: job.abort.signal });
          for (const m of list) msgs.push({ ...m, t: acc + (m.t - r.start) });
          acc += dur;
        }
        this.checkCancel(job);
        if (!msgs.some((m) => m.t >= 0)) {
          this.warn(job, 'Chat: no messages in this part');
          continue;
        }
        const out = naming.uniquePath(path.join(g.dir, `${g.prefix}Chat.mov`));
        this.set(job, { stage: `${label}: rendering` }, true);
        await this.chatRenderer.render({
          messages: msgs.filter((m) => m.t >= -pre - 1),
          duration: acc,
          // with a Premiere layout the chat is rendered at the exact size of its box
          width: Math.round((job.spec.chatSize && job.spec.chatSize.width) || C.width || 520),
          height: Math.round((job.spec.chatSize && job.spec.chatSize.height) || C.height || 820),
          fontSize: Math.round(C.fontSize || 26),
          dir: path.join(tmp, `chat${gi}`),
          out,
          signal: job.abort.signal,
          ffmpeg: (args, o) => this.ffmpeg(args, { ...o, job }),
        });
        outputs[gi].files.push(out);
        this.set(job, { outputs: outputs.map((o) => ({ ...o, files: [...o.files] })) }, true);
      } catch (e) {
        if (job.canceled) throw e;
        this.warn(job, `Chat: ${e.message}`);
      }
    }
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
    // leave room at the end of the bar for the Premiere step
    if (patch.progress != null && job.scale && !job.inPremiere) patch = { ...patch, progress: patch.progress * job.scale };
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
  ffmpeg(args, { duration, onProgress, job, bin, env } = {}) {
    return new Promise((resolve, reject) => {
      const full = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args];
      const p = bin ? spawnExe(bin, full, { windowsHide: true, env: env || process.env }) : this.tools.spawn('ffmpeg', full);
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

  /** Basic media facts for a local file. */
  media(file) {
    return new Promise((resolve) => {
      const p = this.tools.spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', file]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        try {
          const j = JSON.parse(out);
          const v = j.streams.find((s) => s.codec_type === 'video') || {};
          const [n, d] = String(v.r_frame_rate || '30/1').split('/').map(Number);
          resolve({
            width: v.width,
            height: v.height,
            fps: d ? Math.round((n / d) * 100) / 100 : 30,
            vcodec: v.codec_name,
            hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
            duration: Number(j.format.duration) || 0,
          });
        } catch {
          resolve(null);
        }
      });
    });
  }

  enqueue(spec) {
    const settings = this.store.get();
    const id = `j${now().toString(36)}${(jobSeq++).toString(36)}`;
    const sources = spec.sources || {};
    let clips = (spec.clips || [])
      .map((c) => ({ ...c, segments: [...(c.segments || [])].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start) }))
      .filter((c) => c.segments.length && sources[c.src]);
    const full = !clips.length;
    if (full) {
      const src = Object.keys(sources)[0];
      if (!src) throw new Error('Nothing to download');
      clips = [{ src, segments: [{ start: 0, end: sources[src].duration || 1e9 }], full: true }];
    }
    const clipMode = clips.length === 1 ? 'merge' : spec.clipMode || settings.output.clipMode;
    const baseDir = spec.baseDir || settings.output.baseDir;

    // Reserve folder numbers per channel (separate) or one name for the whole job.
    const reservations = [];
    const clipNames = new Array(clips.length);
    if (clipMode === 'separate') {
      const byChannel = new Map();
      clips.forEach((c, i) => {
        const key = sources[c.src].channelKey;
        if (!byChannel.has(key)) byChannel.set(key, []);
        byChannel.get(key).push(i);
      });
      let first = true;
      for (const [key, idxs] of byChannel) {
        const s0 = sources[clips[idxs[0]].src];
        const r = naming.reserve(this.store, {
          channelKey: key,
          channel: s0.channel,
          title: s0.title,
          count: idxs.length,
          startNumber: first ? spec.startNumber : null,
          baseDir,
        });
        first = false;
        reservations.push(r);
        idxs.forEach((ci, k) => (clipNames[ci] = r.names[k]));
      }
    } else {
      const s0 = sources[clips[0].src];
      const r = naming.reserve(this.store, { channelKey: s0.channelKey, channel: s0.channel, title: s0.title, count: 1, startNumber: spec.startNumber, baseDir });
      reservations.push(r);
      clips.forEach((_, i) => (clipNames[i] = r.names[0]));
    }
    const names = clipMode === 'separate' ? clipNames : [clipNames[0]];
    const release = () => reservations.forEach((r) => r.release());

    const totalDuration = clips.reduce((a, c) => a + c.segments.reduce((b, s) => b + (Math.min(s.end, sources[c.src].duration || s.end) - s.start), 0), 0);
    const first = sources[clips[0].src];
    const job = {
      id,
      spec: { ...spec, sources, clips, full, clipMode, baseDir, clipNames },
      release,
      procs: new Set(),
      abort: new AbortController(),
      canceled: false,
      state: {
        id,
        url: first.url,
        title: Object.keys(sources).length > 1 ? `${first.title} + ${Object.keys(sources).length - 1} more` : first.title,
        channel: first.channel,
        thumbnail: first.thumbnail,
        status: 'queued',
        stage: 'Queued',
        progress: 0,
        speed: 0,
        eta: null,
        names,
        clipCount: clips.length,
        totalDuration,
        outputs: [],
        error: null,
        createdAt: now(),
        quality: spec.qualityLabel || '',
        // pipeline shown in the Downloads tab
        phase: 'queued',
        phases: [
          'download',
          'process',
          spec.chat ? 'chat' : null,
          spec.enhance && spec.facecamOn ? 'enhance' : null,
          this.store.get().premiere.enabled && !spec.skipPremiere ? 'premiere' : null,
        ].filter(Boolean),
        preset: spec.studio ? spec.studio.name : null,
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
    if (!ACTIVE.includes(job.state.status)) {
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
      job.release();
      this.set(job, { status: 'canceled', stage: 'Canceled' }, true);
    }
  }

  clearFinished() {
    for (const [id, j] of this.jobs) {
      if (!ACTIVE.includes(j.state.status)) {
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
      const premiereOn = !!(this.premiere && this.store.get().premiere.enabled && !job.spec.skipPremiere);
      job.scale = premiereOn ? 0.86 : 0;
      await this.process(job, tmp);
      if (premiereOn) await this.premiereStep(job);
      job.scale = 0;
      job.release();
      this.set(job, { status: 'done', stage: 'Done', phase: 'done', progress: 1, speed: 0, eta: 0, finishedAt: now() }, true);
      this.emit('done', job.state);
    } catch (e) {
      job.release();
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

  /** Resolve formats/streams for every source of the job. */
  async prepareSources(job) {
    const s = job.spec;
    const settings = this.store.get();
    const out = {};
    for (const id of new Set(s.clips.map((c) => c.src))) {
      const src = s.sources[id];
      const info = await probe.fullInfo(this.tools, id, src.url);
      this.checkCancel(job);
      const quals = probe.buildQualities(info);
      const q = quals.find((x) => x.key === src.quality) || quals[0];
      if (!q) throw new Error(`No downloadable video formats for ${src.title}`);
      const fmt = (fid) => info.formats.find((f) => f.format_id === fid);
      const vf = fmt(q.video);
      const af = q.audio ? fmt(q.audio) : null;
      const streams = [{ kind: 'v', f: vf, muxed: !!q.muxed, weight: af ? 0.93 : 1 }];
      if (af) streams.push({ kind: 'a', f: af, weight: 0.07 });
      for (const st of streams) {
        st.headers = { ...(st.f.http_headers || {}) };
        st.hls = probe.isHls(st.f);
        if (st.hls) {
          st.playlist = await hls.loadPlaylist(st.f.url, st.headers, job.abort.signal);
          if (st.playlist.encrypted) st.hls = false;
        }
      }
      out[id] = {
        id,
        src,
        info,
        q,
        streams,
        duration: info.duration || src.duration || 0,
        convert: settings.quality.codec === 'convert' && q.codec !== 'H.264',
      };
    }
    return out;
  }

  /** Plain single-connection download of a whole (small) file. */
  async fetchFile(url, headers, outFile, signal, onBytes) {
    const r = await fetch(url, { headers, signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    let got = 0;
    const body = Readable.fromWeb(r.body);
    body.on('data', (c) => {
      got += c.length;
      onBytes && onBytes(c.length, total ? got / total : 0);
    });
    await pipeline(body, fs.createWriteStream(outFile));
  }

  async process(job, tmp) {
    const s = job.spec;
    const settings = this.store.get();
    this.set(job, { status: 'preparing', stage: 'Preparing', phase: 'download' }, true);
    await this.tools.ensure();
    const srcs = await this.prepareSources(job);
    const pad = s.full ? 0 : Math.max(0, Number(settings.cut.padding) || 0);

    // Flatten segments with padding
    const ranges = [];
    s.clips.forEach((c, ci) => {
      const S = srcs[c.src];
      const clamp = (t) => Math.max(0, S.duration ? Math.min(S.duration, t) : t);
      c.segments.forEach((seg) => ranges.push({ clip: ci, src: c.src, start: clamp(seg.start - pad), end: clamp(seg.end + pad) }));
    });
    const totalLen = ranges.reduce((a, r) => a + (r.end - r.start), 0) || 1;

    // ---- Download ----
    const conns = Math.max(2, settings.download.connections || 16);
    const prog = { fraction: new Map(), bytes: 0, t0: now(), samples: [] };
    const enhance = s.enhance && this.topaz && this.topaz.ffmpeg && s.facecamOn ? s.enhance : null;
    const dlWeight = enhance ? 0.5 : 0.8;
    const procEnd = enhance ? 0.72 : 1;
    const updateDl = () => {
      let total = 0;
      ranges.forEach((r, ri) =>
        srcs[r.src].streams.forEach((st, si) => {
          total += (prog.fraction.get(`${ri}:${si}`) || 0) * st.weight * ((r.end - r.start) / totalLen);
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
      const S = srcs[r.src];
      r.files = {};
      await Promise.all(
        S.streams.map(async (st, si) => {
          const slot = `${ri}:${si}`;
          const out = path.join(tmp, `r${ri}_${st.kind}${st.hls ? (st.playlist.map ? '.mp4' : '.ts') : '.bin'}`);
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
                prog.fraction.set(slot, p.done / p.count);
                updateDl();
              },
            });
            r.files[st.kind] = { file: out, offset: r.start - res.fileStart, raw: true, muxed: st.muxed };
          } else if (S.duration && S.duration <= 900) {
            // Short videos / Twitch clips: grab the whole file, cut locally.
            await this.fetchFile(st.f.url, st.headers, out, job.abort.signal, (n, frac) => {
              prog.bytes += n;
              prog.fraction.set(slot, frac);
              updateDl();
            });
            r.files[st.kind] = { file: out, offset: r.start, raw: false, muxed: st.muxed };
          } else {
            // Fallback: let ffmpeg seek inside the remote file (slower, but works for any http format).
            const len = r.end - r.start;
            const mkv = out.replace(/\.bin$/, '.mkv');
            const map = st.kind === 'a' ? ['-map', '0:a:0'] : st.muxed ? ['-map', '0:v:0', '-map', '0:a:0?'] : ['-map', '0:v:0'];
            await this.ffmpeg(
              [...(Object.keys(st.headers).length ? ['-headers', hdrString(st.headers)] : []), '-ss', String(r.start), '-i', st.f.url, '-t', String(len), ...map, '-c', 'copy', mkv],
              {
                duration: len,
                job,
                onProgress: (p) => {
                  prog.fraction.set(slot, p);
                  updateDl();
                },
              }
            );
            r.files[st.kind] = { file: mkv, offset: 0, raw: false, muxed: st.muxed };
          }
          prog.fraction.set(slot, 1);
          updateDl();
        })
      );
      this.checkCancel(job);
    }

    // ---- Process ----
    this.set(job, { status: 'processing', stage: 'Cutting', phase: 'process', speed: 0, eta: null, progress: dlWeight }, true);
    const enc = await this.detectEncoders();
    const groups = this.buildGroups(job, ranges);
    const fcOn = !!s.facecamOn;
    const cropOn = !!s.cropOn;
    const nSteps = ranges.length + groups.length * (1 + (fcOn ? 1 : 0) + 1);
    let step = 0;
    const stepProgress = (i, n) => (p) => this.set(job, { progress: dlWeight + (procEnd - dlWeight) * ((i + p) / n) });

    // Cut each range to an mp4 part
    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      const S = srcs[r.src];
      const exact = settings.cut.mode === 'exact' || S.convert;
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
      if (exact) args.push(...this.videoEncodeArgs(enc, S.convert ? 16 : 17), '-c:a', 'aac', '-b:a', '192k');
      else args.push('-c', 'copy');
      args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', part);
      const verb = S.convert ? 'Converting' : 'Cutting';
      this.set(job, { stage: ranges.length > 1 ? `${verb} ${ri + 1}/${ranges.length}` : verb });
      await this.ffmpeg(args, { duration: len, job, onProgress: stepProgress(step, nSteps) });
      r.part = part;
      r.meta = await this.media(part);
      for (const f of Object.values(r.files)) fs.rmSync(f.file, { force: true });
      step++;
      this.checkCancel(job);
    }

    // Build outputs per group
    const outputs = [];
    const facecams = [];
    const cropRectOf = (r) => srcs[r.src].src.cropRect || this.centeredCrop(s.cropAspect || 9 / 16, r.meta.width, r.meta.height);
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      fs.mkdirSync(g.dir, { recursive: true });
      const gDur = g.ranges.reduce((acc, r) => acc + ((r.meta && r.meta.duration) || r.end - r.start), 0);
      const label = (what) => (groups.length > 1 ? `${what} ${gi + 1}/${groups.length}` : what);
      const files = [];
      const uniform = new Set(g.ranges.map((r) => r.src)).size === 1 && this.sameFormat(g.ranges);
      const gpOut = naming.uniquePath(path.join(g.dir, `${g.prefix}${settings.output.gameplayName || 'Gameplay'}.mp4`));
      const fcOut = naming.uniquePath(path.join(g.dir, `${g.prefix}${settings.output.facecamName || 'Facecam'}.mp4`));

      // Lossless join of identical parts (one source)
      let joined = null;
      if (uniform) {
        joined = g.ranges[0].part;
        if (g.ranges.length > 1) {
          this.set(job, { stage: label('Merging') });
          const list = path.join(tmp, `concat${gi}.txt`);
          fs.writeFileSync(list, g.ranges.map((r) => `file '${r.part.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
          joined = path.join(tmp, `merged${gi}.mp4`);
          await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', joined], { duration: gDur, job, onProgress: stepProgress(step, nSteps) });
        }
      }
      step++;

      // Facecam (layouts can change over time -> pieces with their own crop)
      if (fcOn) {
        const pieces = this.facecamPieces(g.ranges, srcs);
        if (pieces.length) {
          this.set(job, { stage: label('Facecam') });
          const r0 = pieces[0];
          const sameRect = pieces.every((p) => this.rectEq(p.rect, r0.rect));
          if (uniform && sameRect) {
            const c = this.cropPx(r0.rect, r0.meta.width, r0.meta.height);
            await this.ffmpeg(['-i', joined, '-map', '0:v:0', ...this.fcAudio(settings), '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`, ...this.facecamEncode(settings), '-movflags', '+faststart', fcOut], {
              duration: gDur,
              job,
              onProgress: stepProgress(step, nSteps),
            });
          } else {
            const T = this.targetOf(g.ranges);
            await this.exportPieces(pieces, fcOut, { job, settings, fps: T.fps, onProgress: stepProgress(step, nSteps) });
          }
          files.push(fcOut);
          facecams.push({ file: fcOut, duration: gDur, group: outputs.length });
        }
        step++;
      }

      // Gameplay
      if (cropOn) {
        this.set(job, { stage: label('Cropping') });
        if (uniform) {
          const c = this.cropPx(cropRectOf(g.ranges[0]), g.ranges[0].meta.width, g.ranges[0].meta.height);
          await this.ffmpeg(['-i', joined, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`, ...this.videoEncodeArgs(enc, 16), '-c:a', 'copy', '-movflags', '+faststart', gpOut], {
            duration: gDur,
            job,
            onProgress: stepProgress(step, nSteps),
          });
        } else {
          const r0 = g.ranges[0];
          const c0 = this.cropPx(cropRectOf(r0), r0.meta.width, r0.meta.height);
          await this.joinNormalized(g.ranges, gpOut, {
            enc,
            job,
            duration: gDur,
            onProgress: stepProgress(step, nSteps),
            size: { w: c0.w, h: c0.h },
            fps: this.targetOf(g.ranges).fps,
            crop: (r) => {
              const c = this.cropPx(cropRectOf(r), r.meta.width, r.meta.height);
              return `crop=${c.w}:${c.h}:${c.x}:${c.y}`;
            },
          });
        }
      } else if (uniform) {
        fs.renameSync(joined, gpOut);
      } else {
        this.set(job, { stage: label('Joining') });
        const T = this.targetOf(g.ranges);
        await this.joinNormalized(g.ranges, gpOut, { enc, job, duration: gDur, onProgress: stepProgress(step, nSteps), size: { w: T.w, h: T.h }, fps: T.fps });
      }
      step++;
      files.unshift(gpOut);
      outputs.push({ dir: g.dir, name: g.name, files, prefix: g.prefix || '' });
      this.set(job, { outputs: outputs.map((o) => ({ ...o, files: [...o.files] })) }, true);
    }

    // the clips themselves are done — everything after this only adds files
    this.set(job, { filesReady: true }, true);

    // ---- Chat overlay ----
    if (s.chat && this.chatRenderer) {
      this.set(job, { phase: 'chat' }, true);
      await this.chatStep(job, groups, outputs, srcs, tmp);
    }

    // ---- Topaz Video AI facecam enhancement ----
    if (enhance && facecams.length) {
      const total = facecams.reduce((a, f) => a + f.duration, 0) || 1;
      let doneDur = 0;
      for (let i = 0; i < facecams.length; i++) {
        const f = facecams[i];
        const enhanced = naming.uniquePath(f.file.replace(/\.mp4$/i, ` ${settings.topaz.suffix || 'Enhanced'}.mp4`));
        this.set(job, { stage: facecams.length > 1 ? `Enhancing facecam ${i + 1}/${facecams.length}` : 'Enhancing facecam', phase: 'enhance', eta: null }, true);
        const t0 = now();
        try {
          await this.topazRun(f.file, enhanced, enhance, enc, {
            job,
            duration: f.duration,
            onProgress: (p) => {
              const frac = (doneDur + p * f.duration) / total;
              const elapsed = (now() - t0) / 1000;
              this.set(job, { progress: procEnd + (1 - procEnd) * frac, eta: p > 0.03 ? (elapsed / p) * (1 - p) : null });
            },
          });
          const out = outputs[f.group];
          if (settings.topaz.keepOriginal) out.files.push(enhanced);
          else {
            fs.rmSync(f.file, { force: true });
            fs.renameSync(enhanced, f.file);
          }
          this.set(job, { outputs: outputs.map((o) => ({ ...o, files: [...o.files] })) }, true);
        } catch (e) {
          if (job.canceled) throw e;
          fs.rmSync(enhanced, { force: true });
          this.set(job, { warning: `Topaz: ${e.message}` }, true);
        }
        doneDur += f.duration;
      }
    }
    return outputs;
  }

  /** Build the premiere/ folder (transcript, captions, XML) for every output of a finished job. */
  async premiereStep(job) {
    job.inPremiere = true;
    this.set(job, { phase: 'premiere' }, true);
    const outs = job.state.outputs || [];
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i];
      const suffix = outs.length > 1 ? ` ${i + 1}/${outs.length}` : '';
      try {
        const proj = await this.premiere.build(o.dir, {
          name: o.name,
          prefix: o.prefix || '',
          preset: job.spec.studio || null,
          job,
          reuseTranscript: false,
          onStage: (label, p) => this.set(job, { stage: `${label}${suffix}`, progress: Math.min(0.995, 0.86 + 0.14 * ((i + (p || 0)) / outs.length)), eta: null }),
        });
        o.premiere = { xml: proj.files.xml, srt: proj.files.srt, overlay: proj.files.overlay, words: proj.files.words, dir: path.dirname(proj.files.xml), device: proj.device };
        this.set(job, { outputs: outs.map((x) => ({ ...x })) }, true);
      } catch (e) {
        if (job.canceled) throw e;
        this.set(job, { warning: `Premiere: ${e.message}` }, true);
      }
    }
    job.inPremiere = false;
  }

  rectEq(a, b) {
    return !!a && !!b && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4;
  }

  centeredCrop(aspect, W, H) {
    // largest box of the given pixel aspect, centered
    let w = W;
    let h = W / aspect;
    if (h > H) {
      h = H;
      w = H * aspect;
    }
    return { x: (1 - w / W) / 2, y: (1 - h / H) / 2, w: w / W, h: h / H };
  }

  /**
   * Split every range at facecam layout changes. Each piece knows which part file it lives in, where
   * (seconds inside that file) and which crop to use.
   */
  facecamPieces(ranges, srcs) {
    const pieces = [];
    let fallback = null;
    for (const r of ranges) {
      const keys = (srcs[r.src].src.facecamKeys || []).filter((k) => k && k.rect);
      if (keys.length && !fallback) fallback = keys[0].rect;
    }
    if (!fallback) return pieces;
    for (const r of ranges) {
      const keys = (srcs[r.src].src.facecamKeys || []).filter((k) => k && k.rect).sort((a, b) => a.t - b.t);
      const rectAt = (t) => {
        let rect = keys.length ? keys[0].rect : fallback;
        for (const k of keys) if (k.t <= t + 0.001) rect = k.rect;
        return rect;
      };
      const len = r.end - r.start;
      const fileDur = (r.meta && r.meta.duration) || len;
      const slack = Math.max(0, fileDur - len); // keyframe-aligned lead-in of stream-copied parts
      const cuts = [r.start, ...keys.map((k) => k.t).filter((t) => t > r.start + 0.5 && t < r.end - 0.5), r.end];
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        pieces.push({
          part: r.part,
          meta: r.meta,
          rect: rectAt(a),
          pa: i === 0 ? 0 : a - r.start + slack,
          pb: i === cuts.length - 2 ? fileDur : b - r.start + slack,
        });
      }
    }
    return pieces;
  }

  /** Crop + concat facecam pieces (different layouts / sources) into one file at the first piece's size. */
  async exportPieces(pieces, out, { job, settings, fps, onProgress }) {
    const files = [...new Set(pieces.map((p) => p.part))];
    const withAudio = settings.facecam.includeAudio && pieces.every((p) => p.meta.hasAudio);
    const c0 = this.cropPx(pieces[0].rect, pieces[0].meta.width, pieces[0].meta.height);
    const args = [];
    files.forEach((f) => args.push('-i', f));
    const uses = files.map((f) => pieces.filter((p) => p.part === f).length);
    const chains = [];
    files.forEach((f, i) => {
      if (uses[i] > 1) {
        chains.push(`[${i}:v]split=${uses[i]}${Array.from({ length: uses[i] }, (_, k) => `[s${i}v${k}]`).join('')}`);
        if (withAudio) chains.push(`[${i}:a]asplit=${uses[i]}${Array.from({ length: uses[i] }, (_, k) => `[s${i}a${k}]`).join('')}`);
      }
    });
    const used = files.map(() => 0);
    pieces.forEach((p, k) => {
      const i = files.indexOf(p.part);
      const n = used[i]++;
      const vin = uses[i] > 1 ? `[s${i}v${n}]` : `[${i}:v]`;
      const ain = uses[i] > 1 ? `[s${i}a${n}]` : `[${i}:a]`;
      const c = this.cropPx(p.rect, p.meta.width, p.meta.height);
      chains.push(
        `${vin}trim=start=${p.pa.toFixed(3)}:end=${p.pb.toFixed(3)},setpts=PTS-STARTPTS,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${c0.w}:${c0.h}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[v${k}]`
      );
      if (withAudio) chains.push(`${ain}atrim=start=${p.pa.toFixed(3)}:end=${p.pb.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${k}]`);
    });
    chains.push(`${pieces.map((_, k) => `[v${k}]${withAudio ? `[a${k}]` : ''}`).join('')}concat=n=${pieces.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`);
    args.push('-filter_complex', chains.join(';'), '-map', '[v]');
    if (withAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
    else args.push('-an');
    args.push(...this.facecamEncode(settings), '-movflags', '+faststart', out);
    const duration = pieces.reduce((a, p) => a + (p.pb - p.pa), 0);
    await this.ffmpeg(args, { duration, job, onProgress });
  }

  /** Upscale/enhance with Topaz Video AI's bundled ffmpeg (tvai_up filter). */
  topazRun(input, output, p, enc, { job, duration, onProgress }) {
    const t = this.topaz;
    if (!t || !t.ffmpeg) return Promise.reject(new Error('Topaz Video AI not found'));
    const f = (v) => Number(v || 0).toFixed(2);
    let up = `tvai_up=model=${p.model}:scale=${p.scale || 2}:preblur=${f(p.preblur)}:noise=${f(p.noise)}:details=${f(p.details)}:halo=${f(p.halo)}:blur=${f(p.blur)}:compression=${f(p.compression)}:estimate=${p.auto ? 8 : 0}:blend=${f(p.blend)}`;
    if (p.grain > 0) up += `:grain=${f(p.grain)}:gsize=1`;
    up += ':device=-2:vram=1:instances=1';
    const venc = enc.nvenc
      ? ['-c:v', 'h264_nvenc', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'p7', '-tune', 'hq', '-rc', 'constqp', '-qp', String(p.qp || 16), '-spatial_aq', '1', '-aq-strength', '15', '-b:v', '0']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(p.qp || 16), '-pix_fmt', 'yuv420p'];
    const args = ['-i', input, '-sws_flags', 'spline+accurate_rnd+full_chroma_int', '-filter_complex', `[0:v]${up}[v]`, '-map', '[v]', '-map', '0:a?', '-c:a', 'copy', ...venc, '-movflags', '+faststart', output];
    const env = { ...process.env, TVAI_MODEL_DATA_DIR: t.modelDir, TVAI_MODEL_DIR: t.modelDir };
    return this.ffmpeg(args, { duration, job, onProgress, bin: t.ffmpeg, env });
  }

  sameFormat(ranges) {
    const m0 = ranges[0].meta;
    if (!m0) return false;
    return ranges.every((r) => r.meta && r.meta.width === m0.width && r.meta.height === m0.height && Math.abs(r.meta.fps - m0.fps) < 0.5 && r.meta.vcodec === m0.vcodec && r.meta.hasAudio === m0.hasAudio);
  }

  targetOf(ranges) {
    // Largest resolution and highest frame rate among the parts.
    let best = ranges[0].meta;
    for (const r of ranges) if (r.meta.width * r.meta.height > best.width * best.height) best = r.meta;
    const fps = Math.min(60, Math.max(...ranges.map((r) => r.meta.fps || 30)));
    return { w: best.width - (best.width % 2), h: best.height - (best.height % 2), fps };
  }

  /** Re-encode + concat parts with different sources/sizes into one file. */
  async joinNormalized(ranges, out, { enc, job, duration, onProgress, size, fps, crop, facecam }) {
    const args = [];
    ranges.forEach((r) => args.push('-i', r.part));
    const withAudio = ranges.every((r) => r.meta.hasAudio) && !(facecam && !facecam.facecam.includeAudio);
    const chains = ranges.map((r, i) => {
      const c = crop ? `${crop(r)},` : '';
      const v = `[${i}:v]${c}scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`;
      const a = withAudio ? `;[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]` : '';
      return v + a;
    });
    const ins = ranges.map((_, i) => `[v${i}]${withAudio ? `[a${i}]` : ''}`).join('');
    const filter = `${chains.join(';')};${ins}concat=n=${ranges.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`;
    args.push('-filter_complex', filter, '-map', '[v]');
    if (withAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
    else args.push('-an');
    if (facecam) args.push(...this.facecamEncode(facecam));
    else args.push(...this.videoEncodeArgs(enc, 16));
    args.push('-movflags', '+faststart', out);
    await this.ffmpeg(args, { duration, job, onProgress });
  }

  fcAudio(settings) {
    return settings.facecam.includeAudio ? ['-map', '0:a:0?', '-c:a', 'copy'] : ['-an'];
  }

  facecamEncode(settings) {
    return ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(settings.facecam.crf ?? 10), '-pix_fmt', 'yuv420p'];
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

  crop916Px(rx, W, H) {
    const w = Math.min(W, Math.round((H * 9) / 16 / 2) * 2);
    const x0 = typeof rx === 'number' ? rx : (1 - w / W) / 2;
    return { w, x: Math.max(0, Math.min(W - w, Math.round((x0 * W) / 2) * 2)) };
  }

  buildGroups(job, ranges) {
    const s = job.spec;
    const o = this.store.get().output;
    const flat = o.mode === 'flat';
    const base = s.baseDir;
    const groups = [];
    const mk = (name, rs, prefix) => ({
      name,
      dir: flat ? base : path.join(base, name),
      prefix: flat ? `${name} - ${prefix}` : prefix,
      ranges: rs,
    });
    if (s.clipMode === 'merge') groups.push(mk(s.clipNames[0], ranges, ''));
    else if (s.clipMode === 'separate') s.clips.forEach((c, ci) => groups.push(mk(s.clipNames[ci], ranges.filter((r) => r.clip === ci), '')));
    else s.clips.forEach((c, ci) => groups.push(mk(s.clipNames[0], ranges.filter((r) => r.clip === ci), `Clip ${ci + 1} - `)));
    return groups;
  }
}

module.exports = { Engine };
