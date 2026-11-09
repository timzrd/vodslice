// Self-test for the pure modules — runs anywhere (Linux cloud sessions, CI), no binaries or network.
//   npm test
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const req = (m) => require(path.join(ROOT, 'electron', m));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------- captions ----------------
test('captions: chunking respects words, chars, pauses and sentence ends', () => {
  const { chunk } = req('captions.cjs');
  const w = (word, s, e) => ({ w: word, start: s, end: e });
  const words = [w('Geiler', 0.6, 1.0), w('Bildschirm', 1.0, 1.6), w('auch', 1.6, 1.9), w('da', 1.9, 2.1), w('hinten.', 2.1, 2.5), w('Ja', 3.1, 3.3)];
  const c = chunk(words, { maxWords: 3, maxChars: 18, maxDur: 1.5, pause: 0.3 });
  assert.deepEqual(c.map((x) => x.words.map((y) => y.w).join(' ')), ['Geiler Bildschirm', 'auch da hinten.', 'Ja']);
  assert.equal(c[0].start, 0.6);
  const off = chunk(words, { offsetMs: -100 });
  assert.ok(Math.abs(off[0].start - 0.5) < 1e-9, 'offset shifts captions');
});

test('captions: SRT and ASS output', () => {
  const { chunk, toSrt, toAss } = req('captions.cjs');
  const c = chunk([{ w: 'Hallo', start: 1.25, end: 1.6 }, { w: 'Welt', start: 1.6, end: 2.0 }]);
  const srt = toSrt(c, { uppercase: true });
  assert.match(srt, /^1\n00:00:01,250 --> 00:00:02,000\nHALLO WELT\n/);
  const ass = toAss(c, { width: 1440, height: 1920, y: 640, highlight: '#ffd23f' });
  assert.match(ass, /PlayResX: 1440/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 2, 'one event per word');
  assert.match(ass, /\\c&H003FD2FF/i, 'highlight color in BGR');
  assert.match(ass, /\\pos\(720,640\)/);
});

// ---------------- premiere ----------------
test('premiere: NTSC rates and path URLs', () => {
  const { rateOf, pathUrl } = req('premiere.cjs');
  assert.deepEqual([rateOf(59.94).timebase, rateOf(59.94).ntsc], [60, true]);
  assert.deepEqual([rateOf(29.97).timebase, rateOf(29.97).ntsc], [30, true]);
  assert.deepEqual([rateOf(60).timebase, rateOf(60).ntsc], [60, false]);
  if (process.platform === 'win32') assert.equal(pathUrl('C:\\Meine Ablage\\Über Clip.mp4'), 'file://localhost/C:/Meine%20Ablage/%C3%9Cber%20Clip.mp4');
  else assert.equal(pathUrl('/tmp/Meine Ablage/Über.mp4'), 'file://localhost/tmp/Meine%20Ablage/%C3%9Cber.mp4');
});

