// Measures caption timing of a built clip: speech starts found in the audio vs. word starts in words.json.
//   node scripts/dev/caption-timing.cjs "<clip folder>"
// Prints the error (s) of the nearest word start for every phrase start — should be ~0 after align.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT } = require('./common.cjs');
const A = require(path.join(ROOT, 'electron/align.cjs'));

const dir = process.argv[2];
if (!dir) throw new Error('usage: caption-timing.cjs <clip folder>');
const pdir = path.join(dir, 'premiere');
const wordsFile = fs.readdirSync(pdir).find((f) => f.endsWith('.words.json'));
const words = JSON.parse(fs.readFileSync(path.join(pdir, wordsFile), 'utf8')).words;
const ffmpeg = path.join(process.env.APPDATA, 'Vodslice', 'bin', 'ffmpeg.exe');
const wav = path.join(require('node:os').tmpdir(), 'vodslice-timing.wav');
execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', path.join(dir, 'Gameplay.mp4'), '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
const env = A.envelope(A.readPcm(wav));
const isl = A.islands(env, A.threshold(env));
const errs = isl.map((I) => {
  let best = null;
  for (const w of words) if (best == null || Math.abs(w.start - I.start) < Math.abs(best)) best = w.start - I.start;
  return best;
});
console.log('phrase starts', isl.length, 'words', words.length);
console.log('errors (s):', errs.map((e) => e.toFixed(2)).join(' '));
console.log('mean |error|:', (errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length).toFixed(3), 's');
