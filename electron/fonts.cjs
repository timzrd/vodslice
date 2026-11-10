// Installed Windows fonts for the caption font picker: reads family / weight / italic straight from the font files
// (name, OS/2 and fvar tables) — system fonts plus fonts installed only for the current user.
const fs = require('node:fs');
const path = require('node:path');

const DIRS = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')];

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n < len ? b.subarray(0, n) : b;
}

function decodeName(buf, platform) {
  if (platform === 3 || platform === 0) {
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
    return s;
  }
  return buf.toString('latin1');
}

/** One font face at `offset` (0, or a TTC sub-font offset). */
function readFace(fd, offset) {
  const head = readAt(fd, offset, 12);
  if (head.length < 12) return null;
  const numTables = head.readUInt16BE(4);
  if (!numTables || numTables > 100) return null;
  const dir = readAt(fd, offset + 12, numTables * 16);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const tag = dir.toString('latin1', i * 16, i * 16 + 4);
    tables[tag] = { off: dir.readUInt32BE(i * 16 + 8), len: dir.readUInt32BE(i * 16 + 12) };
  }
  if (!tables.name) return null;
  const nt = readAt(fd, tables.name.off, Math.min(tables.name.len, 65536));
  const count = nt.readUInt16BE(2);
  const strOff = nt.readUInt16BE(4);
  const names = {};
  const rank = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > nt.length) break;
    const platform = nt.readUInt16BE(r);
    const lang = nt.readUInt16BE(r + 4);
    const id = nt.readUInt16BE(r + 6);
    const len = nt.readUInt16BE(r + 8);
    const off = nt.readUInt16BE(r + 10);
    if (![1, 2, 4, 16, 17].includes(id)) continue;
    // prefer Windows English, then any Windows, then Mac
    const score = platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 0 ? 1.5 : platform === 1 && lang === 0 ? 1 : 0;
    if (!score || (rank[id] || 0) >= score) continue;
    const s = strOff + off;
    if (s + len > nt.length) continue;
    names[id] = decodeName(nt.subarray(s, s + len), platform).replace(/\0/g, '').trim();
    rank[id] = score;
  }
  let weight = 400;
  let italic = /italic|oblique/i.test(names[17] || names[2] || '');
  if (tables['OS/2']) {
    const os2 = readAt(fd, tables['OS/2'].off, 64);
    if (os2.length >= 64) {
      weight = os2.readUInt16BE(4) || 400;
      italic = !!(os2.readUInt16BE(62) & 1) || italic;
    }
  }
  let range = null;
  if (tables.fvar) {
    const fv = readAt(fd, tables.fvar.off, Math.min(tables.fvar.len, 4096));
    const axesOff = fv.readUInt16BE(4);
    const axisCount = fv.readUInt16BE(8);
    const axisSize = fv.readUInt16BE(10);
    for (let i = 0; i < axisCount; i++) {
      const a = axesOff + i * axisSize;
      if (a + 20 > fv.length) break;
      if (fv.toString('latin1', a, a + 4) === 'wght') range = [fv.readInt32BE(a + 4) / 65536, fv.readInt32BE(a + 12) / 65536];
    }
  }
  if (weight < 100) weight *= 100; // a few old fonts store 1..9
  return { family: names[16] || names[1], legacy: names[1], sub: names[17] || names[2] || '', full: names[4] || '', weight: Math.min(1000, weight), italic, range };
}

function readFont(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const tag = readAt(fd, 0, 12);
    if (tag.length < 12) return [];
    if (tag.toString('latin1', 0, 4) === 'ttcf') {
      const n = Math.min(32, tag.readUInt32BE(8));
      const offs = readAt(fd, 12, n * 4);
      const out = [];
      for (let i = 0; i < n; i++) {
        const f = readFace(fd, offs.readUInt32BE(i * 4));
        if (f) out.push(f);
      }
      return out;
    }
    const f = readFace(fd, 0);
    return f ? [f] : [];
  } catch {
    return [];
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

let cache = null;

/** [{family, weights:[...], italic, user}] sorted by name. Weights of variable fonts are expanded to 100 steps. */
function listFonts() {
  if (cache) return cache;
  const fams = new Map();
  for (const dir of DIRS) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /\.(ttf|otf|ttc)$/i.test(f));
    } catch {
      continue;
    }
    const user = dir !== DIRS[0];
    for (const f of files) {
      for (const face of readFont(path.join(dir, f))) {
        const name = face.family;
        if (!name || name.startsWith('@') || name.length > 60) continue;
        let e = fams.get(name);
        if (!e) fams.set(name, (e = { family: name, weights: new Set(), italic: false, user }));
        if (face.range) for (let w = Math.ceil(face.range[0] / 100) * 100; w <= face.range[1]; w += 100) e.weights.add(w);
        else e.weights.add(Math.round(face.weight / 100) * 100 || 400);
        if (face.italic) e.italic = true;
        // a legacy family like "Arial Black" stays reachable under its own name too
        if (face.legacy && face.legacy !== name && !fams.has(face.legacy) && /black|heavy|bold|extra|semi|light|thin|medium|condensed|narrow/i.test(face.legacy))
          fams.set(face.legacy, { family: face.legacy, weights: new Set([Math.round(face.weight / 100) * 100 || 400]), italic: false, user, legacy: true });
      }
    }
  }
  cache = [...fams.values()]
    .map((e) => ({ family: e.family, weights: [...e.weights].sort((a, b) => a - b), italic: e.italic, user: e.user, legacy: !!e.legacy }))
    .sort((a, b) => a.family.localeCompare(b.family));
  return cache;
}

module.exports = { listFonts, readFont };
