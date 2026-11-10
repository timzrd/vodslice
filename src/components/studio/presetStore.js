// Layout presets live in settings.studio (persisted in %APPDATA%\Vodslice\settings.json, kept across updates).
import { normalizePreset, builtInPresets } from '../../../electron/layout.mjs';

export function presetsOf(settings) {
  const list = (settings.studio && settings.studio.presets) || [];
  return (list.length ? list : builtInPresets(settings.premiere)).map(normalizePreset);
}

export function activePreset(settings) {
  const list = presetsOf(settings);
  return list.find((p) => p.id === (settings.studio && settings.studio.active)) || list[0];
}

export const savePresets = (list) => window.api.replaceSetting('studio.presets', list);

/** Change the active preset from outside the Studio (export panel, caption editor). */
export function updateActivePreset(settings, fn) {
  const a = activePreset(settings);
  return savePresets(presetsOf(settings).map((p) => (p.id === a.id ? fn(JSON.parse(JSON.stringify(p))) : p)));
}

/** Output folders of finished downloads that the Studio can preview (newest first). */
export function clipSources(jobs, history, settings) {
  const gpName = (settings.output.gameplayName || 'Gameplay').toLowerCase();
  const fcName = (settings.output.facecamName || 'Facecam').toLowerCase();
  const seen = new Set();
  const out = [];
  const add = (j, live) => {
    for (const o of j.outputs || []) {
      if (!o.dir || seen.has(`${o.dir}|${o.prefix || ''}`)) continue;
      const files = o.files || [];
      const base = (f) => f.split(/[\\/]/).pop().toLowerCase().slice((o.prefix || '').length);
      const gameplay = files.find((f) => base(f) === `${gpName}.mp4`);
      if (!gameplay) continue;
      seen.add(`${o.dir}|${o.prefix || ''}`);
      const enhanced = files.find((f) => base(f).startsWith(fcName + ' ') && base(f).endsWith('.mp4'));
      const facecam = enhanced || files.find((f) => base(f) === `${fcName}.mp4`) || null;
      out.push({
        key: `${o.dir}|${o.prefix || ''}`,
        name: o.name,
        title: j.title,
        channel: j.channel,
        thumbnail: j.thumbnail,
        dir: o.dir,
        prefix: o.prefix || '',
        gameplay,
        facecam,
        enhanced: !!enhanced,
        chat: files.find((f) => /chat\.mov$/i.test(f)) || null,
        words: (o.premiere && o.premiere.words) || null,
        xml: (o.premiere && o.premiere.xml) || null,
        live,
      });
    }
  };
  [...jobs].filter((j) => j.status === 'done' || j.filesReady).reverse().forEach((j) => add(j, true));
  (history || []).forEach((h) => add(h, false));
  return out.slice(0, 40);
}
