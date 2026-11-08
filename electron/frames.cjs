// Grab single frames from a remote stream with ffmpeg (used for facecam detection + box editing stills).
const probe = require('./probe.cjs');

function grabOne(tools, url, headers, t, height) {
  return new Promise((resolve) => {
    const hdr = Object.entries(headers || {})
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('');
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...(hdr ? ['-headers', hdr] : []),
      '-ss', String(Math.max(0, t)), '-i', url,
      '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ];
    const p = tools.spawn('ffmpeg', args);
    const chunks = [];
    const timer = setTimeout(() => p.kill(), 30000);
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('close', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      resolve(buf.length ? { t, dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64') } : null);
    });
    p.on('error', () => resolve(null));
  });
}

async function grabFrames(tools, cacheId, times, height = 480) {
  const info = probe.cached(cacheId);
  if (!info) throw new Error('Video info expired — reload the link.');
  const f = probe.frameFormat(info);
  if (!f) throw new Error('No video format for frame grabs');
  const out = new Array(times.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < times.length) {
        const k = i++;
        out[k] = await grabOne(tools, f.url, f.http_headers, times[k], height);
      }
    })
  );
  return out.filter(Boolean);
}

module.exports = { grabFrames };
