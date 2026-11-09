// Saved editing projects: %APPDATA%\Vodslice\projects\<id>.json (sources, facecam boxes, clips, playhead).
const fs = require('node:fs');
const path = require('node:path');

class Projects {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new Error('Bad project id');
    return path.join(this.dir, `${id}.json`);
  }
  get(id) {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
    } catch {
      return null;
    }
  }
  save(p) {
    if (!p || !p.id) throw new Error('Project without id');
    const now = Date.now();
    const out = { ...p, created: p.created || now, updated: now };
    const tmp = this.file(p.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, this.file(p.id));
    return summary(out);
  }
  remove(id) {
    fs.rmSync(this.file(id), { force: true });
    return true;
  }
  rename(id, name) {
    const p = this.get(id);
    if (!p) return null;
    p.name = String(name || '').slice(0, 120);
    return this.save(p);
  }
  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(summary(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))));
      } catch {}
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
}

/** What the home screen needs: thumbnail, facecam box and clip marks of the main source. */
function summary(p) {
  const srcs = Object.values(p.sources || {});
  const main = (p.activeSrc && p.sources && p.sources[p.activeSrc]) || srcs[0] || {};
  const clips = p.clips || [];
  const segs = clips.flatMap((c) => c.segments.map((s) => ({ ...s, src: c.src })));
  const st = (p.srcState && p.srcState[main.cacheId]) || {};
  const D = main.duration || 1;
  return {
    id: p.id,
    name: p.name || main.title || 'Untitled project',
    created: p.created,
    updated: p.updated,
    thumbnail: main.thumbnail || null,
    channel: main.channel || '',
    site: main.site || '',
    sources: srcs.length,
    clips: clips.length,
    clipsDuration: segs.reduce((a, s) => a + Math.max(0, s.end - s.start), 0),
    duration: main.duration || 0,
    facecam: st.fcKeys && st.fcKeys[0] ? st.fcKeys[0].rect : null,
    marks: segs.filter((s) => s.src === main.cacheId).map((s) => ({ s: s.start / D, e: s.end / D, c: s.color })),
  };
}

module.exports = { Projects, summary };
