// YouTube / Twitch login for yt-dlp: copy the user's own login cookies from their browser once into
// %APPDATA%\Vodslice\cookies.txt (only youtube.com / twitch.tv cookies are kept). Chromium browsers lock their
// cookie database while running, so the browser has to be closed for the moment of the import.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { run } = require('./tools.cjs');

const EXE = { brave: 'brave.exe', chrome: 'chrome.exe', edge: 'msedge.exe', opera: 'opera.exe', vivaldi: 'vivaldi.exe', chromium: 'chromium.exe' };
const KEEP = /(^|\.)(youtube\.com|twitch\.tv)$/i;
const LOGIN_NAMES = /^(SAPISID|__Secure-3PAPISID|__Secure-1PSID|__Secure-3PSID|LOGIN_INFO|auth-token)$/;

/** Is the browser (or its background process) running? Firefox doesn't lock its database. */
function browserRunning(browser) {
  const exe = EXE[browser];
  if (!exe) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => resolve(!err && String(out).toLowerCase().includes(exe)));
  });
}

/** Keep only YouTube / Twitch lines of a Netscape cookies.txt; returns {text, count, login}. */
function filterCookies(text) {
  const keep = [];
  let login = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const cols = line.split('\t');
    if (cols.length < 7) continue;
    const domain = cols[0].replace(/^#HttpOnly_/, '');
    if (!KEEP.test(domain.replace(/^\./, ''))) continue;
    keep.push(line);
    if (LOGIN_NAMES.test(cols[5])) login = true;
  }
  return { text: `# Netscape HTTP Cookie File\n# Only YouTube / Twitch cookies, imported by Vodslice\n${keep.join('\n')}\n`, count: keep.length, login };
}

/**
 * One-time import. Codes: OK | RUNNING (close the browser) | NO_LOGIN | ENCRYPTED (browser blocks other apps,
 * use cookies.txt) | NOT_FOUND | ERROR.
 */
async function importLogin(tools, userData, browser) {
  if (await browserRunning(browser)) return { ok: false, code: 'RUNNING' };
  const tmp = path.join(userData, `cookies-import-${Date.now()}.txt`);
  try {
    // file:// is disabled in yt-dlp, so nothing is downloaded: it only reads the browser and writes the jar on exit
    const r = await run(tools.paths.ytdlp, ['--ignore-config', '--no-warnings', '--cookies-from-browser', browser, '--cookies', tmp, '--skip-download', 'file:///vodslice-cookie-import'], { timeout: 90000, env: tools.env() });
    const err = `${r.stderr}\n${r.stdout}`;
    if (!fs.existsSync(tmp)) {
      if (/could not copy|database is locked|permission denied/i.test(err)) return { ok: false, code: 'RUNNING' };
      if (/decrypt|dpapi|app.?bound|v20/i.test(err)) return { ok: false, code: 'ENCRYPTED', error: lastLine(err) };
      if (/could not find|not installed|no such file|unsupported browser/i.test(err)) return { ok: false, code: 'NOT_FOUND', error: lastLine(err) };
      return { ok: false, code: 'ERROR', error: lastLine(err) };
    }
    const f = filterCookies(fs.readFileSync(tmp, 'utf8'));
    if (/decrypt|dpapi|app.?bound/i.test(err) && !f.login) return { ok: false, code: 'ENCRYPTED', error: lastLine(err) };
    if (!f.login) return { ok: false, code: 'NO_LOGIN', count: f.count };
    const out = path.join(userData, 'cookies.txt');
    fs.writeFileSync(out, f.text);
    return { ok: true, code: 'OK', file: out, count: f.count };
  } finally {
    fs.rmSync(tmp, { force: true }); // the raw export holds every site's cookies
  }
}

/** A cookies.txt the user exported: keep a filtered copy. */
function useCookiesFile(userData, file) {
  const f = filterCookies(fs.readFileSync(file, 'utf8'));
  if (!f.count) return { ok: false, code: 'EMPTY' };
  const out = path.join(userData, 'cookies.txt');
  fs.writeFileSync(out, f.text);
  return { ok: true, code: f.login ? 'OK' : 'NO_LOGIN', file: out, count: f.count };
}

const lastLine = (s) =>
  String(s)
    .split(/\r?\n/)
    .filter((l) => /ERROR|error/.test(l))
    .pop()
    ?.replace(/^ERROR:\s*/, '')
    .slice(0, 300) || '';

module.exports = { importLogin, browserRunning, filterCookies, useCookiesFile };
