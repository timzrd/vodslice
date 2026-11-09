# Dev harnesses

| Script | What it checks |
| --- | --- |
| `headless-engine.cjs <url> [start] [end]` | Real engine download of a range (no Electron). |
| `premiere-pipeline.cjs <clip url>` | Download + whisper + caption alignment + overlay + FCP XML. |
| `caption-timing.cjs "<clip folder>"` | Word starts vs. speech starts in the audio (timing error). |
| `ui-test-example.cjs` | Electron test script: loads a VOD, drags a segment edge, saves screenshots. |
| `ui-walkthrough.cjs` | Electron test script for the v2 shell: home, name search + YouTube channel, morph into the editor, clips, wheel, context menu, scrub preview, Premiere preview, Twitch channel + chat activity. Back up `settings.json` and delete the test projects in `%APPDATA%\Vodslice\projects` afterwards. |

Headless scripts use `.devdata/` (gitignored) and copy/link the tool binaries from the installed app
(`%APPDATA%\Vodslice\bin`). UI tests run the real window off-screen via `VODSLICE_TEST_SCRIPT`.
