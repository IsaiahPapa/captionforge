const test = require("node:test");
const assert = require("node:assert/strict");

const loadModule = () => import("../src/project.ts");
const DEFAULT_STYLE = {
  id: "bold-punch", name: "Bold Punch", fontFamily: "Arial", fontSize: 72, fontWeight: 800, fontStyle: "normal",
  letterSpacing: 0, primaryColor: "#ffffff", activeColor: "#f6e44d", outlineColor: "#080808", outlineWidth: 5, shadow: 2,
  position: "center", marginPercent: 10, verticalOffsetPercent: 0, uppercase: true, highlightActiveWord: true,
  transition: "pop", wordTimingOffsetMs: 120
};
const VIDEO = { path: "C:\\clips\\take 1.mp4", name: "take 1.mp4", width: 1080, height: 1920, duration: 12.5, fps: 30, size: 1000 };

test("rejects JSON that isn't a project", async () => {
  const { parseProject } = await loadModule();
  for (const candidate of [null, [], { name: "captionforge", version: "0.1.0" }, { video: VIDEO }, { video: { path: "x.mp4" }, cues: [] }]) {
    assert.throws(() => parseProject(candidate, DEFAULT_STYLE), /isn't a CaptionForge project/);
  }
  assert.throws(
    () => parseProject({ video: VIDEO, cues: [{ start: 0, end: 1, text: "ok", words: [] }, { start: "soon", text: 3 }] }, DEFAULT_STYLE),
    /caption 2 is damaged/
  );
});

test("fills missing or invalid style fields from the default style", async () => {
  const { parseProject } = await loadModule();
  const project = parseProject({
    video: { ...VIDEO, name: undefined, fps: undefined },
    cues: [{ start: 0, end: 1, text: "hello", words: [{ text: "hello", start: 0, end: 1 }] }],
    style: { fontFamily: "Georgia", fontSize: "huge", position: "sideways", transition: "fade" }
  }, DEFAULT_STYLE);
  assert.equal(project.video.name, "take 1.mp4");
  assert.equal(project.video.fps, 0);
  assert.equal(project.language, "auto");
  assert.equal(project.style.fontFamily, "Georgia");
  assert.equal(project.style.fontSize, 72);
  assert.equal(project.style.position, "center");
  assert.equal(project.style.transition, "fade");
  assert.equal(typeof project.cues[0].id, "string");
  assert.equal(typeof project.cues[0].words[0].id, "string");
});
