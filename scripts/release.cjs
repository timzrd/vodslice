// Build + publish a new version so installed apps can update themselves.
//   npm run release              -> bump patch (1.1.0 -> 1.1.1)
//   npm run release minor        -> 1.2.0
//   npm run release 2.0.0 "notes"
// Needs: GitHub CLI (gh) logged in, a clean git tree on main. Installers are attached to a GitHub release of
// timzrd/vodslice; installed apps read latest.yml from the newest release (electron-updater).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPO = 'timzrd/vodslice';
// electron-builder's NSIS step breaks on very long paths, so the build runs from a short copy.
const BUILD = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'vsb2');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
const q = (s) => JSON.stringify(s);

const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8').replace(/^﻿/, ''));
const arg = process.argv[2] || 'patch';
const notes = process.argv[3] || '';
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : arg === 'major' ? `${ma + 1}.0.0` : arg === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
pkg.version = next;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n▶ Vodslice ${next}\n`);

run('npx', ['vite', 'build'], { cwd: ROOT });

fs.mkdirSync(BUILD, { recursive: true });
try {
  run('robocopy', [ROOT, BUILD, '/MIR', '/XD', path.join(ROOT, 'release'), path.join(ROOT, '.git'), '.vodslice-tmp', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
} catch (e) {
  if (e.status >= 8) throw e; // robocopy: < 8 = success
}
fs.rmSync(path.join(BUILD, 'release'), { recursive: true, force: true });
try {
  run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], { cwd: BUILD });
} catch {
  // first run on a machine sometimes fails while electron-builder downloads its tools — once more
  run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], { cwd: BUILD });
}

const out = path.join(BUILD, 'release');
const exe = `Vodslice-Setup-${next}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(out, f));
for (const f of files) if (!fs.existsSync(f)) throw new Error(`missing build output ${f}`);
fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
fs.copyFileSync(files[0], path.join(ROOT, 'release', exe));

// version bump goes into git so the tag matches the code
run('git', ['add', 'package.json', 'package-lock.json'], { cwd: ROOT });
try {
  run('git', ['commit', '-m', q(`Release v${next}`)], { cwd: ROOT });
} catch {}
run('git', ['push'], { cwd: ROOT });
run('gh', ['release', 'create', `v${next}`, '--repo', REPO, '--target', 'main', '--title', q(`Vodslice ${next}`), '--notes', q(notes || `Vodslice ${next}`), ...files.map(q)]);
console.log(`\n✓ Published v${next} — running apps will offer the update.\n`);
