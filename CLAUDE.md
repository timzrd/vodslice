# Vodslice — project handoff for Claude

Read this first. It is the complete context of how and why Vodslice was built (the original chat is gone).

## Cloud or local session? Check first
Tim's main workflow is a **local** session on his Windows PC in `C:\Users\timzu\Dev\Vodslice` — there you can
run and test everything (see "Where things live" and "Testing"). Sometimes he pairs a chat with this GitHub repo
in the **cloud** (Linux) for small changes. In a cloud session:
- **You can:** read/edit all code, `npm ci`, `npm test` (pure-module self-test, no binaries/network),
  `npx vite build` (renderer compiles), `node --check electron/*.cjs`, commit, push, tag releases.
- **You can't:** run the Electron GUI against his setup, use his GPU, Premiere, Topaz, or `%APPDATA%\Vodslice`.
  `electron/tools.cjs` downloads **Windows** binaries (yt-dlp.exe, ffmpeg win64, deno, whisper.cpp) — the
  headless harnesses in `scripts/dev/` therefore only run on Windows. Don't claim something works in the app
  unless `npm test` covers it or Tim confirmed it; tell him exactly what to try.
- **Shipping to Tim = a GitHub release.** His installed app updates itself from this repo's releases:
  ```bash
  npm version patch -m "Release v%s"     # bumps package.json + package-lock, commits, tags vX.Y.Z
  git push --follow-tags                 # tag push -> Actions builds the Windows installer and publishes it
  ```
  `.github/workflows/release.yml` (windows-latest): `npm ci` → `npm test` → `vite build` →
  `electron-builder --win nsis` → `gh release create` with `Vodslice-Setup-x.y.z.exe`, `.blockmap`, `latest.yml`
  (the tag must equal the package.json version). Manual "Run workflow" = build check only, installer as artifact.
  After the run is green, Tim gets "Update x.y.z" in the title bar. Check runs with `gh run list` / `gh run view`.
- Add a test to `scripts/dev/selftest.cjs` when you change captions, Premiere XML, alignment, HLS parsing,
  probe/format logic or naming — it's the only automated safety net in the cloud and it gates every release.

## The user (Tim)
- Makes **short-form videos**, mostly from **DrDonut**'s old Twitch/YouTube livestream VODs (Minecraft / Donut SMP,
  4–8 h long) plus Twitch clips of other streamers (e.g. Papaplatte). Edits in **Premiere Pro 2026**, upscales the
  facecam with **Topaz Video AI 7.1.1** (Pro). PC: Windows 11, NVIDIA RTX 2060.
- **Talks German** (casual, voice-dictated, long messages) — answer in German, short and direct.
  **Code, comments, UI text and docs in English.**
- His **mouse wheel is broken**: never rely on scrolling. Drag/keyboard interactions instead (the drag-to-spin
  time picker is his favourite feature).
- Wants a clean, bold UI — "not a pilot cockpit, but not empty either". Dislikes things that "look like AI"
  (glow text, gradients, emoji). Hates settings bloat: put the important toggles where you use them, details in
  Settings.
- Gives broad freedom ("mach wie du meinst"), but expects things to really work: test against real VODs/clips.

## What the app does
Electron desktop app with five views (title-bar tabs):
- **Home** — saved projects (thumbnail with the facecam box + clip marks), recent channels, recent downloads.
- **Browse** — a recreated YouTube (red) / Twitch (purple) channel page: banner, avatar, subscribers, tabs
  (Videos/Streams · Past broadcasts/Highlights/Clips), infinite grid. Picking a video flies its thumbnail into the
  player while the page shrinks into the media bin.
- **Edit** — NLE layout: media bin (left) | player (exactly 16:9 of the height) | clips + export (right), timeline
  below (ruler, filmstrip lane with clips, activity track). Mark clips (drag / I+O / N) → check the ones to export →
  download only those parts fast → `Gameplay.mp4` + `Facecam.mp4` in auto-numbered folders (`DrDonut 70`, …) →
  optional Topaz-enhanced facecam → optional ready **Premiere sequence** (FCP7 XML) with local **captions**.
