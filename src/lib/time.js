export function fmt(sec, { forceHours = false } = {}) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h || forceHours ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtShort(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
}

/** Parse "1:31:20", "91:20", "1h31m20s", "5480" -> seconds (or null). */
export function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  const hms = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(s);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
  const parts = s.split(/[:.]/).map((p) => p.trim());
  if (parts.every((p) => /^\d+$/.test(p)) && parts.length <= 3) {
    const n = parts.map(Number);
    if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
    if (n.length === 2) return n[0] * 60 + n[1];
  }
  return null;
}

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

export function fmtEta(s) {
  if (s == null || !isFinite(s)) return '';
  s = Math.round(s);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s left`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left`;
}

export const SUPPORTED = /(youtube\.com|youtu\.be|twitch\.tv|kick\.com)\//i;
export function extractUrl(text) {
  if (!text) return null;
  const m = /https?:\/\/[^\s"'<>]+/i.exec(text);
  return m && SUPPORTED.test(m[0]) ? m[0] : m ? m[0] : null;
}
