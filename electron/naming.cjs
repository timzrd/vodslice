// Output naming: "<Channel> <N>" folders/files with auto (scan) or manual counters.
const fs = require('node:fs');
const path = require('node:path');

const reserved = new Map(); // `${baseDir}|${prefixKey}` -> Set(numbers) reserved by queued jobs

function sanitize(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80) || 'Video';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function channelName(settings, channelKey, fallback) {
  return sanitize((settings.output.aliases || {})[channelKey] || fallback);
}

function render(template, { channel, n, title }) {
  return sanitize(
    (template || '{channel} {n}')
      .replace(/\{channel\}/g, channel)
      .replace(/\{n\}/g, String(n))
      .replace(/\{date\}/g, today())
      .replace(/\{title\}/g, sanitize(title || '').slice(0, 40))
  );
}

function matcher(template, channel, title) {
  const parts = (template || '{channel} {n}').split('{n}');
  const fill = (s) =>
    escapeRe(s)
      .replace(/\\\{channel\\\}/g, escapeRe(channel))
      .replace(/\\\{date\\\}/g, '\\d{4}-\\d{2}-\\d{2}')
      .replace(/\\\{title\\\}/g, '.*?');
  if (parts.length < 2) return null;
  return new RegExp('^' + fill(parts[0]) + '(\\d+)', 'i');
}

function scanMax(baseDir, re, mode) {
  let max = 0;
  if (!re || !baseDir || !fs.existsSync(baseDir)) return 0;
  for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (mode === 'folders' && !e.isDirectory()) continue;
    const m = re.exec(e.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Peek (no reservation) at the next number/name for a channel. */
function peek(settings, { channelKey, channel, title, baseDir }) {
  const o = settings.output;
  const ch = channelName(settings, channelKey, channel);
  const base = baseDir || o.baseDir;
  let next;
  if (o.counterMode === 'manual') next = Number(o.counters[channelKey]) || 1;
  else {
    const re = matcher(o.template, ch, title);
    next = scanMax(base, re, o.mode) + 1;
  }
  const key = `${base}|${o.template}|${ch}`;
  const r = reserved.get(key);
  if (r) while (r.has(next)) next++;
  return { channel: ch, next, name: render(o.template, { channel: ch, n: next, title }) };
}

/**
 * Reserve `count` consecutive numbers. Returns names + a release fn.
 * startNumber overrides the automatic number (and becomes the new manual counter base).
 */
function reserve(store, { channelKey, channel, title, count, startNumber, baseDir }) {
  const settings = store.get();
  const o = settings.output;
  const p = peek(settings, { channelKey, channel, title, baseDir });
  const first = startNumber && startNumber > 0 ? Math.floor(startNumber) : p.next;
  const nums = Array.from({ length: count }, (_, i) => first + i);
  const key = `${baseDir || o.baseDir}|${o.template}|${p.channel}`;
  const set = reserved.get(key) || new Set();
  nums.forEach((n) => set.add(n));
  reserved.set(key, set);
  if (o.counterMode === 'manual') {
    store.patch({ output: { counters: { ...o.counters, [channelKey]: first + count } } });
  }
  return {
    channel: p.channel,
    numbers: nums,
    names: nums.map((n) => render(o.template, { channel: p.channel, n, title })),
    release: () => nums.forEach((n) => set.delete(n)),
  };
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length || undefined);
  for (let i = 2; i < 999; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

module.exports = { peek, reserve, sanitize, uniquePath, render };
