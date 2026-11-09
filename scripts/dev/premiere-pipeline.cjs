// Full Premiere pipeline on a real clip: download -> whisper -> align -> captions -> overlay -> FCP XML.
//   node scripts/dev/premiere-pipeline.cjs <twitch-clip-or-short-url>
// Then import .devdata/out/<Channel N>/premiere/<name>.xml in Premiere (Ctrl+I) to check the result.
const path = require('node:path');
const { setup, ROOT } = require('./common.cjs');
const { Engine } = require(path.join(ROOT, 'electron/engine.cjs'));
const { Whisper } = require(path.join(ROOT, 'electron/whisper.cjs'));
const { PremiereExporter } = require(path.join(ROOT, 'electron/premiereExport.cjs'));
const probe = require(path.join(ROOT, 'electron/probe.cjs'));

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: premiere-pipeline.cjs <url>');
  const { store, tools } = setup();
  await tools.ensure();
  const whisper = new Whisper(tools);
  const exporter = new PremiereExporter({ tools, store, whisper });
  const inf = await probe.probe(tools, url, store.get().quality);
  console.log('[clip]', inf.title, inf.channel, inf.duration + 's');
  // facecam box at the top-area ratio of 1440x1920 @ 1/3 (= 2.25)
  const fw = 0.3;
  const fh = (fw * (inf.width || 1920)) / 2.25 / (inf.height || 1080);
  const engine = new Engine({ tools, store });
  const done = new Promise((res) => engine.on('done', res) && engine.on('failed', res));
  engine.enqueue({
    sources: { [inf.cacheId]: { url: inf.url, title: inf.title, channel: inf.channel, channelKey: inf.channelKey, duration: inf.duration, quality: inf.defaultQuality, facecamKeys: [{ t: 0, rect: { x: 0.68, y: 0.05, w: fw, h: fh } }] } },
    clips: [],
    facecamOn: true,
  });
  const job = await done;
  if (job.status !== 'done') throw new Error(job.error || job.status);
  const o = job.outputs[0];
  const t0 = Date.now();
  const proj = await exporter.build(o.dir, { name: o.name, onStage: (l, p) => process.stdout.write(`\r[premiere] ${l} ${Math.round((p || 0) * 100)}%      `) });
  console.log(`\n[done] ${((Date.now() - t0) / 1000).toFixed(1)}s on ${proj.device}`);
  console.log(JSON.stringify(proj.files, null, 1));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
