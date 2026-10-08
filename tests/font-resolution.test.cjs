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
