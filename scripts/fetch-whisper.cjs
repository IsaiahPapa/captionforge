// Places a self-contained whisper.cpp CLI in vendor/whisper/<platform>-<arch>/,
// which electron-builder copies into the app's resources.
//
//   node scripts/fetch-whisper.cjs            # this machine's platform
//   node scripts/fetch-whisper.cjs win32-x64  # cross-target from macOS
//
// darwin-arm64 is compiled from source (Metal, static, needs cmake);
// win32-x64 uses the official release binaries plus app-local MSVC runtime DLLs,
// since a fresh Windows install does not always have the VC++ redistributable.
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const WHISPER_VERSION = "1.9.5";
const WINDOWS_BINARIES = {
  // b5454 is the CI build of the v1.9.5 commit (d1be6fd).
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
  sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb"
};
// Microsoft's redistributable DLLs, as repackaged by conda-forge.
const MSVC_RUNTIME = [
  {
    url: "https://conda.anaconda.org/conda-forge/win-64/vc14_runtime-14.51.36247-habf1de7_41.conda",
    sha256: "4e4cb599cdc41bf2109d1464c127b5bcbddf548ce3e322e612afb691338b48f8",
    files: ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]
  },
  {
    url: "https://conda.anaconda.org/conda-forge/win-64/vcomp14-14.51.36247-habf1de7_41.conda",
    sha256: "731e043390c9457299484d39e427221fc868a9249540a498a5a4f6456c7744d1",
    files: ["vcomp140.dll"]
  }
];

const root = path.join(__dirname, "..");
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const outDir = path.join(root, "vendor", "whisper", target);
const stampPath = path.join(outDir, ".version");
const stamp = `${WHISPER_VERSION}\n`;

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

async function download(url, sha256, destination) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual !== sha256) throw new Error(`Checksum mismatch for ${url}\n  expected ${sha256}\n  received ${actual}`);
  fs.writeFileSync(destination, buffer);
}

function findFile(directory, name) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
      return path.join(entry.parentPath, entry.name);
    }
  }
  throw new Error(`${name} not found in ${directory}`);
}

async function buildDarwin(tempDir, stagingDir) {
  try {
    execFileSync("cmake", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("cmake is required to build whisper.cpp for macOS: brew install cmake");
  }
  const sourceDir = path.join(tempDir, "src");
  const buildDir = path.join(tempDir, "build");
  run("git", ["clone", "--quiet", "--depth", "1", "--branch", `v${WHISPER_VERSION}`,
    "https://github.com/ggml-org/whisper.cpp.git", sourceDir]);
  run("cmake", [
    "-S", sourceDir, "-B", buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DCMAKE_OSX_ARCHITECTURES=${target.endsWith("x64") ? "x86_64" : "arm64"}`,
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3",
    "-DBUILD_SHARED_LIBS=OFF",
    // Portable CPU code; Metal does the heavy lifting.
    "-DGGML_NATIVE=OFF",
    "-DGGML_METAL=ON",
    "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF"
  ]);
  run("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-cli",
    "-j", String(os.availableParallelism())]);
  fs.copyFileSync(path.join(buildDir, "bin", "whisper-cli"), path.join(stagingDir, "whisper-cli"));
  fs.chmodSync(path.join(stagingDir, "whisper-cli"), 0o755);
}

async function fetchWindows(tempDir, stagingDir) {
  const zipPath = path.join(tempDir, "whisper.zip");
  const extracted = path.join(tempDir, "whisper");
  await download(WINDOWS_BINARIES.url, WINDOWS_BINARIES.sha256, zipPath);
  fs.mkdirSync(extracted);
  run("tar", ["-xf", zipPath, "-C", extracted]);
  const releaseDir = path.dirname(findFile(extracted, "whisper-cli.exe"));
  for (const name of fs.readdirSync(releaseDir)) {
    // whisper-cli loads the best ggml-cpu-<variant>.dll for the host CPU at runtime.
    if (name === "whisper-cli.exe" || name === "whisper.dll" || /^ggml.*\.dll$/.test(name)) {
      fs.copyFileSync(path.join(releaseDir, name), path.join(stagingDir, name));
    }
  }

  for (const [index, runtime] of MSVC_RUNTIME.entries()) {
    const packagePath = path.join(tempDir, `runtime-${index}.conda`);
    const packageDir = path.join(tempDir, `runtime-${index}`);
    await download(runtime.url, runtime.sha256, packagePath);
    fs.mkdirSync(packageDir);
    run("tar", ["-xf", packagePath, "-C", packageDir]);
    const inner = fs.readdirSync(packageDir).find((name) => name.startsWith("pkg-") && name.endsWith(".tar.zst"));
    const tarPath = path.join(packageDir, "pkg.tar");
    fs.writeFileSync(tarPath, zlib.zstdDecompressSync(fs.readFileSync(path.join(packageDir, inner))));
    run("tar", ["-xf", tarPath, "-C", packageDir]);
    for (const name of runtime.files) {
      fs.copyFileSync(findFile(path.join(packageDir, "Library", "bin"), name), path.join(stagingDir, name));
    }
  }
}

async function main() {
  try {
    if (fs.readFileSync(stampPath, "utf8") === stamp) {
      console.log(`whisper.cpp ${WHISPER_VERSION} already present in vendor/whisper/${target}`);
      return;
    }
  } catch {
    // Not fetched yet.
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-whisper-"));
  const stagingDir = path.join(tempDir, "out");
  fs.mkdirSync(stagingDir);
  try {
    if (target.startsWith("darwin-")) await buildDarwin(tempDir, stagingDir);
    else if (target === "win32-x64") await fetchWindows(tempDir, stagingDir);
    else throw new Error(`No whisper.cpp recipe for ${target}`);
    fs.writeFileSync(path.join(stagingDir, ".version"), stamp);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(stagingDir, outDir, { recursive: true });
    console.log(`whisper.cpp ${WHISPER_VERSION} → vendor/whisper/${target}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
