const { runProcess } = require("./process.cjs");
const subsetFont = require("subset-font");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const FALLBACK_FONTS = [
  "Arial",
  "Arial Black",
  "Georgia",
  "Helvetica Neue",
  "Impact",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana"
];

let macTypefacesPromise;
let windowsFontsPromise;

const WINDOWS_FONT_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"
];
// Words that name a face within a family ("Arial Bold Italic"). Anything else
// ("Arial Narrow") is a different family and must not match.
const FACE_STYLE_WORDS = new Set([
  "regular", "normal", "book", "roman", "italic", "oblique",
  "thin", "hairline", "extralight", "ultralight", "light", "semilight", "medium",
  "semibold", "demibold", "bold", "extrabold", "ultrabold", "black", "heavy",
  "extra", "ultra", "semi", "demi"
]);

function styleWeight(style) {
  const normalized = String(style || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized.includes("black") || normalized.includes("heavy")) return 900;
  if (normalized.includes("extrabold") || normalized.includes("ultrabold")) return 800;
  if (normalized.includes("semibold") || normalized.includes("demibold")) return 600;
  if (normalized.includes("bold")) return 700;
  if (normalized.includes("medium")) return 500;
  if (normalized.includes("extralight") || normalized.includes("ultralight")) return 200;
  if (normalized.includes("light")) return 300;
  if (normalized.includes("thin")) return 100;
  return 400;
}

function selectFontFace(typefaces, family, weight, italic) {
  const requestedFamily = String(family || "").trim().toLowerCase();
  const requestedWeight = Math.max(100, Math.min(900, Number(weight) || 400));
  const matches = typefaces.filter((typeface) =>
    String(typeface.family || "").trim().toLowerCase() === requestedFamily
  );
  if (!matches.length) return null;
  return matches
    .map((typeface) => {
      const style = String(typeface.style || "");
      const isItalic = /italic|oblique/i.test(style);
      return {
        typeface,
        score: Math.abs(styleWeight(style) - requestedWeight) + (isItalic === Boolean(italic) ? 0 : 1000)
      };
    })
    .sort((a, b) => a.score - b.score)[0].typeface;
}

async function loadMacTypefaces() {
  if (!macTypefacesPromise) {
    macTypefacesPromise = runProcess("system_profiler", ["SPFontsDataType", "-json", "-detailLevel", "mini"])
      .then(({ stdout }) => {
        const payload = JSON.parse(stdout);
        return (payload.SPFontsDataType || []).flatMap((font) => font.typefaces || []);
      });
  }
  return macTypefacesPromise;
}

// Parses `reg query` output for the Fonts key into { name, file } entries.
// Names are full face names ("Arial Bold Italic"); TrueType collections list
// several joined with " & ".
function parseWindowsFontRegistry(stdout, systemFontsDirectory) {
  const fonts = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}(.+?)\s*$/.exec(line);
    if (!match) continue;
    const file = path.win32.isAbsolute(match[2]) ? match[2] : path.win32.join(systemFontsDirectory, match[2]);
    if (![".ttf", ".otf", ".ttc"].includes(path.win32.extname(file).toLowerCase())) continue;
    const names = match[1].replace(/\s*\((?:TrueType|OpenType|All res)\)$/i, "").split(" & ");
    for (const name of names) fonts.push({ name: name.trim(), file });
  }
  return fonts;
}

function selectWindowsFontFace(fonts, family, weight, italic) {
  const requestedFamily = String(family || "").trim().toLowerCase();
  const typefaces = fonts.flatMap((font) => {
    const name = font.name.toLowerCase();
    if (name !== requestedFamily && !name.startsWith(`${requestedFamily} `)) return [];
    const style = font.name.slice(requestedFamily.length).trim();
    const words = style.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((word) => FACE_STYLE_WORDS.has(word))) return [];
    return [{ family: requestedFamily, style, fullname: font.name, file: font.file }];
  });
  return selectFontFace(typefaces, requestedFamily, weight, italic);
}

async function loadWindowsFonts() {
  if (!windowsFontsPromise) {
    const systemFontsDirectory = path.win32.join(process.env.WINDIR || "C:\\Windows", "Fonts");
    windowsFontsPromise = Promise.all(WINDOWS_FONT_KEYS.map((key) =>
      runProcess("reg.exe", ["query", key])
        .then(({ stdout }) => parseWindowsFontRegistry(stdout, systemFontsDirectory))
        .catch(() => [])
    )).then((lists) => lists.flat());
  }
  return windowsFontsPromise;
}

