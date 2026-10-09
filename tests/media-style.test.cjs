const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAss, buildAssFilter } = require("../electron/services/media.cjs");

function makeProject(stylePatch = {}) {
  return {
    video: { width: 1080, height: 1920 },
    cues: [{
      id: "cue-1",
      start: 0,
      end: 1.5,
      text: "one two three",
      words: [
        { id: "one", text: "one", start: 0, end: 0.5 },
        { id: "two", text: "two", start: 0.5, end: 1 },
        { id: "three", text: "three", start: 1, end: 1.5 }
      ]
    }],
    style: {
      fontFamily: "Arial",
      fontSize: 72,
      fontWeight: 800,
      fontStyle: "normal",
      letterSpacing: 0,
      primaryColor: "#ffffff",
      activeColor: "#ffff00",
      outlineColor: "#000000",
      outlineWidth: 4,
      shadow: 2,
      position: "center",
      marginPercent: 10,
      verticalOffsetPercent: 0,
      uppercase: false,
      highlightActiveWord: true,
      transition: "pop",
      ...stylePatch
    }
  };
}

test("pop styling never scales an individual word or changes its advance width", () => {
  const project = makeProject();
  const ass = buildAss(project);
  assert.doesNotMatch(ass, /\\fsc[xy]/);
  const dialogueLines = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogueLines.length, 3);
  // Plain spaces (not \h) so libass can wrap long captions like the preview does.
  assert.ok(dialogueLines.every((line) => !line.includes("\\h")));
});

test("vertical offsets and typography are compiled into ASS output", () => {
  const project = makeProject({
    position: "center",
    verticalOffsetPercent: 5,
    fontStyle: "italic",
    letterSpacing: 3
  });
  const ass = buildAss(project);

  assert.match(ass, /\{\\an5\\pos\(540,864\)\}/);
  assert.match(ass, /Style: Default,Arial,72,[^\n]+,800,-1,0,0,100,100,3,0,1,/);
});

test("preserves the selected numeric font weight for the export renderer", () => {
  for (const weight of [400, 500, 700, 800, 900]) {
    const styleLine = buildAss(makeProject({ fontWeight: weight }))
      .split("\n")
      .find((line) => line.startsWith("Style: Default"));
    assert.ok(styleLine?.includes(`&H90000000,${weight},`));
  }
});

test("top, center, and bottom anchors all honor vertical offsets", () => {
  const cases = [
    [{ position: "top", verticalOffsetPercent: -5 }, /\{\\an8\\pos\(540,288\)\}/],
    [{ position: "center", verticalOffsetPercent: 5 }, /\{\\an5\\pos\(540,864\)\}/],
    [{ position: "bottom", marginPercent: 14, verticalOffsetPercent: 5 }, /\{\\an2\\pos\(540,1555\)\}/]
  ];

  for (const [stylePatch, expectedPosition] of cases) {
    assert.match(buildAss(makeProject(stylePatch)), expectedPosition);
  }
});

test("active-word changes lead timestamps by 120ms without starting before the cue", () => {
  const dialogueLines = buildAss(makeProject())
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"));

  assert.match(dialogueLines[0], /^Dialogue: 0,0:00:00\.00,0:00:00\.38,/);
  assert.match(dialogueLines[1], /^Dialogue: 0,0:00:00\.38,0:00:00\.88,/);
  assert.match(dialogueLines[2], /^Dialogue: 0,0:00:00\.88,0:00:01\.50,/);
});

test("active-word timing can be tuned earlier or later", () => {
  const earlyLines = buildAss(makeProject({ wordTimingOffsetMs: 250 }))
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"));
  const lateLines = buildAss(makeProject({ wordTimingOffsetMs: -100 }))
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"));

  assert.match(earlyLines[1], /^Dialogue: 0,0:00:00\.25,0:00:00\.75,/);
  assert.match(lateLines[0], /^Dialogue: 0,0:00:00\.00,0:00:00\.60,/);
  assert.match(lateLines[1], /^Dialogue: 0,0:00:00\.60,0:00:01\.10,/);
});

test("passes user-installed fonts to libass and escapes filter paths", () => {
  assert.equal(
    buildAssFilter("/tmp/caption's.ass", "/Users/example/Library/Fonts"),
    "ass=filename='/tmp/caption\\'s.ass':fontsdir='/Users/example/Library/Fonts'"
  );
});

test("reports displayed dimensions for rotated phone video", () => {
  const { displayDimensions } = require("../electron/services/media.cjs");
  const landscape = { width: 1920, height: 1080 };
  assert.deepEqual(displayDimensions(landscape), { width: 1920, height: 1080 });
  for (const rotation of [90, -90, 270, -270]) {
    assert.deepEqual(
      displayDimensions({ ...landscape, side_data_list: [{ side_data_type: "Display Matrix", rotation }] }),
      { width: 1080, height: 1920 }
    );
  }
  assert.deepEqual(displayDimensions({ ...landscape, side_data_list: [{ rotation: 180 }] }), landscape);
  assert.deepEqual(displayDimensions({ ...landscape, tags: { rotate: "90" } }), { width: 1080, height: 1920 });
});

test("long captions wrap inside the preview's side margins", () => {
  const ass = buildAss(makeProject());
  assert.match(ass, /^WrapStyle: 1$/m);
  // 8% of 1080 on each side, matching the preview's left/right inset.
  assert.match(ass, /Style: Default,[^\n]+,5,86,86,0,1$/m);
});
