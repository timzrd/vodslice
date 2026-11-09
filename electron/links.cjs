// Classifies what the user typed into the top field: a video/clip link, a channel link, or a name to search.

/**
 * @returns {{kind:'video', url} | {kind:'channel', site:'youtube'|'twitch', ref, url} | {kind:'search', q} | {kind:'none'}}
 *   YouTube ref = '@handle' | 'channel/UC…' | 'c/name' | 'user/name'; Twitch ref = login.
 */
function parseInput(text) {
  const raw = String(text || '').trim();
  if (!raw) return { kind: 'none' };
  const m = /https?:\/\/[^\s"'<>]+/i.exec(raw);
  let urlText = m ? m[0] : null;
  if (!urlText && /^(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv)\//i.test(raw)) urlText = `https://${raw}`;
  if (!urlText) {
    if (/^@[\w.-]{2,}$/.test(raw)) return { kind: 'channel', site: 'youtube', ref: raw, url: `https://www.youtube.com/${raw}` };
    return { kind: 'search', q: raw };
  }
  let u;
  try {
    u = new URL(urlText);
  } catch {
    return { kind: 'search', q: raw };
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return { kind: 'video', url: urlText };
  if (host === 'youtube.com') {
    if (u.searchParams.get('v') || ['watch', 'live', 'shorts', 'embed', 'v'].includes(parts[0])) {
      if (parts[0] === 'live' && !parts[1]) return { kind: 'none' };
      return { kind: 'video', url: urlText };
    }
    if (parts[0] && parts[0].startsWith('@')) return channel('youtube', decodeURIComponent(parts[0]));
    if (['channel', 'c', 'user'].includes(parts[0]) && parts[1]) return channel('youtube', `${parts[0]}/${parts[1]}`);
    if (parts[0] === 'playlist') return { kind: 'video', url: urlText };
    return { kind: 'none' };
  }
  if (host === 'clips.twitch.tv') return { kind: 'video', url: urlText };
  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' || parts.includes('clip') || parts[1] === 'v') return { kind: 'video', url: urlText };
    const reserved = ['directory', 'settings', 'subscriptions', 'inventory', 'wallet', 'search', 'downloads', 'p', 'jobs', 'turbo', 'prime'];
    if (parts[0] && !reserved.includes(parts[0].toLowerCase()) && /^\w{2,25}$/.test(parts[0])) return channel('twitch', parts[0].toLowerCase());
    return { kind: 'none' };
  }
  return { kind: 'video', url: urlText };
}

function channel(site, ref) {
  const url = site === 'youtube' ? `https://www.youtube.com/${ref}` : `https://www.twitch.tv/${ref}`;
  return { kind: 'channel', site, ref, url };
}

module.exports = { parseInput };
