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

- **Home / Browse / Edit / Premiere / Downloads** – projects are saved automatically (facecam box, clips, playhead) and listed on Home.
  Type a streamer's name in the top bar, pick YouTube or Twitch, and browse a recreated channel page (banner,
  subscribers, Videos/Streams or Past broadcasts/Highlights/Clips, endless grid). Click a stream and it flies
  into the editor.
- **Editor like an NLE** – media bin left, player, clips + export right, timeline with video thumbnails below.
  Mouse wheel scrolls the timeline, Ctrl + wheel zooms at the cursor, dragging near an edge keeps scrolling.
- **Pick what to download** – every clip has a checkbox; Download takes the checked ones, right-click a clip to
  download just that one. Downloaded clips stay in the list (✓) and get unchecked.
- **Chat highlights** – Twitch VODs get a chat-activity graph on the timeline with the most spammed emote at each
  peak (KEKW, OMEGALUL, …; 7TV/BTTV/FFZ included) — click an emote to jump there. YouTube shows "most replayed".
- **Chat overlay** – optional `Chat.mov` per clip with a transparent background: colored names and 7TV/BTTV/FFZ
  emotes, from Twitch VODs, Twitch clips (via their VOD) and YouTube streams with chat replay. Drop it on top of
  your edit — the Premiere sequence gets it on its own track.
- **Made for hotkeys** – right hand on J K L (back / play-pause / faster), U I O for marker / IN / OUT. I…O, I…O
  cuts clip after clip; markers (U) are snap points and jump targets (`,` `.`). F1 shows the whole keyboard.
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
- **Facecam positions over time** – streamer moved the cam? Add a new position at the playhead (person+ button);
  each position is used from its time on (diamond markers on the progress bar, right-click to remove).
  Hold Shift while resizing the box to keep its ratio.
- **Topaz Video AI** – optional facecam enhance after download (e.g. 2× Iris for faces) with editable presets
  (model, scale, auto/manual strengths, recover detail, grain). Uses Topaz's own bundled ffmpeg; progress shows
  in Downloads and the mini overlay.
- **Playback speed** – 1×–8× (Shift+. / Shift+,), L = Premiere-style shuttle (play, faster), K = stop.
- **Downloads tab** – every running and finished download with its pipeline (Download → Cut → Chat → Enhance →
  Captions + Premiere), each step in its own color; "Clip ready" shows as soon as the files exist while Topaz or
  the captions are still working. Earlier downloads are listed too. The small panel in the title bar stays.
- **Right-click** a clip in the lane or the list to delete it; drag single files (Gameplay / Facecam /
  Enhanced) from Downloads straight into Premiere.
