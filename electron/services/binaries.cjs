const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function unpackedPath(filePath) {
  if (!filePath) return null;
  const candidate = filePath.replace("app.asar", "app.asar.unpacked");
  return candidate !== filePath && fs.existsSync(candidate) ? candidate : filePath;
}

function materializePackagedBinary(filePath, name) {
  if (process.platform !== "darwin" || !filePath.includes("app.asar.unpacked")) return filePath;
  const stat = fs.statSync(filePath);
  const binDir = path.join(os.tmpdir(), "captionforge-media-binaries");
  const target = path.join(binDir, `${name}-${stat.size}`);
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  try {
    if (fs.statSync(target).size === stat.size) return target;
  } catch {
    // This packaged binary has not been materialized yet.
  }
  fs.copyFileSync(filePath, target);
  fs.chmodSync(target, 0o700);
  return target;
}

const ffmpegPath = process.env.CAPTIONFORGE_FFMPEG_BIN
  || materializePackagedBinary(unpackedPath(require("ffmpeg-static")), "ffmpeg")
  || "ffmpeg";
const ffprobePath = process.env.CAPTIONFORGE_FFPROBE_BIN
  || materializePackagedBinary(unpackedPath(require("ffprobe-static").path), "ffprobe")
  || "ffprobe";

// Packaged builds carry whisper.cpp in resources/whisper (see extraResources);
// development uses the copy placed by scripts/fetch-whisper.cjs.
function resolveWhisperCliPath() {
  if (process.env.CAPTIONFORGE_WHISPER_BIN) return process.env.CAPTIONFORGE_WHISPER_BIN;
  const executable = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, "whisper", executable),
    path.join(__dirname, "..", "..", "vendor", "whisper", `${process.platform}-${process.arch}`, executable)
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const whisperCliPath = resolveWhisperCliPath();

module.exports = { ffmpegPath, ffprobePath, whisperCliPath, materializePackagedBinary };
