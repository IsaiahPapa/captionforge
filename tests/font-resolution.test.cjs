const test = require("node:test");
const assert = require("node:assert/strict");
const { fontFileMatchesFamily, selectFontFace, styleWeight } = require("../electron/services/fonts.cjs");

const appleFaces = [
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo Regular", style: "Regular" },
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo Medium", style: "Medium" },
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo SemiBold", style: "SemiBold" },
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo Bold", style: "Bold" },
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo ExtraBold", style: "ExtraBold" },
  { family: "Apple SD Gothic Neo", fullname: "Apple SD Gothic Neo Heavy", style: "Heavy" }
];

test("maps named font styles to CSS-style numeric weights", () => {
  assert.equal(styleWeight("Thin"), 100);
  assert.equal(styleWeight("Extra Light"), 200);
  assert.equal(styleWeight("SemiBold"), 600);
  assert.equal(styleWeight("ExtraBold"), 800);
  assert.equal(styleWeight("Black"), 900);
});

test("selects the exact installed face instead of letting libass clamp Black to Bold", () => {
  assert.equal(
    selectFontFace(appleFaces, "Apple SD Gothic Neo", 900, false)?.fullname,
    "Apple SD Gothic Neo Heavy"
  );
  assert.equal(
    selectFontFace(appleFaces, "Apple SD Gothic Neo", 600, false)?.fullname,
    "Apple SD Gothic Neo SemiBold"
  );
});

test("returns no face when the selected family is unavailable", () => {
  assert.equal(selectFontFace(appleFaces, "Missing Font", 700, false), null);
});

test("recognizes user font files including variable font filenames", () => {
  assert.equal(fontFileMatchesFamily("Inter-VariableFont_opsz,wght.ttf", "Inter"), true);
  assert.equal(fontFileMatchesFamily("Inter-Italic-VariableFont_opsz,wght.ttf", "Inter"), true);
  assert.equal(fontFileMatchesFamily("InterTight-VariableFont_opsz,wght.ttf", "Inter"), false);
  assert.equal(fontFileMatchesFamily("Inter-VariableFont_opsz,wght.txt", "Inter"), false);
  assert.equal(fontFileMatchesFamily("Roboto-Bold.ttf", "Inter"), false);
});

const REG_OUTPUT = [
  "",
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "    Arial (TrueType)    REG_SZ    arial.ttf",
  "    Arial Bold (TrueType)    REG_SZ    arialbd.ttf",
  "    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf",
  "    Arial Italic (TrueType)    REG_SZ    ariali.ttf",
  "    Arial Black (TrueType)    REG_SZ    ariblk.ttf",
  "    Arial Narrow (TrueType)    REG_SZ    ARIALN.TTF",
  "    Cambria & Cambria Math (TrueType)    REG_SZ    cambria.ttc",
  "    Segoe UI Semibold (TrueType)    REG_SZ    seguisb.ttf",
  "    Segoe UI (TrueType)    REG_SZ    segoeui.ttf",
  "    Modern (All res)    REG_SZ    modern.fon",
  "    Inter Variable (TrueType)    REG_SZ    C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts\\Inter.ttf",
  ""
].join("\r\n");

test("parses the Windows font registry into face names and files", () => {
  const { parseWindowsFontRegistry } = require("../electron/services/fonts.cjs");
  const fonts = parseWindowsFontRegistry(REG_OUTPUT, "C:\\Windows\\Fonts");
  assert.deepEqual(fonts.find((font) => font.name === "Arial Bold"), { name: "Arial Bold", file: "C:\\Windows\\Fonts\\arialbd.ttf" });
  assert.deepEqual(fonts.filter((font) => font.file.endsWith("cambria.ttc")).map((font) => font.name), ["Cambria", "Cambria Math"]);
  assert.equal(fonts.find((font) => font.name === "Inter Variable").file, "C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts\\Inter.ttf");
  assert.ok(!fonts.some((font) => font.name === "Modern"), "bitmap .fon fonts are skipped");
});

test("selects the closest Windows face without crossing into other families", () => {
  const { parseWindowsFontRegistry, selectWindowsFontFace } = require("../electron/services/fonts.cjs");
  const fonts = parseWindowsFontRegistry(REG_OUTPUT, "C:\\Windows\\Fonts");
  const pick = (family, weight, italic = false) => selectWindowsFontFace(fonts, family, weight, italic)?.fullname ?? null;
  assert.equal(pick("Arial", 400), "Arial");
  assert.equal(pick("Arial", 700), "Arial Bold");
  assert.equal(pick("Arial", 800, true), "Arial Bold Italic");
  assert.equal(pick("Arial Black", 900), "Arial Black");
  assert.equal(pick("Segoe UI", 600), "Segoe UI Semibold");
  assert.equal(pick("arial", 400), "Arial", "family match is case-insensitive");
  assert.equal(pick("Helvetica Neue", 700), null);
  assert.notEqual(pick("Arial", 400), "Arial Narrow");
});
