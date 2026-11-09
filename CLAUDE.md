# Vodslice — project handoff for Claude

Read this first. It is the complete context of how and why Vodslice was built (the original chat is gone).

## You are probably in a cloud session (Linux) — read this
Tim pairs new chats with this GitHub repo, not with his PC. So:
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
Electron desktop app: paste a YouTube/Twitch link (click the URL field = paste from clipboard) → mark clips on a
timeline → download only those parts fast → get `Gameplay.mp4` + `Facecam.mp4` in auto-numbered folders
(`DrDonut 70`, …) → optionally Topaz-enhanced facecam → optionally a ready **Premiere sequence** (FCP7 XML) with
local **captions**. Installed per-user via NSIS; updates itself from GitHub releases.

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
src/                   renderer (React 19 + Vite 8, plain JSX)
  App.jsx              all editor state: sources, clips (+undo), per-source facecam keys/crop/premiere rect, keys
  components/          Player (video + BoxEditor overlays), ScrubBar (in-video progress bar), Timeline (zoom lane),
                       TimeField (drag time picker), ClipList, Jobs (downloads + Open in Premiere), Mini (overlay),
                       Settings (+ TopazSettings, PremiereSettings), CaptionsEditor, UpdatePill, Volume, ui.jsx
  lib/facecam.js       MediaPipe face detection (WASM, offline) ; lib/camrect.js = border search (pure, testable)
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
  V3 caption overlay, A1 gameplay stereo, empty SFX/Music tracks. Facecam box is locked to the top-area ratio
  while the Premiere layout is on.
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

**Updates**
- `electron-updater`, GitHub provider `timzrd/vodslice` (public). Manual download from the title-bar pill, then
  restart. Artifact name has no spaces (`Vodslice-Setup-x.y.z.exe`) so latest.yml matches the uploaded asset.

## Where things live on Tim's PC
- Installed app: `%LOCALAPPDATA%\Programs\Vodslice`. Data: `%APPDATA%\Vodslice` (`settings.json`,
  `history.json`, `bin\` with yt-dlp/ffmpeg/deno and `bin\whisper\{cuda,cpu}` + models).
- Source: `C:\Users\timzu\Desktop\Vodslice` (this repo). His clips live in Google Drive ("Meine Ablage/projects").
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
- Possible next features Tim might like: Twitch chat-activity heatmap on the timeline, caption presets,
  auto-detect facecam position changes over time.
