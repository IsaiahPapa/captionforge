# CaptionForge architecture

## Why Electron

Electron is not the renderer. It is the secure desktop shell and process coordinator. The speed gain comes from native executables that a browser cannot freely invoke:

- FFmpeg decodes media, extracts mono 16 kHz audio, burns ASS captions, and hardware-encodes the output.
- Whisper performs local speech recognition with word timestamps.
- The React renderer handles editing and approximate real-time preview only.

This division keeps the UI responsive and lets the same TypeScript interface run on macOS and Windows.

## Process boundaries

```text
React renderer (sandboxed)
  │ narrow IPC API
  ▼
Electron main process
  ├── file dialogs / project persistence
  ├── ffprobe metadata
  ├── whisper.cpp process (+ model downloads)
  └── FFmpeg render process
```

The renderer has no Node integration and cannot execute arbitrary commands. All command arguments are arrays passed to `spawn`; user input is never interpolated into a shell command.

If Chromium cannot decode the source codec (common with ProRes and some HEVC exports), the editor automatically creates a temporary H.264 proxy. Final export always uses the original source.

## Transcription

whisper.cpp's `whisper-cli` ships inside the app (`resources/whisper`), pinned to one release in `scripts/fetch-whisper.cjs`:

- macOS (Apple Silicon): compiled from source as a static binary with an embedded Metal library.
- Windows x64: the official CPU release, which loads the best `ggml-cpu-*.dll` for the host CPU, plus app-local MSVC runtime DLLs so no redistributable install is needed.

Models (`electron/services/whisper-models.cjs`) download from Hugging Face on first use into `<userData>/models`, verified against pinned SHA-256 checksums, with a free-space check and cancellation. Turbo uses the 5-bit quantized `large-v3-turbo` weights.

Word timestamps come from whisper.cpp's DTW token alignment (`-dtw <preset>`). A token's DTW time marks its end, so each word starts where the previous token ended; after punctuation (which absorbs pauses) the heuristic token start is used when earlier. Against openai-whisper's word timestamps this differs by roughly 10–80 ms on average.

The UI and project format do not depend on the adapter.

## Export model

Caption styles compile to Advanced SubStation Alpha (ASS). Active-word highlighting is represented as short timed dialogue events. FFmpeg's `ass` filter composites those events and the output is encoded with:

1. `h264_videotoolbox` on macOS when available.
2. NVIDIA, Intel, or AMD H.264 encoders on Windows when detected.
3. `libx264` as the reliable fallback.

## Project format

`*.captionforge.json` contains:

- source media path and probed metadata;
- language;
- caption cues and word timestamps;
- complete style settings;
- schema version.

Source video is referenced, not copied. A future relink flow should handle moved media.

## Milestones after the vertical slice

1. GPU transcription on Windows (Vulkan or CUDA build selected by detected hardware).
2. Intel macOS build.
3. Add SRT/VTT/ASS import/export and subtitle-only alpha/green-screen output.
4. Add waveform, split/merge controls, draggable timing edges, keyboard editing, and undo/redo.
5. Add batch queue plus a CLI sharing the same pipeline service.
6. Add visual regression fixtures to compare browser preview frames with FFmpeg output.
7. Sign/notarize macOS builds and sign Windows installers.