- **Premiere** (`src/components/studio/`) — the layout designer: full-screen canvas of the vertical frame, layers
  (gameplay / facecam / chat / captions) to drag, resize, frame and reorder, caption looks, font browser, effect stack,
  motion, presets. The active preset builds every Premiere sequence. Live mode draws the Edit video; clip mode plays a
  finished download (`vsfile://`) with its real transcript and can rebuild it ("Apply to clip").
- **Downloads** — big job cards with the pipeline (`job.phases` / `job.phase`, one color per step, "Clip ready" once
  `job.filesReady`), earlier downloads from history. The title-bar popup stays.
Settings, presets, favorite fonts and the output folder live in `%APPDATA%\Vodslice` and survive updates.
The top field takes a video link (loads it), a channel link (opens the channel) or a name (asks YouTube or Twitch,
opens the best match, other matches as chips). Installed per-user via NSIS; updates itself from GitHub releases.

## Run / build
```bash
npm install
node node_modules/electron/install.js   # npm 12 skips install scripts -> Electron binary missing otherwise
npm start                               # vite build + electron .
npm test                                # self-test (any OS)
npm run release [patch|minor|x.y.z] "notes"   # LOCAL Windows release: bump, build, commit, push, GitHub release
```
(From the cloud use the tag flow above instead of `npm run release` — it needs Windows.)
- electron-builder's NSIS step **fails on long paths** (the project once lived in a very deep folder). The release
  script therefore builds from a short copy: `%LOCALAPPDATA%\Temp\vsb2` (robocopy /MIR).
- First electron-builder run on a machine may fail while downloading its tools — the script retries once.
- Never edit `package.json` with PowerShell `Set-Content -Encoding utf8` (adds a BOM → JSON parse errors).