test('premiere: calibrated motion (Position = seq center + center × source size)', () => {
  const { buildXml } = req('premiere.cjs');
  const src = { path: path.join(os.tmpdir(), 'pattern.mp4'), width: 1920, height: 1080, fps: 60, duration: 5, hasAudio: true, sampleRate: 48000, channels: 2 };
  const xml = buildXml({ name: 'T', width: 1440, height: 1920, split: 1 / 3, gameplay: src, facecam: src });
  const centers = [...xml.matchAll(/<parameterid>center<\/parameterid><name>Center<\/name><value><horiz>([-\d.]+)<\/horiz><vert>([-\d.]+)<\/vert>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const scales = [...xml.matchAll(/<parameterid>scale<\/parameterid><name>Scale<\/name><valuemin>0<\/valuemin><valuemax>1000<\/valuemax><value>([\d.]+)</g)].map((m) => Number(m[1]));
  // V1 gameplay: covers bottom 1440x1280 -> scale 1280/1080, centered at y=1280 -> vert (1280-960)/1080
  assert.ok(Math.abs(scales[0] - 118.519) < 0.01);
  assert.ok(Math.abs(centers[0][1] - 320 / 1080) < 1e-5);
  // V2 facecam: top 1440x640 -> scale 75 %, y=320 -> vert (320-960)/1080 (verified in Premiere: Position 720,320)
  assert.ok(Math.abs(scales[1] - 75) < 0.01);
  assert.ok(Math.abs(centers[1][1] - -640 / 1080) < 1e-5);
  assert.match(xml, /premiereTrackType="Stereo"/);
  assert.equal((xml.match(/<file id="file-gameplay">/g) || []).length, 1, 'file defined once');
  assert.ok(!/<clipitem[^>]*>(?:(?!<\/clipitem>).)*file-facecam(?:(?!<\/clipitem>).)*<sourcetrack>/s.test(xml), 'facecam has no audio clip');
});

// ---------------- align ----------------
test('align: phrase starts snap to speech onsets', () => {
  const { snapWords } = req('align.cjs');
  const sr = 16000;
  const dur = 4;
  const pcm = new Int16Array(sr * dur);
  let seed = 1;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 300; // background
  const voiced = (t) => (t >= 0.6 && t < 1.5) || (t >= 2.0 && t < 2.8);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    pcm[i] = noise() + (voiced(t) ? 9000 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0);
  }
  const wav = path.join(os.tmpdir(), `vodslice-selftest-${process.pid}.wav`);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length * 2, 40);
  fs.writeFileSync(wav, Buffer.concat([header, Buffer.from(pcm.buffer)]));
  // whisper-like times: first word of each phrase too early
  const words = [
    { w: 'Geiler', start: 0.15, end: 0.5 },
    { w: 'Bildschirm', start: 0.5, end: 1.2 },
    { w: 'Ja', start: 1.75, end: 2.2 },
    { w: 'also', start: 2.2, end: 2.7 },
  ];
  const out = snapWords(words, wav);
  fs.rmSync(wav, { force: true });
  assert.ok(Math.abs(out[0].start - 0.6) <= 0.03, `first phrase starts at speech (${out[0].start})`);
  assert.ok(Math.abs(out[2].start - 2.0) <= 0.03, `second phrase starts at speech (${out[2].start})`);
  assert.ok(out.every((w, i) => i === 0 || w.start > out[i - 1].start), 'order kept');
});

// ---------------- probe / hls / naming ----------------
test('probe: Twitch clip formats normalized, qualities sorted', () => {
  const { normalize, buildQualities } = req('probe.cjs');
  const info = normalize({
    formats: [
      { format_id: 'portrait-720', height: 720, protocol: 'https', url: 'x' },
      { format_id: '720', height: 720, fps: 60, protocol: 'https', url: 'x' },
      { format_id: '1080', height: 1080, fps: 60, protocol: 'https', url: 'x' },
    ],
  });
  assert.ok(!info.formats.some((f) => /portrait/.test(f.format_id)), 'portrait variants dropped');
  const q = buildQualities(info);
  assert.equal(q[0].label, '1080p60');
  assert.equal(q[0].muxed, true);
});

test('hls: playlist parsing with init segment and byte ranges', () => {
  const { parsePlaylist, selectSegments } = req('hls.cjs');
  const pl = parsePlaylist(
    ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:6.0,', '#EXT-X-BYTERANGE:1000@0', 'seg.m4s', '#EXTINF:6.0,', '#EXT-X-BYTERANGE:1000', 'seg.m4s', '#EXTINF:4.0,', 'b.m4s', '#EXT-X-ENDLIST'].join('\n'),
    'https://cdn.example/v/index.m3u8'
  );
  assert.equal(pl.segs.length, 3);
  assert.equal(pl.map.url, 'https://cdn.example/v/init.mp4');
  assert.deepEqual(pl.segs[1].range, [1000, 1000]);
  assert.equal(pl.total, 16);
  assert.deepEqual(selectSegments(pl, 7, 13).map((s) => s.t), [6, 12]);
});

