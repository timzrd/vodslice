// Download a range of a VOD through the real engine, no Electron needed.
//   node scripts/dev/headless-engine.cjs <url> [startSec] [endSec]
// Output: .devdata/out/<Channel N>/Gameplay.mp4 (+ Facecam.mp4 with a sample box)
const path = require('node:path');
const { setup, ROOT } = require('./common.cjs');
const { Engine } = require(path.join(ROOT, 'electron/engine.cjs'));
const probe = require(path.join(ROOT, 'electron/probe.cjs'));

(async () => {
  const [, , url, s = '60', e = '90'] = process.argv;
  if (!url) throw new Error('usage: headless-engine.cjs <url> [start] [end]');
  const { store, tools } = setup();
  await tools.ensure((p) => p.progress === 1 && console.log('[tools]', p.label));
  const inf = await probe.probe(tools, url, store.get().quality);
  console.log('[info]', inf.title, '|', inf.channel, '|', inf.duration, 's |', inf.defaultQuality);
  const engine = new Engine({ tools, store });
  let last = '';
  engine.on('job', (j) => {
    const k = `${j.status} ${j.stage}`;
    if (k !== last) console.log('[job]', k, Math.round(j.progress * 100) + '%');
    last = k;
  });
  const done = new Promise((res) => engine.on('done', res) && engine.on('failed', res));
  const t0 = Date.now();
  engine.enqueue({
    sources: {
      [inf.cacheId]: { url: inf.url, title: inf.title, channel: inf.channel, channelKey: inf.channelKey, duration: inf.duration, thumbnail: inf.thumbnail, quality: inf.defaultQuality, facecamKeys: [{ t: 0, rect: { x: 0.7, y: 0.05, w: 0.28, h: 0.28 } }] },
    },
    clips: [{ src: inf.cacheId, segments: [{ start: Number(s), end: Number(e) }] }],
    facecamOn: true,
  });
  const job = await done;
  console.log('[result]', job.status, job.error || '', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log(JSON.stringify(job.outputs, null, 1));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