// Returns { name, file } for the installed face closest to the request, where
// `name` is the face's full name for libass and `file` (Windows only) is the
// font file to hand libass directly, since its system font lookup there
// depends on how FFmpeg was built.
async function resolveFontFace(family, weight, fontStyle) {
  const italic = fontStyle === "italic";
  try {
    if (process.platform === "darwin") {
      const face = selectFontFace(await loadMacTypefaces(), family, weight, italic);
      return face ? { name: String(face.fullname || face.family || family).trim(), file: null } : null;
    }
    if (process.platform === "win32") {
      const face = selectWindowsFontFace(await loadWindowsFonts(), family, weight, italic);
      return face ? { name: face.fullname, file: face.file } : null;
    }
  } catch {
    // Fall through to the raster renderer.
  }
  return null;
}

// Copies one font file into a private directory for the ASS filter's fontsdir.
async function stageFontFile(fontFile, tempDir) {
  const directory = path.join(tempDir, "face-font");
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(fontFile, path.join(directory, path.basename(fontFile)));
    return directory;
  } catch {
    return null;
  }
}

async function resolveUserFontDirectory() {
  const candidates = process.platform === "darwin"
    ? [path.join(os.homedir(), "Library", "Fonts")]
    : process.platform === "win32"
      ? [path.join(process.env.LOCALAPPDATA || os.homedir(), "Microsoft", "Windows", "Fonts")]
      : [path.join(os.homedir(), ".local", "share", "fonts"), path.join(os.homedir(), ".fonts")];
  for (const directory of candidates) {
    try {
      await fs.access(directory);
      return directory;
    } catch {
      // Keep looking for a user font directory that exists on this machine.
    }
  }
  return null;
}

function fontFileMatchesFamily(fileName, family) {
  const extension = path.extname(fileName).toLowerCase();
  if (![".ttf", ".otf", ".ttc"].includes(extension)) return false;
  const normalizedFamily = String(family || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedFile = path.basename(fileName, extension).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalizedFamily || !normalizedFile.startsWith(normalizedFamily)) return false;
  const suffix = normalizedFile.slice(normalizedFamily.length);
  return !suffix || /^(variablefont|roman|regular|italic|oblique|thin|extralight|ultralight|light|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)/.test(suffix);
}

async function resolveUserFontFile(family) {
  const directory = await resolveUserFontDirectory();
  if (!directory) return null;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && fontFileMatchesFamily(entry.name, family));
    return match ? path.join(directory, match.name) : null;
  } catch {
    return null;
  }
}

async function createStaticFontInstance(fontFile, weight, tempDir, text = "") {
  if (!fontFile) return null;
  const fontDirectory = path.join(tempDir, "font-instance");
  const requestedWeight = Math.max(100, Math.min(900, Number(weight) || 400));
  const outputPath = path.join(fontDirectory, `captionforge-${requestedWeight}.ttf`);
  try {
    await fs.mkdir(fontDirectory, { recursive: true });
    const fontBuffer = await fs.readFile(fontFile);
    const staticFont = await subsetFont(fontBuffer, `${text}\n 0123456789`, {
      targetFormat: "sfnt",
      preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 16, 17],
      variationAxes: { wght: requestedWeight }
    });
    await fs.writeFile(outputPath, staticFont);
    await fs.access(outputPath);
    return fontDirectory;
  } catch {
    return null;
  }
}

async function listSystemFonts() {
  try {
    let families = [];
    if (process.platform === "darwin") {
      families = (await loadMacTypefaces()).map((typeface) => typeface.family);
    } else if (process.platform === "win32") {
      const script = "Add-Type -AssemblyName PresentationCore; [Windows.Media.Fonts]::SystemFontFamilies.Source";
      const { stdout } = await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      families = stdout.split(/\r?\n/);
    } else {
      const { stdout } = await runProcess("fc-list", [":", "family"]);
      families = stdout.split(/\r?\n/).map((line) => line.split(",")[0]);
    }
    return [...new Set([...FALLBACK_FONTS, ...families]
      .map((family) => String(family || "").trim())
      .filter((family) => family && !family.startsWith(".")))]
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return FALLBACK_FONTS;
  }
}

module.exports = {
  listSystemFonts,
  parseWindowsFontRegistry,
  resolveFontFace,
  selectWindowsFontFace,
  stageFontFile,
  resolveUserFontDirectory,
  resolveUserFontFile,
  createStaticFontInstance,
  fontFileMatchesFamily,
  selectFontFace,
  styleWeight
};