- **Mini overlay** – always-on-top progress window; drag finished files straight into your editor.
- **Self-maintaining tools** – private copies of yt-dlp, FFmpeg and Deno (yt-dlp's JS runtime for YouTube)
  in `%APPDATA%\Vodslice\bin`, auto-updated. No PATH or registry setup needed.

## Premiere tab (layout + captions)

Design the vertical video once, save it as a preset, and every download gets a Premiere sequence that looks exactly
like the canvas:

- **Full-screen canvas** with the live video from Edit (or a downloaded clip with its real files + transcript).
  Drag and resize gameplay, facecam, chat and captions; they snap to edges, centers and each other (Alt = free,
  Shift = keep ratio). Layers can overlap — e.g. the facecam over the top of the gameplay — and are reordered in the
  layer list (that order becomes the Premiere track order).
- **Framing** – double-click gameplay or facecam to choose which part fills its box (pan + zoom, the rest of the
  source is shown dimmed, the center snaps magnetically). The facecam box from Edit can be any size: it is always scaled to fill its layout box.
- **Presets** – compact list top left; **+** asks for name, format (9:16, 3:4, 4:5, 1:1), resolution (HD / 2K / 4K,
  e.g. 2160×3840) and a starting layout — or paste a code / load a `.vspreset` file someone sent you. Every preset
  can be shared as a short code or a file. Pick the preset right in Edit's export panel.
- **Layers** bottom left, reorder by dragging the ⋮⋮ grip (same for text effects).
- **Cam edge** – a line, a soft shadow onto the gameplay, a glow line or a frame at the facecam; lands as its own track.
- **Safe zones** – a mock of the TikTok / Shorts / Reels interface (buttons, name, caption) on top of the canvas.
- **Captions in Premiere** – *Finished look* (a video track with font, effects, animation) or *Editable text*: the
  .srt becomes an editable Premiere captions track and an After Effects script builds real text layers in the
  preset's font and position ("Ae" button). Bundled fonts can be installed for Premiere/AE with one click.
- **Caption style** – looks (Punch, Clean, Neon, Boxed, Highlight, Comic, Gamer, Soft), a font browser that shows every
  installed font plus 18 bundled caption fonts with a sample word (search, favorites, ↑/↓ previews live on the
  video), weight, size, case, letter spacing, spoken-word highlight (color / box / grow), words per caption.
- **Text effects** (finished look) as a stack — stroke, drop shadow, deep glow, background box, 3D extrude — added from
  preview tiles in the Effects tab, each with its own settings, order (drag) and on/off.
- **Motion** – in: fade, pop, bounce, rise, slide, zoom, blur; out: fade, sink, shrink, blur; whole caption or
  word by word; speed.
- Undo/redo (Ctrl+Z / Ctrl+Y), arrows nudge, Tab cycles layers, Space plays.

## Premiere export

After a download (toggle **Premiere sequence** in the export panel) Vodslice builds `premiere/` in the clip folder
with the active preset: `<clip>.xml` (FCP7 XML → vertical sequence, one video track per layer in layer order,
gameplay audio on A1, empty SFX/Music tracks), `<clip>.srt`, `<clip>_captions.mov` (animated captions with alpha,
drawn by the same code as the Premiere tab) and `project.json`. With the chat layer on, `Chat.mov` is rendered at
the exact size of its box. A small live view of the layout runs in the corner of the player (click it to open the
Premiere tab).

- **Open in Premiere** imports the XML into the open Premiere project (Premiere can't open XML from the command line,
  so Vodslice uses Premiere's Import dialog; the path is also on the clipboard).
- Captions are transcribed locally with whisper.cpp (CUDA build on NVIDIA, CPU otherwise, Silero VAD). Word starts
  are snapped to the real speech onsets in the audio, so captions appear exactly when someone talks.
- The caption editor (pencil in Downloads) fixes words and caption rhythm and rebuilds without transcribing again.
  "Preview layout" opens a downloaded clip in the Premiere tab; **Apply to clip** rebuilds it with the current preset.
- Settings, presets, favorite fonts and the output folder live in `%APPDATA%\Vodslice` and survive updates.
- Position math was calibrated in Premiere Pro 2026: FCP `center` = offset from the sequence center in units of
  the source clip size.

## Updates

Installed apps check this repository's GitHub releases on start and offer the update in the title bar
(electron-updater). Publish a new version with `npm run release [patch|minor|x.y.z] "notes"` — it bumps the
version, builds the installer, commits, pushes and creates the release (needs `gh` logged in).

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+V | Paste a video or channel link (anywhere) |
| Ctrl+K / Ctrl+F | Search a streamer |
| Space / K | Play / pause (any pause resets the speed) |
| J | −10 s (Shift: −2 s) |
| L | Play, then 2× / 4× / 8× |
| U | Marker at the playhead (again to remove) |
| , / . | Previous / next marker |
| P | Play the selected clip |
| Shift+. / Shift+, | Speed up / down |
| F1 | Keyboard map |
| ← / → | −5 s / +5 s (Shift: 1 s) |
| ↑ / ↓ / M | Volume ±5 % / mute |
| I / O | Selected clip: trim start / end · otherwise IN, then O creates the clip (next I starts a new one) |
| N / Shift+N | New clip / add part to selected clip |
| S | Split the selected clip at the playhead |
| Esc | Deselect |
| Del | Delete selected clip (or part) |
| Ctrl+A | Check / uncheck all clips |
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
