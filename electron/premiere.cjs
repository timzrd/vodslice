// Premiere Pro export: FCP7 XML (xmeml v4) that opens as a ready vertical sequence.
//   V1 gameplay (cover, bottom), V2 facecam (top, no audio), V3 caption overlay (alpha), A1/A2 gameplay audio,
//   plus empty SFX / music tracks. Sources are referenced, never re-encoded.
const fs = require('node:fs');
const path = require('node:path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** file://localhost/C:/Some%20Folder/%C3%BC.mp4 */
function pathUrl(p) {
  const parts = path.resolve(p).split(/[\\/]+/);
  const drive = /^[a-z]:$/i.test(parts[0]) ? parts.shift() : '';
  return `file://localhost/${drive ? drive + '/' : ''}${parts.map((x) => encodeURIComponent(x)).join('/')}`;
}

/** 59.94 -> {timebase: 60, ntsc: true} */
function rateOf(fps) {
  const tb = Math.round(fps);
  const ntsc = Math.abs(fps - tb) > 0.01 && Math.abs(fps - (tb * 1000) / 1001) < 0.02;
  return { timebase: tb, ntsc, fps: ntsc ? (tb * 1000) / 1001 : tb };
}
const rateXml = (r) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;

/**
 * Motion math, calibrated in Premiere Pro 2026: Position = sequence center + center × SOURCE size
 * (e.g. vert -0.3333 on a 1080p clip in a 1440×1920 sequence -> y = 960 - 360 = 600).
 * Scale is a percentage of the source size.
 */
function motion(seqW, seqH, srcW, srcH, scale, posX, posY, cal) {
  const kx = (cal && cal.kx) || 1;
  const ky = (cal && cal.ky) || 1;
  return { scale: scale * 100, horiz: ((posX - seqW / 2) / srcW) * kx, vert: ((posY - seqH / 2) / srcH) * ky };
}

function motionFilter(m) {
  return `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>
<parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${m.scale.toFixed(3)}</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>rotation</parameterid><name>Rotation</name><valuemin>-8640</valuemin><valuemax>8640</valuemax><value>0</value></parameter>
<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${m.horiz.toFixed(6)}</horiz><vert>${m.vert.toFixed(6)}</vert></value></parameter>
<parameter authoringApp="PremierePro"><parameterid>centerOffset</parameterid><name>Anchor Point</name><value><horiz>0</horiz><vert>0</vert></value></parameter>
</effect></filter>`;
}

/** Crop in percent of the clip (only needed when a source doesn't match its target area's aspect). */
function cropFilter(c) {
  const p = (id, v) => `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${id}</name><valuemin>0</valuemin><valuemax>100</valuemax><value>${v.toFixed(3)}</value></parameter>`;
  return `<filter><effect><name>Crop</name><effectid>crop</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>
${p('left', c.left)}${p('right', c.right)}${p('top', c.top)}${p('bottom', c.bottom)}
</effect></filter>`;
}

function fileXml(id, f, rate, frames, defined) {
  if (defined.has(id)) return `<file id="${id}"/>`;
  defined.add(id);
  const audio = f.hasAudio
    ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${f.sampleRate || 48000}</samplerate></samplecharacteristics><channelcount>${f.channels || 2}</channelcount></audio>`
    : '';
  return `<file id="${id}"><name>${esc(path.basename(f.path))}</name><pathurl>${esc(pathUrl(f.path))}</pathurl>${rateXml(rate)}<duration>${frames}</duration>
<timecode>${rateXml(rate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media><video><samplecharacteristics>${rateXml(rate)}<width>${f.width}</width><height>${f.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>${audio}</media></file>`;
}

/**
 * @param o.name sequence name
 * @param o.width/height sequence size, o.split = facecam share of the height (0..1)
 * @param o.gameplay {path,width,height,fps,duration,hasAudio,channels,sampleRate}  (full frame source)
 * @param o.gameplayRect normalized visible window inside the gameplay (aspect = bottom area) or null = centered
 * @param o.facecam {path,width,height} pre-cropped facecam file (optional)
 * @param o.overlay {path,width,height} caption overlay with alpha (optional)
 */
function buildXml(o) {
  const W = o.width;
  const H = o.height;
  const topH = Math.round(H * o.split);
  const botH = H - topH;
  const g = o.gameplay;
  const rate = rateOf(g.fps);
  const frames = Math.max(1, Math.round(g.duration * rate.fps));
  const defined = new Set();
  const clips = [];
  let cid = 0;
  const nextId = () => `clipitem-${++cid}`;

  // ---- V1 gameplay: cover the bottom area, chosen window centered in it ----
  const gr = o.gameplayRect || null;
  let gs;
  let gcx;
  let gcy;
  if (gr) {
    gs = Math.max(W / (gr.w * g.width), botH / (gr.h * g.height));
    gcx = (gr.x + gr.w / 2) * g.width;
    gcy = (gr.y + gr.h / 2) * g.height;
  } else {
    gs = Math.max(W / g.width, botH / g.height);
    gcx = g.width / 2;
    gcy = g.height / 2;
  }
  // keep the scaled frame inside the bottom area horizontally/vertically (no empty edges)
  const sw = g.width * gs;
  const sh = g.height * gs;
  let px = W / 2 - gs * (gcx - g.width / 2);
  let py = topH + botH / 2 - gs * (gcy - g.height / 2);
  px = Math.min(sw / 2, Math.max(W - sw / 2, px));
  py = Math.min(topH + sh / 2, Math.max(H - sh / 2, py));
  const gm = motion(W, H, g.width, g.height, gs, px, py, o.calibration);
  // crop away what would show above the split line (the facecam usually covers it anyway)
  const overTop = Math.max(0, topH - (py - sh / 2));
  const gCrop = overTop > 1 && !o.facecam ? cropFilter({ left: 0, right: 0, top: (overTop / sh) * 100, bottom: 0 }) : '';
  const v1 = nextId();
  const a1 = nextId();
  const a2 = nextId();
  const links = (self) =>
    [
      [v1, 'video', 1],
      [a1, 'audio', 1],
      [a2, 'audio', 2],
    ]
      .filter(() => g.hasAudio)
      .map(([id, mt, ti]) => `<link><linkclipref>${id}</linkclipref><mediatype>${mt}</mediatype><trackindex>${ti}</trackindex><clipindex>1</clipindex></link>`)
      .join('');
  const clipHead = (id, name) =>
    `<clipitem id="${id}"><name>${esc(name)}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rateXml(rate)}<start>0</start><end>${frames}</end><in>0</in><out>${frames}</out>`;
  const v1Xml = `${clipHead(v1, path.basename(g.path))}${fileXml('file-gameplay', g, rate, frames, defined)}${motionFilter(gm)}${gCrop}${links(v1)}</clipitem>`;

  // ---- V2 facecam: fill the top area ----
  let v2Xml = '';
  if (o.facecam) {
    const f = o.facecam;
    const fs_ = Math.max(W / f.width, topH / f.height);
    const fw = f.width * fs_;
    const fh = f.height * fs_;
    const fm = motion(W, H, f.width, f.height, fs_, W / 2, topH / 2, o.calibration);
    // trim overflow (aspect mismatch) so nothing spills over the gameplay
    const c = { left: ((fw - W) / 2 / fw) * 100, right: ((fw - W) / 2 / fw) * 100, top: ((fh - topH) / 2 / fh) * 100, bottom: ((fh - topH) / 2 / fh) * 100 };
    const needCrop = c.left > 0.2 || c.top > 0.2;
    const fid = nextId();
    v2Xml = `${clipHead(fid, path.basename(f.path))}${fileXml('file-facecam', { ...f, hasAudio: false }, rate, frames, defined)}${motionFilter(fm)}${needCrop ? cropFilter(c) : ''}</clipitem>`;
  }

  // ---- V4 chat overlay (transparent): lower left of the gameplay area, easy to move in Premiere ----
  let v4Xml = '';
  if (o.chat) {
    const c = o.chat;
    const cs = Math.min(1, (W * 0.42) / c.width, (botH * 0.8) / c.height);
    const cm = motion(W, H, c.width, c.height, cs, 36 + (c.width * cs) / 2, H - 60 - (c.height * cs) / 2, o.calibration);
    v4Xml = `${clipHead(nextId(), path.basename(c.path))}${fileXml('file-chat', { ...c, hasAudio: false }, rate, frames, defined)}${motionFilter(cm)}</clipitem>`;
  }

  // ---- V3 caption overlay ----
  let v3Xml = '';
  if (o.overlay) {
    const ov = o.overlay;
    const om = motion(W, H, ov.width, ov.height, W / ov.width, W / 2, H / 2, o.calibration);
    v3Xml = `${clipHead(nextId(), path.basename(ov.path))}${fileXml('file-captions', { ...ov, hasAudio: false }, rate, frames, defined)}${motionFilter(om)}</clipitem>`;
  }

  const vTrack = (inner, name) => `<track MZ.TrackName="${esc(name)}">${inner}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  const aTrack = (inner, name, idx, attrs = '') => `<track MZ.TrackName="${esc(name)}"${attrs}>${inner}<enabled>TRUE</enabled><locked>FALSE</locked><outputchannelindex>${idx}</outputchannelindex></track>`;
  const stereo = (i) => ` currentExplodedTrackIndex="${i}" totalExplodedTrackCount="2" premiereTrackType="Stereo"`;
  const aClip = (id, ti) =>
    `<clipitem id="${id}" premiereChannelType="stereo"><name>${esc(path.basename(g.path))}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rateXml(rate)}<start>0</start><end>${frames}</end><in>0</in><out>${frames}</out><file id="file-gameplay"/><sourcetrack><mediatype>audio</mediatype><trackindex>${ti}</trackindex></sourcetrack>${links(id)}</clipitem>`;

  const audioTracks = g.hasAudio
    ? aTrack(aClip(a1, 1), 'Gameplay', 1, stereo(0)) + aTrack(aClip(a2, 2), 'Gameplay', 2, stereo(1))
    : '';
  const sr = g.sampleRate || 48000;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${esc(o.name)}</name>
<duration>${frames}</duration>
${rateXml(rate)}
<timecode>${rateXml(rate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rateXml(rate)}<codec><name>Apple ProRes 422</name></codec><width>${W}</width><height>${H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>
${vTrack(v1Xml, 'Gameplay')}
${vTrack(v2Xml, 'Facecam')}
${vTrack(v3Xml, 'Captions')}
${o.chat ? vTrack(v4Xml, 'Chat') : ''}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>${sr}</samplerate></samplecharacteristics></format>
<outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group><group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>
${audioTracks}
${aTrack('', 'SFX', 1, stereo(0))}${aTrack('', 'SFX', 2, stereo(1))}
${aTrack('', 'Music', 1, stereo(0))}${aTrack('', 'Music', 2, stereo(1))}
</audio>
</media>
</sequence>
</xmeml>
`;
}

module.exports = { buildXml, pathUrl, rateOf, motion };
/**
 * Generic vertical sequence from layers (bottom first). Every video layer shows the window `src` (media px) of its
 * media exactly in `dst` (sequence px): uniform scale + position, and a Crop filter on the sides where the layer
 * edge lies inside the frame (sides at the frame edge stay uncropped so the clip can still be nudged in Premiere).
 * @param o.gameplay  media with audio + rate (always the audio source, even when its video layer is hidden)
 * @param o.layers    [{type, media:{path,width,height}, src:{x,y,w,h}, dst:{x,y,w,h}, track?}]
 */
function buildSequence(o) {
  const W = o.width;
  const H = o.height;
  const g = o.gameplay;
  const rate = rateOf(g.fps);
  const frames = Math.max(1, Math.round(g.duration * rate.fps));
  const defined = new Set();
  const clipHead = (id, name) =>
    `<clipitem id="${id}"><name>${esc(name)}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rateXml(rate)}<start>0</start><end>${frames}</end><in>0</in><out>${frames}</out>`;
  const NAMES = { gameplay: 'Gameplay', facecam: 'Facecam', captions: 'Captions', chat: 'Chat' };

  const vLayers = o.layers.filter((l) => l.media && l.src && l.dst);
  const gpIndex = vLayers.findIndex((l) => l.type === 'gameplay');
  const v1 = gpIndex >= 0 ? `clipitem-v${gpIndex + 1}` : null;
  const a1 = 'clipitem-a1';
  const a2 = 'clipitem-a2';
  const links = () =>
    g.hasAudio
      ? [...(v1 ? [[v1, 'video', gpIndex + 1]] : []), [a1, 'audio', 1], [a2, 'audio', 2]]
          .map(([id, mt, ti]) => `<link><linkclipref>${id}</linkclipref><mediatype>${mt}</mediatype><trackindex>${ti}</trackindex><clipindex>1</clipindex></link>`)
          .join('')
      : '';

  const tracks = vLayers.map((l, i) => {
    const m = l.media;
    const s = l.dst.w / l.src.w;
    // where the media center lands so that the window center sits on the target center
    const px = l.dst.x + l.dst.w / 2 - s * (l.src.x + l.src.w / 2 - m.width / 2);
    const py = l.dst.y + l.dst.h / 2 - s * (l.src.y + l.src.h / 2 - m.height / 2);
    const mo = motion(W, H, m.width, m.height, s, px, py, o.calibration);
    const inside = (v, edge) => Math.abs(v - edge) > 0.5;
    const c = {
      left: inside(l.dst.x, 0) ? (l.src.x / m.width) * 100 : 0,
      right: inside(l.dst.x + l.dst.w, W) ? ((m.width - l.src.x - l.src.w) / m.width) * 100 : 0,
      top: inside(l.dst.y, 0) ? (l.src.y / m.height) * 100 : 0,
      bottom: inside(l.dst.y + l.dst.h, H) ? ((m.height - l.src.y - l.src.h) / m.height) * 100 : 0,
    };
    for (const k of Object.keys(c)) c[k] = Math.max(0, Math.min(100, c[k]));
    const needCrop = Object.values(c).some((v) => v > 0.05);
    const isGp = l.type === 'gameplay';
    const id = isGp ? v1 : `clipitem-v${i + 1}`;
    const media = isGp ? g : { ...m, hasAudio: false };
    const xml = `${clipHead(id, path.basename(m.path))}${fileXml(`file-${l.type}`, media, rate, frames, defined)}${motionFilter(mo)}${needCrop ? cropFilter(c) : ''}${isGp ? links() : ''}</clipitem>`;
    return `<track MZ.TrackName="${esc(l.track || NAMES[l.type] || l.type)}">${xml}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  });

  const aTrack = (inner, name, idx, attrs = '') => `<track MZ.TrackName="${esc(name)}"${attrs}>${inner}<enabled>TRUE</enabled><locked>FALSE</locked><outputchannelindex>${idx}</outputchannelindex></track>`;
  const stereo = (i) => ` currentExplodedTrackIndex="${i}" totalExplodedTrackCount="2" premiereTrackType="Stereo"`;
  const aClip = (id, ti) =>
    `<clipitem id="${id}" premiereChannelType="stereo"><name>${esc(path.basename(g.path))}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rateXml(rate)}<start>0</start><end>${frames}</end><in>0</in><out>${frames}</out>${fileXml('file-gameplay', g, rate, frames, defined)}<sourcetrack><mediatype>audio</mediatype><trackindex>${ti}</trackindex></sourcetrack>${links()}</clipitem>`;
  const audioTracks = g.hasAudio ? aTrack(aClip(a1, 1), 'Gameplay', 1, stereo(0)) + aTrack(aClip(a2, 2), 'Gameplay', 2, stereo(1)) : '';
  const sr = g.sampleRate || 48000;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${esc(o.name)}</name>
<duration>${frames}</duration>
${rateXml(rate)}
<timecode>${rateXml(rate)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rateXml(rate)}<codec><name>Apple ProRes 422</name></codec><width>${W}</width><height>${H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>
${tracks.join('\n')}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>${sr}</samplerate></samplecharacteristics></format>
<outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group><group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>
${audioTracks}
${aTrack('', 'SFX', 1, stereo(0))}${aTrack('', 'SFX', 2, stereo(1))}
${aTrack('', 'Music', 1, stereo(0))}${aTrack('', 'Music', 2, stereo(1))}
</audio>
</media>
</sequence>
</xmeml>
`;
}

/** Largest window of `aspect` inside a W×H source, centered (media px). */
function coverPx(W, H, aspect) {
  let w = W;
  let h = W / aspect;
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/**
 * Classic split layout (facecam on top, gameplay below) — kept for older callers and tests.
 * @param o.split facecam share of the height; o.gameplayRect normalized gameplay window or null = centered
 */
function buildXml(o) {
  const W = o.width;
  const H = o.height;
  const topH = Math.round(H * o.split);
  const botH = H - topH;
  const g = o.gameplay;
  const layers = [];
  const gr = o.gameplayRect;
  const gWin = gr ? coverPx(gr.w * g.width, gr.h * g.height, W / botH) : coverPx(g.width, g.height, W / botH);
  if (gr) {
    gWin.x += gr.x * g.width;
    gWin.y += gr.y * g.height;
  }
  layers.push({ type: 'gameplay', media: g, src: gWin, dst: { x: 0, y: topH, w: W, h: botH } });
  if (o.facecam) layers.push({ type: 'facecam', media: o.facecam, src: coverPx(o.facecam.width, o.facecam.height, W / topH), dst: { x: 0, y: 0, w: W, h: topH } });
  if (o.overlay) layers.push({ type: 'captions', media: o.overlay, src: { x: 0, y: 0, w: o.overlay.width, h: o.overlay.height }, dst: { x: 0, y: 0, w: W, h: H } });
  if (o.chat) {
    const c = o.chat;
    const cs = Math.min(1, (W * 0.42) / c.width, (botH * 0.8) / c.height);
    layers.push({ type: 'chat', media: c, src: { x: 0, y: 0, w: c.width, h: c.height }, dst: { x: 36, y: H - 60 - c.height * cs, w: c.width * cs, h: c.height * cs } });
  }
  return buildSequence({ name: o.name, width: W, height: H, gameplay: g, layers, calibration: o.calibration });
}

module.exports = { buildXml, buildSequence, pathUrl, rateOf, motion };
