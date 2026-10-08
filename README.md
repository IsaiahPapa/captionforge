# CaptionForge

A local-first desktop editor for creating styled subtitles for short-form video.

## Current vertical slice

- Electron + React desktop UI
- local Whisper transcription (bundled whisper.cpp) with word timestamps; models download on first use
- strict, non-overlapping word batches (three words by default)
- editable caption groups with one-click rebatching
- four style presets with installed fonts, italics, letter spacing, outline, shadow, and color controls
- top/center/bottom anchors with a precise vertical-offset slider
- searchable access to locally installed fonts
- synchronized video preview and active-word highlighting
- ASS-based burned-in export through FFmpeg
- automatic hardware encoder selection
- project save/open
- automatic local draft recovery

## Development prerequisites

- Node.js 22 or newer
- macOS: CMake (`brew install cmake`), used once to compile whisper.cpp with Metal

FFmpeg and ffprobe come from npm. `npm run dev` runs `scripts/fetch-whisper.cjs` first, which builds or downloads whisper.cpp into `vendor/whisper/<platform>-<arch>/` (skipped once present).

## Run

```bash
npm install
npm run dev
```

Choose a video, select a Whisper model, and transcribe. The first use of a model downloads it (checksummed) to `<userData>/models`; the picker shows which models are already downloaded. The original media is never changed.

## Build

```bash
npm run dist:mac   # release/CaptionForge-<version>-arm64.dmg
npm run dist:win   # release/CaptionForge Setup <version>.exe (Windows x64)
```

`dist:win` cross-builds from macOS (Wine required: `brew install --cask wine-stable`). It first fetches the Windows `ffmpeg.exe` and sharp binaries into `node_modules` beside the host ones; each package selects its own at runtime. Installers are unsigned, so Windows SmartScreen will warn on first launch (More info → Run anyway).

Both packages are self-contained: FFmpeg, ffprobe, and whisper.cpp ship inside the app, so nothing else needs installing. The Windows build uses the official whisper.cpp CPU release plus app-local MSVC runtime DLLs; the macOS build is compiled from the same version with Metal. Versions and checksums are pinned in `scripts/fetch-whisper.cjs`; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Environment

Set `CAPTIONFORGE_WHISPER_BIN` to use a different whisper.cpp `whisper-cli` binary.