## Layout
```
electron/              main process (CommonJS, no build step)
  main.cjs             windows, app:// protocol, vsproxy:// media proxy, IPC, notifications, test harness
  preload.cjs          window.api (contextBridge)
  store.cjs            settings.json + history.json in %APPDATA%\Vodslice (DEFAULTS = all settings, documented)
  tools.cjs            private yt-dlp / ffmpeg / ffprobe / deno in %APPDATA%\Vodslice\bin, auto-update
  probe.cjs            yt-dlp -J, format normalization, quality list, preview source, storyboards
  hls.cjs              parallel HLS range downloader (the speed secret)
  engine.cjs           job pipeline: download ranges → cut → join → facecam/gameplay export → Topaz → Premiere
  naming.cjs           "{channel} {n}" folders, auto (scan folder) or manual counters, reservations
  frames.cjs           ffmpeg frame grabs (facecam detection)
  topaz.cjs            find Topaz Video AI (registry), list its upscale models
  whisper.cjs          whisper.cpp install (CUDA/CPU builds, models, Silero VAD) + transcription
  align.cjs            snaps word timings to real speech onsets in the audio
  captions.cjs         caption chunks → SRT, animated ASS
  premiere.cjs         FCP7 XML builder (calibrated motion math)
  premiereExport.cjs   builds <clip>/premiere/ (wav → whisper → align → captions → overlay → xml → project.json)
  premiereOpen.cjs     "Open in Premiere": focus Premiere, Ctrl+I, paste path, Enter (PowerShell + user32)
  updater.cjs          electron-updater (GitHub provider, manual download + restart)
  links.cjs            what the top field got: video link / channel link / name
  youtube.cjs          channel page scrape (ytInitialData) + innertube continuations + channel search
  twitch.cjs           public web GQL: channel, VODs/highlights/clips, search, seek-preview storyboards,
                       chat activity (sampled comments → counts + peaks with 7TV/BTTV/FFZ/Twitch emotes)
  projects.cjs         %APPDATA%\Vodslice\projects\<id>.json + home-screen summaries
  chat.cjs             chat messages of a time range: Twitch VOD / Twitch clip (via its VOD) / YouTube replay
  chatRender.cjs       hidden window renders chat states → PNGs → ffmpeg → transparent Chat.mov (qtrle)
  login.cjs            YouTube/Twitch login: one-time cookie import from the browser (or a cookies.txt)
  layout.mjs           SHARED with the renderer (ES module): frame sizes, layout presets, layer geometry
                       (resolveLayers / coverWindow), caption chunks + animation state (captionState), looks, effects
  fonts.cjs            installed Windows fonts (system + per-user) read from the font files' name/OS2/fvar tables
src/                   renderer (React 19 + Vite 8, plain JSX)
  App.jsx              shell: tabs, top field (link/channel/name + YouTube/Twitch picker), channel state, projects,
                       morph animation, downloads button, settings
  Editor.jsx           the workspace: sources (bin), clips (+undo, checkbox = export), per-source facecam keys/crop/
                       Premiere rect, timeline view, keys, chat activity, download spec, autosave (onProject)
  components/          Player (video + BoxEditor overlays + scrub preview), ScrubBar (in-video bar, emotes),
                       Timeline (ruler, filmstrip, clips lane, activity, wheel/zoom, edge auto-scroll), Bin, ClipList,
                       ExportPanel (facecam / enhance / Premiere / crop + folder, quality, Download), PremierePreview
                       (live 3:4 canvas), Browse, Home, ContextMenu (useMenu), Jobs (DownloadsButton + JobRow),
                       TimeField, Mini, Settings (+ TopazSettings, PremiereSettings), CaptionsEditor, UpdatePill, ui.jsx
  lib/facecam.js       MediaPipe face detection (WASM, offline) ; lib/camrect.js = border search (pure, testable)
  lib/storyboard.js    storyboard sprite cell → CSS (filmstrip, scrub preview, clip thumbnails)
  chatrender.js        the #chatrender page: canvas drawing of the chat overlay (no React)
  capsrender.js        the #capsrender page: caption overlay frames for the export (same drawing code as the preview)
  lib/captionDraw.js   caption drawing on a transparent canvas (fonts, stroke/shadow/glow/box/extrude, animations)
  lib/compose.js       draws a whole preset (video layers + chat sample + captions) — Premiere tab, player preview
  lib/fonts.js         the bundled caption fonts (public/fonts, OFL/Apache, licenses in public/fonts/licenses)
  components/studio/   Studio.jsx (canvas, gestures, snapping, presets, layers, clip mode), Inspector.jsx,
                       FontPicker.jsx, presetStore.js (settings.studio helpers, finished clips for the preview)
  components/DownloadsView.jsx   the Downloads tab
  components/KeyMap.jsx  visual QWERTZ keyboard of all hotkeys (Settings + F1 overlay) — keep in sync with Editor keys
  styles.css + styles-v2.css   base styles + the v2 shell/editor/browse/home styles
public/                models/*.tflite (MediaPipe face detector), icon.png/ico; mediapipe wasm copied at build
scripts/               make-icon.cjs (procedural icon → png/ico), release.cjs, dev/ (test harnesses, see below)
```

## Key decisions & hard-won findings (don't re-learn these)
**Downloading**
- `yt-dlp --download-sections` is unusably slow for YouTube (ffmpeg ≈ realtime; a 2-min part didn't finish in
  6 min). YouTube exposes **HLS** formats (e.g. 312 = 1080p60 avc1, 623 = 1440p VP9, audio 233/234 with
  `acodec: null`). `hls.cjs` downloads only the overlapping segments with 16 connections, ordered writer,
  bounded memory. Twitch VODs are HLS too. Non-HLS (Twitch clips) → whole file via fetch if ≤ 15 min, else ffmpeg
  remote seek.