test('premiere: any facecam ratio is cropped to the top area', () => {
  const { buildXml } = req('premiere.cjs');
  const g = { path: path.join(os.tmpdir(), 'g.mp4'), width: 1920, height: 1080, fps: 60, duration: 5, hasAudio: true };
  const fc = { path: path.join(os.tmpdir(), 'f.mp4'), width: 640, height: 360 }; // 16:9 cam, top area is 1440×640 (9:4)
  const xml = buildXml({ name: 'T', width: 1440, height: 1920, split: 1 / 3, gameplay: g, facecam: fc });
  const crop = xml.match(/<effectid>crop<\/effectid>[\s\S]*?<\/effect>/);
  assert.ok(crop, 'facecam gets a crop filter');
  const v = (id) => Number(new RegExp(`<parameterid>${id}</parameterid><name>${id}</name><valuemin>0</valuemin><valuemax>100</valuemax><value>([\\d.]+)`).exec(crop[0])[1]);
  // scaled to 1440 wide -> 810 high, 170 px too much -> 85 px (10.494 %) off top and bottom
  assert.ok(Math.abs(v('top') - 10.494) < 0.01 && Math.abs(v('bottom') - 10.494) < 0.01);
  assert.equal(v('left'), 0);
});

// ---------------- browse / links ----------------
test('links: video, channel or name', () => {
  const { parseInput } = req('links.cjs');
  const k = (s) => parseInput(s);
  assert.equal(k('DrDonut').kind, 'search');
  assert.equal(k('papa platte').kind, 'search');
  assert.deepEqual(k('https://www.youtube.com/@DrDonutt/streams'), { kind: 'channel', site: 'youtube', ref: '@DrDonutt', url: 'https://www.youtube.com/@DrDonutt' });
  assert.equal(k('youtube.com/channel/UCPYZ-R5LQGMeU7QikgxmH8Q').ref, 'channel/UCPYZ-R5LQGMeU7QikgxmH8Q');
  assert.equal(k('@DrDonutt').kind, 'channel');
  assert.deepEqual(k('https://www.twitch.tv/Papaplatte'), { kind: 'channel', site: 'twitch', ref: 'papaplatte', url: 'https://www.twitch.tv/papaplatte' });
  for (const v of ['https://www.youtube.com/watch?v=abc&t=10', 'https://youtu.be/abc', 'https://www.youtube.com/live/abc', 'https://www.twitch.tv/videos/123', 'https://www.twitch.tv/papaplatte/clip/Foo-bar', 'https://clips.twitch.tv/Foo'])
    assert.equal(k(v).kind, 'video', v);
  assert.equal(k('https://www.twitch.tv/directory').kind, 'none');
});

