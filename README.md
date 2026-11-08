# Vodslice

Fast YouTube & Twitch VOD clipper for short-form editors. Paste a link, mark the parts you want, and get
`Gameplay.mp4` + `Facecam.mp4` in an auto-numbered folder — without downloading the whole 8-hour stream.

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
- **Gameplay 9:16** – optional vertical crop with a draggable crop window.
- **Editor-safe** – YouTube 1440p+/AV1/VP9 is converted to H.264 on the GPU (NVENC) so every editor opens it.
  Twitch and native H.264 are cut losslessly.
- **Time picker** – press hours/minutes/seconds and move the mouse up/down (pointer is locked, no scroll
  wheel needed), or click and type. Paste `1:31:20` / `1h31m20s` anywhere in a field.
- **Timeline** – overview of the whole VOD (YouTube "most replayed" heatmap, hover thumbnails), zoomed lane
  to drag/resize segments, drag on empty space to add one, snapping to playhead and other edges.
- **Mini overlay** – always-on-top progress window; drag finished files straight into your editor.
- **Self-maintaining tools** – private copies of yt-dlp, FFmpeg and Deno (yt-dlp's JS runtime for YouTube)
  in `%APPDATA%\Vodslice\bin`, auto-updated. No PATH or registry setup needed.

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+V | Paste link (anywhere) |
| Space / J / L | Play-pause / −10 s / +10 s |
| ← / → | −5 s / +5 s (Shift: 1 s) |
| I / O | Set start / end of selected segment to playhead |
| N / Shift+N | New clip / add segment to selected clip |
| Del | Remove selected segment |
| F / D | Facecam on-off / auto-detect |
| Ctrl+Enter | Download |
| Ctrl+Shift+O | Open output folder |

## Development

```bash
npm install
node node_modules/electron/install.js   # if npm skipped Electron's binary download
npm start                               # build renderer + run
npm run dist                            # Windows installer in release/
```

`electron-builder` fails on very long paths (NSIS include limit); build from a short path if needed.

Stack: Electron 45, React 19, Vite 8, hls.js, MediaPipe Tasks Vision. Main process modules live in
`electron/` (`engine.cjs` = job pipeline, `hls.cjs` = parallel range downloader, `tools.cjs` = tool
manager, `probe.cjs` = yt-dlp info + format selection, `naming.cjs` = folder numbering).