- Twitch clips report **no codecs** and add `portrait-*` variants → `probe.normalize()` marks codec-less formats as
  muxed avc1/aac and drops portrait ones. Twitch channel key = display name (VOD ids ≠ clip ids).
- Separate HLS audio is raw ADTS → remux to m4a before seeking. Cut uses input-seek + `-c copy` (keyframe
  accurate) unless "Frame-exact" or the source is VP9/AV1 with codec mode "convert" (→ H.264 via NVENC).
- YouTube now needs a JS runtime: yt-dlp runs with `--js-runtimes deno:<path>`; Deno is installed privately.
- "Sign in to confirm you're not a bot" (YouTube flags the IP, e.g. after many test requests): probe turns it into
  a `BOTCHECK:` error → toast "Set up my login" → `LoginDialog` (also Settings › Downloads). Don't add automatic
  player-client switching or similar tricks to get around the check — the user's own login (or waiting) is the way.
  Keep test runs against YouTube small.
- Login = `login.cjs`: one-time import of the user's browser cookies with
  `yt-dlp --cookies-from-browser <b> --cookies tmp.txt file:///…` (file:// is disabled → nothing is downloaded, the
  jar is written on exit), filtered to youtube.com / twitch.tv into `%APPDATA%\Vodslice\cookies.txt`
  (`download.cookiesFile`). Chromium browsers (Brave/Chrome/Edge) lock the database while running → the dialog
  waits until the browser is closed (tasklist) and imports by itself. Encrypted cookies → cookies.txt via the
  "Get cookies.txt LOCALLY" extension. Live `cookiesFromBrowser` errors map to `LOGIN:` → same dialog.
  Never read the user's real browser cookies in tests.
- yt-dlp runs with `PYTHONIOENCODING=utf-8` (otherwise its messages arrive garbled, e.g. "you�re").

**Preview**
- YouTube media URLs are **bound to the IP family yt-dlp used** (IPv6 here); Chromium connects via IPv4 → 403.
  So googlevideo URLs go through `vsproxy://` (Node fetch in main). hls.js `xhrSetup` rewrites segment URLs.
  YouTube preview prefers HLS 480p + HLS audio (format 18 sometimes 403s).

**Facecam**
- Auto-detect: MediaPipe full-range BlazeFace on frames sampled across the **whole VOD** (frames from one minute
  make gameplay look static and ruin border detection), face clustering, then border search: persistent edges +
  stable-inside/changing-outside + typical cam aspect bonus (16:9 > 4:3 > 1:1) + snap to frame edges.
  Exact on DrDonut's layouts. Box is remembered per channel (`facecamPresets`).
- **Facecam positions over time** (`fcKeys` per source: `[{t, rect}]`) for streamers who move their cam; the
  engine splits facecam export at those times (`facecamPieces` + `exportPieces`).

**Premiere tab / layout presets** (`electron/layout.mjs`, `settings.studio`)
- A preset = `ratio` + `layers` (bottom first: `{type, on, rect}` in frame fractions; gameplay/facecam also `view`
  = {zoom, cx, cy} framing; captions = {x, y, w}) + `captions` style. `normalizePreset` fills anything missing.
  Built-ins are seeded on first start from the old `premiere.split`/`premiere.captions` values.
- Geometry is computed ONCE in `resolveLayers` and used by the canvas preview and the XML: every video layer shows a
  window of its media (largest window of the box aspect inside the source region, divided by zoom, centered at cx/cy,
  clamped). Facecam source region = the Edit facecam box (live) or the whole Facecam.mp4 (export) — same result.
- The download spec carries a snapshot of the active preset (`spec.studio`) and `spec.chatSize` (chat rendered 1:1
  at its box size). Rebuilds ("Apply to clip", caption editor, Open in Premiere without XML) use the active preset.
