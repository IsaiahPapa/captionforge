const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_EXPORT_SETTINGS,
  exportDimensions,
  normalizeExportSettings
} = require("../electron/services/media.cjs");

test("uses safe, compatible export defaults", () => {
  assert.deepEqual(normalizeExportSettings(), DEFAULT_EXPORT_SETTINGS);
  assert.deepEqual(normalizeExportSettings({
    resolution: "bogus",
    quality: "huge",
    codec: "vp9",
    frameRate: 48,
    audioBitrate: 500
  }), DEFAULT_EXPORT_SETTINGS);
});

test("preserves aspect ratio and never upscales resolution presets", () => {
  assert.deepEqual(exportDimensions({ width: 1080, height: 1920 }, "720"), {
    width: 720,
    height: 1280
  });
  assert.deepEqual(exportDimensions({ width: 3840, height: 2160 }, "1080"), {
    width: 1920,
    height: 1080
  });
  assert.deepEqual(exportDimensions({ width: 720, height: 1280 }, "1080"), {
    width: 720,
    height: 1280
  });
});

test("accepts the supported quality, codec, frame-rate, and audio choices", () => {
  assert.deepEqual(normalizeExportSettings({
    resolution: "720",
    quality: "high",
    codec: "hevc",
    frameRate: "60",
    hardwareAcceleration: false,
    audioBitrate: 320
  }), {
    resolution: "720",
    quality: "high",
    codec: "hevc",
    frameRate: "60",
    hardwareAcceleration: false,
    audioBitrate: 320
  });
});