test('youtube: lockup items + channel header from page data', () => {
  const yt = req('youtube.cjs');
  const lockup = (id, title, dur, parts) => ({
    richItemRenderer: {
      content: {
        lockupViewModel: {
          contentId: id,
          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
          contentImage: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/a.jpg`, width: 360 }, { url: `https://i.ytimg.com/vi/${id}/b.jpg`, width: 720 }] }, overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: dur } }] } }] } },
          metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: parts.map((p) => ({ text: { content: p } })) }] } } } },
        },
      },
    },
  });
  const grid = {
    contents: [
      lockup('a1', '​', '5:39:50', ['489K', 'Streamed 13h ago']),
      lockup('a2', 'IM THE RICHEST', '4:17:20', ['521K', 'Streamed 3d ago']),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN' } } } },
    ],
  };
  const items = yt.itemsOf(grid);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].duration, items[0].views, items[0].published], ['', 20390, '489K views', 'Streamed 13h ago']);
  assert.equal(items[1].thumbnail, 'https://i.ytimg.com/vi/a2/b.jpg');
  assert.equal(yt.parseDur('1:02:03'), 3723);
  const data = {
    metadata: { channelMetadataRenderer: { title: 'DrDonut', externalId: 'UC1', description: 'Daily live streamer\nmore' } },
    header: { pageHeaderRenderer: { content: { pageHeaderViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '@DrDonutt' } }] }, { metadataParts: [{ text: { content: '2.92M subscribers' } }, { text: { content: '706 videos' } }] }] } } } } } },
    contents: { tabs: [{ tabRenderer: { title: 'Videos', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@DrDonutt/videos' } } } } }, { tabRenderer: { title: 'Live', selected: true, endpoint: { commandMetadata: { webCommandMetadata: { url: '/@DrDonutt/streams' } } } } }] },
  };
  const h = yt.headerOf(data, '@DrDonutt');
  assert.deepEqual([h.name, h.handle, h.subscribers, h.videoCount, h.description], ['DrDonut', '@DrDonutt', '2.92M subscribers', '706 videos', 'Daily live streamer']);
  assert.deepEqual(h.tabs, [{ id: 'videos', label: 'Videos' }, { id: 'streams', label: 'Streams' }]);
});

test('twitch: chat windows count emotes once per message, peaks get their emote', () => {
  const tw = req('twitch.cjs');
  const emoteMap = new Map([['KEKW', 'https://cdn/kekw']]);
  const msg = (t, text, emoteId) => ({ node: { contentOffsetSeconds: t, message: { fragments: emoteId ? [{ text, emote: { emoteID: emoteId } }] : [{ text, emote: null }] } } });
  const page = [msg(100, 'KEKW KEKW'), msg(101, 'KEKW'), msg(103, 'LUL', '425618'), msg(105, 'hello'), msg(125, 'later')];
  const r = tw.countPage(page, false, 100, 20, emoteMap);
  assert.equal(r.n, 4, 'only messages inside [100, 120)');
  assert.equal(r.emotes.KEKW[0], 2, 'one vote per message');
  assert.equal(r.emotes.LUL[1], 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0');
  // page ended inside the window -> scaled up
  const big = tw.countPage([msg(100, 'a'), msg(101, 'b'), msg(104, 'c')], true, 100, 20, emoteMap);
  assert.ok(big.extrapolated && big.n === 12);
  const counts = [2, 3, 2, 2, 40, 3, 2, 2, 2, 2, 2, 25, 2];
  const win = counts.map(() => ({}));
  win[4] = { KEKW: [30, 'https://cdn/kekw'] };
  const peaks = tw.findPeaks(counts, win, 20);
  assert.deepEqual(peaks.map((p) => p.t), [90, 230]);
  assert.equal(peaks[0].emote.name, 'KEKW');
  assert.equal(peaks[1].emote, null);
});

test('chat: emote words, name colors, clip slugs, Premiere chat track', () => {
  const chat = req('chat.cjs');
  const parts = chat.splitText('so KEKW true KEKW', new Map([['KEKW', 'u']]), []);
  assert.deepEqual(parts, [{ text: 'so ' }, { emote: 'u', name: 'KEKW' }, { text: ' true ' }, { emote: 'u', name: 'KEKW' }]);
  assert.equal(chat.colorFor('DrDonut'), chat.colorFor('drdonut'), 'stable per name');
  assert.match(chat.colorFor('x'), /^#[0-9A-F]{6}$/);
  assert.equal(chat.clipSlug('https://www.twitch.tv/papaplatte/clip/Foo-Bar_1?filter=clips'), 'Foo-Bar_1');
  assert.equal(chat.clipSlug('https://clips.twitch.tv/SlugHere'), 'SlugHere');
  const { buildXml } = req('premiere.cjs');
  const g = { path: path.join(os.tmpdir(), 'g.mp4'), width: 1920, height: 1080, fps: 30, duration: 5, hasAudio: false };
  const xml = buildXml({ name: 'T', width: 1440, height: 1920, split: 1 / 3, gameplay: g, chat: { path: path.join(os.tmpdir(), 'Chat.mov'), width: 520, height: 820 } });
  assert.match(xml, /MZ\.TrackName="Chat"/);
  assert.match(xml, /<file id="file-chat">/);
});

test('projects: summary has facecam box + clip marks of the main source', () => {
  const { summary } = req('projects.cjs');
  const s = summary({
    id: 'p1',
    updated: 5,
    activeSrc: 'a',
    sources: { a: { cacheId: 'a', title: 'Stream', channel: 'DrDonut', site: 'youtube', duration: 1000, thumbnail: 't.jpg' } },
    srcState: { a: { fcKeys: [{ t: 0, rect: { x: 0, y: 0, w: 0.3, h: 0.3 } }] } },
    clips: [{ src: 'a', segments: [{ start: 100, end: 200, color: '#fff' }] }],
  });
  assert.equal(s.name, 'Stream');
  assert.equal(s.clips, 1);
  assert.equal(s.clipsDuration, 100);
  assert.deepEqual(s.marks, [{ s: 0.1, e: 0.2, c: '#fff' }]);
  assert.equal(s.facecam.w, 0.3);
});

test('naming: template + sanitize', () => {
  const { render, sanitize } = req('naming.cjs');
  assert.equal(render('{channel} {n}', { channel: 'DrDonut', n: 70 }), 'DrDonut 70');
  assert.equal(sanitize('Dr: Donut?*'), 'Dr Donut');
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}\n    ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