- Caption overlay: NOT libass any more — the hidden `#capsrender` window draws frames with `lib/captionDraw.js`
  (the Studio code), only the band the captions can reach, PNG per changed frame (`captionState().key` dedupes static
  frames), ffmpeg pads the band back to the full frame (`pad=W:H:0:bandY:color=0x00000000`) → qtrle argb at the
  sequence rate. ~6 s for 8 s of 1-word captions. Canvas state on reused helper canvases must be reset each frame
  (a stuck `source-in` once made glow/shadow vanish).
- Fonts: bundled fonts via `src/fonts.css` (@font-face, family names = real names, they shadow installed copies);
  installed fonts by name. `document.fonts` 'loadingdone' clears the caption layout cache (fallback measurements).
- `vsfile://media/?p=<path>` serves local video with Range support, only inside the output folder or a known
  download's folder (Studio clip mode). qtrle .mov can't play in Chromium — chat is a drawn sample in the preview.

**Premiere export** (calibrated in Premiere Pro 2026 with test XMLs — see `release/calibration test/`, not in git)
- Premiere maps FCP `<center>` as: **Position = sequence center + center × SOURCE clip size** (not sequence size).
  Scale = % of source. Crop filter (percent) is honoured. Stereo audio needs the exploded-track attributes
  (`premiereTrackType="Stereo"`) → lands as one stereo clip on A1.
- `buildSequence`: one video track per visible layer in preset order (bottom first): gameplay = original file
  (+ its audio, linked; the audio stays even if the gameplay layer is hidden), facecam = pre-cropped `Facecam.mp4`
  (or Enhanced, **no facecam audio**), chat = `Chat.mov`, captions = full-frame overlay; empty SFX/Music tracks.
  Uniform scale = box width / window width; position puts the window center on the box center. **Crop filter only on
  sides whose box edge lies inside the frame** (overflow beyond the frame edge stays, so the clip can still be nudged
  in Premiere). `buildXml` (old split layout) is a wrapper kept for the calibrated tests.
- Frame sizes: 9:16 1080×1920, 3:4 1440×1920 (default), 4:5 1536×1920, 1:1 1920×1920. The player PIP
  (`PremierePreview`) and the Premiere tab draw with `lib/compose.js` — the same geometry as the XML.
- The old separate "Crop gameplay" export option was removed from the UI (it duplicated the Premiere layout);
  the engine still supports `spec.cropOn`.
- **Premiere cannot open an XML from the command line** ("file path does not exist"), so "Open in Premiere"
  imports via its Import dialog with keystrokes (`premiereOpen.cjs`). Needs Premiere running with a project open.
  Codes: OK / NO_PROJECT / NOT_RUNNING (starts Premiere) / NO_FOCUS / NO_DIALOG. Path is always on the clipboard.

**Captions** (all local)
- whisper.cpp b5454 Windows builds (`whisper-bin-win-cuda-11.8.0-x64.zip` on NVIDIA, `whisper-bin-x64.zip` CPU),
  model `ggml-large-v3-turbo-q5_0.bin`, Silero VAD. **DTW timestamps were worse than plain token timestamps**
  here, and DTW+VAD shifts times — so: tokens + VAD, then `align.cjs` assigns words to speech "islands" in the
  voice-band energy and puts each phrase start exactly on the speech onset (measured: first word 0.59 s = audio).
  Threshold must be relative to the speech level (background noise ~33 dB would otherwise count as speech).
- Overlay = QuickTime Animation (qtrle, argb) on a transparent canvas (see Premiere tab above) — ProRes 4444 would be
  ~10× bigger. `captions.cjs` (ASS/libass) is only used for the SRT now.
- Default language German (prompt said so) — DrDonut speaks English → set English in Settings for him.

