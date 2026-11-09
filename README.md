# Vodslice

Fast YouTube & Twitch VOD clipper for short-form editors. Paste a link, mark the parts you want, and get
`Gameplay.mp4` + `Facecam.mp4` in an auto-numbered folder — without downloading the whole 8-hour stream —
plus, if you want, a ready vertical Premiere Pro sequence with captions.

## Download

Windows 10/11: grab **`Vodslice-Setup-x.y.z.exe`** from the [latest release](https://github.com/timzrd/vodslice/releases/latest)
and run it (per-user install, desktop shortcut). The app downloads yt-dlp, FFmpeg and Deno on first start and
updates itself from this repository's releases.

> Working on the code with Claude? Start with [`CLAUDE.md`](CLAUDE.md) — it holds the full project context.

## Features

- **Only download what you need** – a parallel HLS downloader fetches just the segments of your time ranges
  (16 connections by default). A 2-minute 1080p60 part of an 8-hour VOD takes seconds.
- **Clips & segments** – `+ New clip` = separate output (own folder), `+ Segment` = another range that gets
  joined into the same clip (each range has its own color on the timeline).
- **Output modes** – every clip in its own numbered folder (`DrDonut 70`, `DrDonut 71`), all clips in one
  folder, or merge everything into one video.
- **Numbering** – auto (continues after the highest number in the main folder) or a manual counter per
  channel. The number can be overridden per download from the output chip.
- **Facecam export** – draw the box yourself or let it auto-detect (MediaPipe face detection + persistent
  overlay-border analysis across frames sampled from the whole VOD). The box is remembered per channel.
  Facecam is exported at native resolution with near-lossless x264 (CRF 10) — ideal input for AI upscalers.
- **Editor-safe** – YouTube 1440p+/AV1/VP9 is converted to H.264 on the GPU (NVENC) so every editor opens it.
  Twitch and native H.264 are cut losslessly.
- **Time picker** – press hours/minutes/seconds and move the mouse up/down (pointer is locked, no scroll
  wheel needed), or click and type. Paste `1:31:20` / `1h31m20s` anywhere in a field.
- **Timeline** – YouTube-style progress bar inside the video (clips glow in their colors, "most replayed"
  heatmap and thumbnails on hover) plus a zoomed lane below that stays centered on the playhead. Drag edges
  to set start/end — the preview jumps to that frame and shows an IN/OUT timecode. Ctrl+Z / Ctrl+Y undo/redo.
- **Twitch clips** – paste clip links (or use *Add link*) to collect them in the list next to VOD clips;
  download each into its own folder or merge everything into one video (mixed sources are normalized).
- **Crop window** – 9:16, 1:1, 4:3 or 16:9, resizable, snaps to the frame center (Alt = free).
- **Facecam positions over time** – streamer moved the cam? Add a new position at the playhead (person+ button);
  each position is used from its time on (diamond markers on the progress bar, right-click to remove).
  Hold Shift while resizing the box to keep its ratio.
- **Topaz Video AI** – optional facecam enhance after download (e.g. 2× Iris for faces) with editable presets
  (model, scale, auto/manual strengths, recover detail, grain). Uses Topaz's own bundled ffmpeg; progress shows
  in Downloads and the mini overlay.
- **Playback speed** – 1×–8× (Shift+. / Shift+,), L = Premiere-style shuttle (play, faster), K = stop.
- **Right-click** a clip in the lane or the list to delete it; drag single files (Gameplay / Facecam /
  Enhanced) from Downloads straight into Premiere.
- **Mini overlay** – always-on-top progress window; drag finished files straight into your editor.
- **Self-maintaining tools** – private copies of yt-dlp, FFmpeg and Deno (yt-dlp's JS runtime for YouTube)
  in `%APPDATA%\Vodslice\bin`, auto-updated. No PATH or registry setup needed.

## Premiere export

After a download (toggle **Premiere** next to the download button) Vodslice builds `premiere/` in the clip folder:
`<clip>.xml` (FCP7 XML → vertical 1440×1920 or 1440×2560 sequence: V1 gameplay filling the bottom, V2 facecam on
top without audio, V3 animated captions with alpha, A1 gameplay audio, empty SFX/Music tracks), `<clip>.srt`,
`<clip>.ass`, `<clip>_captions.mov` and `project.json`.

- **Open in Premiere** imports the XML into the open Premiere project (Premiere can't open XML from the command line,
  so Vodslice uses Premiere's Import dialog; the path is also on the clipboard).
- Captions are transcribed locally with whisper.cpp (CUDA build on NVIDIA, CPU otherwise, Silero VAD). Word starts
  are snapped to the real speech onsets in the audio, so captions appear exactly when someone talks.
- The caption editor (pencil in Downloads) fixes words and caption rhythm and rebuilds without transcribing again.
- Position math was calibrated in Premiere Pro 2026: FCP `center` = offset from the sequence center in units of
  the source clip size.

## Updates

Installed apps check this repository's GitHub releases on start and offer the update in the title bar
(electron-updater). Publish a new version with `npm run release [patch|minor|x.y.z] "notes"` — it bumps the
version, builds the installer, commits, pushes and creates the release (needs `gh` logged in).

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+V | Paste link (anywhere) |
| Space / J | Play-pause / −10 s |
| L / K | Play faster (Premiere-style shuttle) / stop |
| Shift+. / Shift+, | Speed up / down |
| ← / → | −5 s / +5 s (Shift: 1 s) |
| ↑ / ↓ / M | Volume ±5 % / mute |
| I / O | Set start / end of selected segment to playhead |
| N / Shift+N | New clip / add segment to selected clip |
| Del | Remove selected segment |
| Ctrl+Z / Ctrl+Y | Undo / redo clip edits |
| F / D | Facecam on-off / auto-detect |
| Ctrl+Enter | Download |
| Ctrl+Shift+O | Open output folder |

## Development

```bash
npm install
node node_modules/electron/install.js   # if npm skipped Electron's binary download
npm start                               # build renderer + run
npm test                                # self-test of the pure modules (any OS)
npm version patch && git push --follow-tags   # tag -> GitHub Actions builds + publishes the installer
```

Test harnesses live in `scripts/dev/`. Architecture, decisions and gotchas: [`CLAUDE.md`](CLAUDE.md).

Stack: Electron 45, React 19, Vite 8, hls.js, MediaPipe Tasks Vision, whisper.cpp, electron-updater.

## License

MIT — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
