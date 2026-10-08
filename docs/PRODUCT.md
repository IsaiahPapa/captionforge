# CaptionForge product brief

## Product promise

Turn a finished short-form video into a captioned publish-ready video without uploading footage or waiting on a browser renderer.

## Primary workflow

1. Drop or choose a local video.
2. Transcribe it locally with Whisper.
3. Correct the transcript in timed caption groups.
4. Choose a style preset and customize local fonts, typography, colors, anchored placement with fine vertical offsets, active-word highlighting, and motion.
5. Preview against the original video.
6. Export a burned-in MP4 using native FFmpeg, or save the editable project.

## MVP acceptance criteria

- Opens common short-form formats through FFmpeg.
- Generates word-level timestamps offline.
- Groups words into strict, non-overlapping batches so adjacent captions never leak into one another.
- Lets a user correct every caption group.
- Includes at least four reusable visual presets.
- Supports active-word color, top/center/bottom placement, uppercase, outline, and pop/fade transitions.
- Preview follows playback and highlights the current word.
- Exports an MP4 with audio and burned-in captions.
- Runs long jobs outside the UI process and supports cancellation.
- Saves and reopens a portable project file.
- Recovers the latest local draft automatically after a restart or crash.

## Deliberately deferred

- Batch queue and watch folders.
- Transparent subtitle-only exports.
- SRT/VTT/ASS import and export.
- Translation and transcript cleanup with a local LLM.
- Speaker detection.
- Cloud sync, accounts, licensing, and payments.
- Mobile or browser editions.

## Product principles

- Local by default: user footage and transcripts stay on the machine.
- Preview truthfulness: exported captions should closely match the editor.
- Fast defaults: one recommended model, one recommended style, hardware encoding automatically selected.
- Non-destructive: original media is never modified.
- Portable projects: project JSON points at source media and contains all captions and style settings.
