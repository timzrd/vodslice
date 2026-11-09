# Third-party software

Bundled in the app:
- **Electron** (MIT), **React** (MIT), **hls.js** (Apache-2.0), **electron-updater** (MIT)
- **MediaPipe Tasks Vision** runtime + BlazeFace face detector models in `public/models/` (Apache-2.0, Google)

Downloaded on first use from their official releases (not part of this repository):
- **yt-dlp** (Unlicense) — github.com/yt-dlp/yt-dlp
- **FFmpeg** builds from github.com/yt-dlp/FFmpeg-Builds (GPL)
- **Deno** (MIT) — JavaScript runtime yt-dlp needs for YouTube
- **whisper.cpp** (MIT) and the ggml Whisper models (MIT, OpenAI) + Silero VAD model (MIT)

Used only if installed and licensed by the user:
- **Topaz Video AI** — Vodslice calls the user's own installation.
- **Adobe Premiere Pro** — Vodslice writes standard FCP7 XML and uses Premiere's import dialog.

Downloading content may be restricted by a site's terms of service; only download what you have the rights to use.
