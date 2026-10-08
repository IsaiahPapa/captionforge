// Fetches the Windows x64 native binaries that `npm install` skips on a
// non-Windows machine, so `electron-builder --win` can cross-build from macOS.
// They sit beside the host binaries; each package picks its own at runtime.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const modules = path.join(root, "node_modules");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function ensureFfmpeg() {
  const packageDir = path.join(modules, "ffmpeg-static");
  if (fs.existsSync(path.join(packageDir, "ffmpeg.exe"))) return;
  console.log("Downloading ffmpeg.exe (win32-x64)…");
  execFileSync(process.execPath, ["install.js"], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env, npm_config_platform: "win32", npm_config_arch: "x64" }
  });
}

function ensureSharp() {
  const { version } = require(path.join(modules, "sharp", "package.json"));
  const name = "@img/sharp-win32-x64";
  const target = path.join(modules, name);
  try {
    if (require(path.join(target, "package.json")).version === version) return;
  } catch {
    // Not installed yet.
  }
  console.log(`Fetching ${name}@${version}…`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-sharp-"));
  try {
    const tarball = execFileSync(npm, ["pack", `${name}@${version}`, "--silent"], {
      cwd: tempDir,
      encoding: "utf8",
      shell: process.platform === "win32"
    }).trim().split(/\r?\n/).at(-1);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    execFileSync("tar", ["-xzf", path.join(tempDir, tarball), "-C", target, "--strip-components=1"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

ensureFfmpeg();
ensureSharp();