**Topaz**
- CLI = Topaz's bundled `ffmpeg.exe` with `tvai_up`; env `TVAI_MODEL_DATA_DIR` / `TVAI_MODEL_DIR` =
  `C:\ProgramData\Topaz Labs LLC\Topaz Video AI\models\`. Tim's usual setting (from his Topaz logs): `iris-3`,
  2×, `estimate=8` (auto), `blend=0.2` → preset "Face 2× · Iris".

**Browse (channel pages, no API keys)**
- YouTube: fetch `youtube.com/<ref>/<streams|videos>` with cookies `SOCS=CAI; CONSENT=YES+1` (skips the EU
  consent wall), parse `ytInitialData`. Items are `lockupViewModel` now (old `videoRenderer` kept as fallback).
  Next pages: the grid's `continuationItemRenderer` token → POST `/youtubei/v1/browse` with WEB client version +
  visitor data from the page. Many DrDonut streams have an **empty (zero-width) title** → shown as "Untitled stream".
  Channel search: `/results?search_query=…&sp=EgIQAg%3D%3D`; in `channelRenderer` the @handle sits in
  `subscriberCountText` and the subscriber count in `videoCountText` (swapped by YouTube).
- Twitch: public web GQL (`Client-ID kimne78kx3ncx6brgo4mv6wki5h1ko`), **raw queries** work for user, videos,
  clips (no `sort` arg, it errors), `searchUsers`, `seekPreviewsURL`. Video `after` cursors are broken → one page of
  100 (Twitch keeps ~60 days). `profileImageURL(width)` only accepts 28/50/70/150/300/600.
- Twitch chat: `comments(contentOffsetSeconds:)` works without login, **cursor paging fails the integrity check**.
  So chat is sampled: one offset request per window (step = duration/1200, 10–60 s, 12 parallel) → ~30 s for 6 h.
  Counts inside a window, extrapolated if the page ends early; peaks = local maxima > 1.6× median, top emote per
  peak (one vote per message) from Twitch fragments + 7TV/BTTV/FFZ channel+global sets. Cached in
  `%APPDATA%\Vodslice\cache\chat\<id>.json` (bump `v` when the format/algorithm changes). Clicking an emote seeks
  12 s before the peak (chat reacts late).
- Twitch VOD storyboards come from `seekPreviewsURL` (yt-dlp has none) → filmstrip + scrub preview. Twitch clips
  get ~6 ffmpeg frames instead.

**Chat overlay** (export option "Chat overlay" → `<prefix>Chat.mov` next to the gameplay + V4 "Chat" in Premiere)
- Twitch: same offset-only comment requests as the activity graph, here walking every page of the range (8 s chunks
  in parallel, dedupe by comment id, same-second messages spread over the second). `userColor` is often null →
  Twitch's default palette by name hash. Clips: `clip(slug){videoOffsetSeconds video{id}}` → chat of the VOD
  (fails if the VOD is gone).
- YouTube: watch page `liveChatRenderer.continuations[0].reloadContinuationData` ("Top chat replay"; the sub-menu
  "Live chat replay" token answers 400) → POST `live_chat/get_live_chat_replay` with
  `currentPlayerState.playerOffsetMs` to seek, follow `liveChatReplayContinuationData`. Emoji come as images,
  7TV works for YouTube channels (`7tv.io/v3/users/youtube/<UC…>`). Owner/mod/member get YouTube's colors.
- Rendering needs a canvas → hidden BrowserWindow `#chatrender` draws one PNG per chat change (15 fps grid), main
  writes them + an ffmpeg concat list with exact durations → `fps=30,format=argb` → qtrle. Emote images load with
  `crossOrigin` (main injects ACAO * on all https responses, otherwise the canvas would be tainted).
- 15 s of history are pre-filled so the overlay doesn't start empty. Chat failures only add a job warning.

