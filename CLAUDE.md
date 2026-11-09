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
Electron desktop app with three views (title-bar tabs):
- **Home** — saved projects (thumbnail with the facecam box + clip marks), recent channels, recent downloads.
- **Browse** — a recreated YouTube (red) / Twitch (purple) channel page: banner, avatar, subscribers, tabs
  (Videos/Streams · Past broadcasts/Highlights/Clips), infinite grid. Picking a video flies its thumbnail into the
  player while the page shrinks into the media bin.
- **Edit** — NLE layout: media bin (left) | player (exactly 16:9 of the height) | clips + export (right), timeline
  below (ruler, filmstrip lane with clips, activity track). Mark clips (drag / I+O / N) → check the ones to export →
  download only those parts fast → `Gameplay.mp4` + `Facecam.mp4` in auto-numbered folders (`DrDonut 70`, …) →
  optional Topaz-enhanced facecam → optional ready **Premiere sequence** (FCP7 XML, always 1440×1920) with local
  **captions**.
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

**Premiere export** (calibrated in Premiere Pro 2026 with test XMLs — see `release/calibration test/`, not in git)
- Premiere maps FCP `<center>` as: **Position = sequence center + center × SOURCE clip size** (not sequence size).
  Scale = % of source. Crop filter (percent) is honoured. Stereo audio needs the exploded-track attributes
  (`premiereTrackType="Stereo"`) → lands as one stereo clip on A1.
- Layout: V1 gameplay (original file, scale + position "cover" of the bottom area, window chosen with the blue
  box), V2 the pre-cropped `Facecam.mp4` (or `Facecam Enhanced.mp4`) filling the top, **no facecam audio**,
  V3 caption overlay, A1 gameplay stereo, empty SFX/Music tracks.
- The sequence is **always 1440×1920** (Tim dropped the 9:16 option). The facecam box stays free: the XML scales
  `Facecam.mp4` to cover the top area and crops the overflow centered (Crop filter). The editor shows the same
  composition live (`PremierePreview`, canvas drawn from the playing video) — keep both in sync.
- **Premiere cannot open an XML from the command line** ("file path does not exist"), so "Open in Premiere"
  imports via its Import dialog with keystrokes (`premiereOpen.cjs`). Needs Premiere running with a project open.
  Codes: OK / NO_PROJECT / NOT_RUNNING (starts Premiere) / NO_FOCUS / NO_DIALOG. Path is always on the clipboard.

**Captions** (all local)
- whisper.cpp b5454 Windows builds (`whisper-bin-win-cuda-11.8.0-x64.zip` on NVIDIA, `whisper-bin-x64.zip` CPU),
  model `ggml-large-v3-turbo-q5_0.bin`, Silero VAD. **DTW timestamps were worse than plain token timestamps**
  here, and DTW+VAD shifts times — so: tokens + VAD, then `align.cjs` assigns words to speech "islands" in the
  voice-band energy and puts each phrase start exactly on the speech onset (measured: first word 0.59 s = audio).
  Threshold must be relative to the speech level (background noise ~33 dB would otherwise count as speech).
- Overlay = QuickTime Animation (qtrle, argb) rendered with libass on a transparent canvas — ~18 MB / 25 s
  (ProRes 4444 would be ~10× bigger). Verified 98.5 % transparent pixels.
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

**Projects / editor model**
- A project = sources (bin) + per-source state + clips. Autosaved 0.7 s after changes; signed media URLs are not
  stored — opening a project shows it instantly from the stored info (`stale: true`) and re-probes in the background.
- Clips carry `on` (checkbox = included in Download) and `sent`. A download unchecks what it took, so the next
  Download only takes new clips. Right-click (timeline segment or list) = download just that clip.
- I/O: with a clip selected they trim it; without, I sets a pending IN and O creates the clip IN→playhead.
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
- Possible next features Tim might like: caption presets, auto-detect facecam position changes over time,
  YouTube live-chat replay activity (Twitch chat activity exists), a hover frame preview on the timeline.
- The browse scrapers depend on YouTube/Twitch page structures — if a channel page comes back empty, check
  `youtube.cjs itemsOf/headerOf` against a fresh `ytInitialData` first.
