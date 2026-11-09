// Topaz Video AI integration: find the install, its bundled ffmpeg (with tvai_* filters) and upscale models.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KEY = 'HKLM\\SOFTWARE\\Topaz Labs LLC\\Topaz Video AI';
let cache = null;
// older upscale models have no "processors" list and generic display names
const LEGACY = { ahq: 'Artemis HQ', amq: 'Artemis MQ', alq: 'Artemis LQ', aaa: 'Artemis Aliased', ghq: 'Gaia HQ', gcg: 'Gaia CG', thd: 'Theia Detail', thf: 'Theia Fidelity' };

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function regValue(out, name) {
  const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi').exec(out);
  return m ? m[1].trim() : null;
}

/** Upscaling models available in the local install (from Topaz's own model definition files). */
function listModels(modelDir) {
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(modelDir, f), 'utf8'));
      const id = f.replace(/\.json$/, '');
      const legacy = !Array.isArray(j.processors) && LEGACY[id.split('-')[0]];
      if (!j || !j.enabled || !j.backends || !(legacy || (Array.isArray(j.processors) && j.processors.includes('up')))) continue;
      const scales = new Set();
      for (const b of Object.values(j.backends)) for (const s of Object.keys((b && b.scales) || {})) scales.add(Number(s));
      out.push({
        id,
        name: `${legacy || j.displayName || j.shortName || id} ${j.version ? `v${j.version}` : ''}`.trim(),
        family: legacy || j.displayName || id,
        scales: [...scales].filter((s) => s > 0).sort((a, b) => a - b),
        params: (j.parameters || []).map((p) => p.name),
        face: /^iris/i.test(id),
      });
    } catch {}
  }
  // newest version of each family first, faces (Iris) on top
  return out.sort((a, b) => (b.face - a.face) || a.family.localeCompare(b.family) || b.id.localeCompare(a.id, undefined, { numeric: true }));
}

async function detect(force = false) {
  if (cache && !force) return cache;
  const out = await reg(['query', KEY]);
  let install = regValue(out, 'InstallDir') || 'C:\\Program Files\\Topaz Labs LLC\\Topaz Video AI\\';
  let modelDir = regValue(out, 'ModelDir') || 'C:\\ProgramData\\Topaz Labs LLC\\Topaz Video AI\\models\\';
  const ffmpeg = path.join(install, 'ffmpeg.exe');
  const found = fs.existsSync(ffmpeg) && fs.existsSync(modelDir);
  let version = null;
  if (found) {
    // the installer registers under HKLM or HKCU; DisplayName contains "Topaz Video"
    for (const hive of ['HKLM', 'HKCU']) {
      const u = await reg(['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, '/s', '/f', 'Topaz Video', '/d']);
      const block = u.split(/\r?\n\r?\n/).find((b) => /DisplayName\s+REG_SZ\s+Topaz Video/i.test(b));
      if (block) version = version || regValue(block, 'DisplayVersion');
    }
  }
  cache = { found, ffmpeg: found ? ffmpeg : null, modelDir: found ? modelDir : null, version, models: found ? listModels(modelDir) : [] };
  return cache;
}

module.exports = { detect };
