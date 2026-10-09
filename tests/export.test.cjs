const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ffmpegPath } = require("../electron/services/binaries.cjs");
const { probeMedia, renderVideo } = require("../electron/services/media.cjs");

test("an export that fails with every encoder rejects instead of reporting success", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-export-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const input = path.join(tempDir, "input.mp4");
  execFileSync(ffmpegPath, ["-loglevel", "error", "-f", "lavfi", "-i", "color=s=320x240:d=1", "-pix_fmt", "yuv420p", input]);
  const project = {
    version: 1,
    language: "en",
    video: await probeMedia(input),
    cues: [{ id: "c", start: 0, end: 1, text: "hello", words: [] }],
    style: {
      fontFamily: "Arial", fontSize: 32, fontWeight: 700, fontStyle: "normal", letterSpacing: 0,
      primaryColor: "#ffffff", activeColor: "#ffff00", outlineColor: "#000000", outlineWidth: 2, shadow: 0,
      position: "center", marginPercent: 10, verticalOffsetPercent: 0, uppercase: false,
      highlightActiveWord: false, transition: "none"
    }
  };
  const unwritable = path.join(tempDir, "missing-directory", "out.mp4");
  for (const codec of ["h264", "hevc"]) {
    for (const hardwareAcceleration of [true, false]) {
      const progress = [];
      await assert.rejects(
        renderVideo(project, unwritable, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) }, { codec, hardwareAcceleration }),
        `${codec} (hardware ${hardwareAcceleration}) should reject`
      );
      assert.ok(!progress.some((p) => p.stage === "complete"));
    }
  }
});

test("measures videos whose container stores no duration", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-probe-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const webm = path.join(tempDir, "streamed.webm");
  // Writing to a pipe prevents the muxer from going back to record a duration.
  const bytes = execFileSync(ffmpegPath, [
    "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x120:d=2:r=25",
    "-c:v", "libvpx", "-deadline", "realtime", "-f", "webm", "pipe:1"
  ], { maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(webm, bytes);
  const video = await probeMedia(webm);
  assert.ok(Math.abs(video.duration - 2) < 0.1, `expected ~2s, got ${video.duration}`);
});

test("explains files that are not videos", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-probe-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const notes = path.join(tempDir, "notes.mp4");
  fs.writeFileSync(notes, "definitely not a video");
  await assert.rejects(probeMedia(notes), /“notes\.mp4” couldn't be opened as a video/);
  const audio = path.join(tempDir, "voice.m4a");
  execFileSync(ffmpegPath, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", audio]);
  await assert.rejects(probeMedia(audio), /“voice\.m4a” has no video track/);
});