**Hotkeys** (Premiere-ish, right hand on J K L): K = play/pause (toggle), L = play / 2× / 4× / 8×, **any pause resets
the speed**, J = −10 s, I/O = IN/OUT (with a clip selected they trim it; O creates the clip and deselects so the next I
starts a new one), U = marker (per source, `srcState.markers`, snap target for all drags), `,` / `.` = previous /
next marker, P = play the selected clip, N new clip, S split, F1 = keyboard overlay. No pop-ups on hotkeys (Tim
asked to remove the on-screen hints). When you add/change a key, update `KeyMap.jsx` too.

**Projects / editor model**
- A project = sources (bin) + per-source state + clips. Autosaved 0.7 s after changes; signed media URLs are not
  stored — opening a project shows it instantly from the stored info (`stale: true`) and re-probes in the background.
- Clips carry `on` (checkbox = included in Download) and `sent`. A download unchecks what it took, so the next
  Download only takes new clips. Right-click (timeline segment or list) = download just that clip.
- I/O: with a clip selected they trim it; without, I sets a pending IN and O creates the clip IN→playhead (and
  deselects it).
- React gotcha that broke facecam auto-detect once: never compute a return value inside a `setState(fn)` updater
  (it runs later) — `initSource` decides from `srcStateRef`.

**Updates**
- `electron-updater`, GitHub provider `timzrd/vodslice` (public). Manual download from the title-bar pill, then
  restart. Artifact name has no spaces (`Vodslice-Setup-x.y.z.exe`) so latest.yml matches the uploaded asset.

## Where things live on Tim's PC
- Installed app: `%LOCALAPPDATA%\Programs\Vodslice`. Data: `%APPDATA%\Vodslice` (`settings.json`,
  `history.json`, `bin\` with yt-dlp/ffmpeg/deno and `bin\whisper\{cuda,cpu}` + models).
- Source: `C:\Users\timzu\Dev\Vodslice` (this repo; moved from `Desktop\Vodslice` on 2026-11-09). Local sessions
  are his main workflow (Topaz, Premiere, GPU whisper only exist there); cloud sessions are for small changes. His clips live in Google Drive ("Meine Ablage/projects").
- Dev runs use AUMID `app.vodslice.dev` so Windows doesn't cache the Electron icon for the real app.

## Testing
- **Headless** (no Electron): `scripts/dev/headless-engine.cjs`, `scripts/dev/premiere-pipeline.cjs`,
  `scripts/dev/caption-timing.cjs` — they use a throwaway data dir and real URLs.
- **Real UI**: `VODSLICE_TEST_SCRIPT=<file.cjs> VODSLICE_TEST_OUT=<dir> electron .` runs a script in the main
  process after load (see `scripts/dev/ui-test-example.cjs`): off-screen window, `ctx.exec()` runs JS in the
  renderer (`window.__vs` exposes load/download/state…), `ctx.capture(name)` saves screenshots, real input via
  `main.webContents.sendInputEvent`. **Test runs share `%APPDATA%\Vodslice\settings.json`** with the installed
  app — back it up and restore it around a test.
- Tim often uses the PC while you test; keep test windows off-screen and don't fight his foreground windows.

## Known gaps / ideas
- "Open in Premiere" keystroke import was not verified end-to-end by Claude (Tim was using the PC). Import of the
  generated XMLs themselves was verified. Paths with umlauts not yet tested in Premiere.
- Premiere tab (v1.4.0) was tested in the real app (live + clip mode, all panels, a real Twitch download with chat +
  whisper + caption overlay); the new layer XMLs were not opened in Premiere yet — the math is the calibrated one.
- Possible next features Tim might like: emphasis words in captions (manual colors per word), rounded/bordered
  facecam (needs a pre-rendered mask — FCP XML can't round corners), auto-detect facecam position changes over time,
  YouTube live-chat replay activity (Twitch chat activity exists), a hover frame preview on the timeline.
- The browse scrapers depend on YouTube/Twitch page structures — if a channel page comes back empty, check
  `youtube.cjs itemsOf/headerOf` against a fresh `ytInitialData` first.
