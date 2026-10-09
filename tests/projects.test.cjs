const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProjectLibrary } = require("../electron/services/projects.cjs");

function project(name, cueCount = 0) {
  return {
    version: 1,
    video: { path: path.join(os.tmpdir(), "captionforge-missing", name), name, width: 1080, height: 1920, duration: 30, fps: 30, size: 1 },
    language: "en",
    cues: Array.from({ length: cueCount }, (_, index) => ({ id: `c${index}`, start: index, end: index + 1, text: "hi", words: [] })),
    style: {}
  };
}

function withLibrary(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-library-test-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  return createProjectLibrary(userData);
}

test("creates, lists newest first, and reopens projects", async (t) => {
  const library = withLibrary(t);
  const first = await library.create(project("first.mp4"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await library.create(project("second.mp4", 2));
  const recents = await library.list();
  assert.deepEqual(recents.map((item) => item.name), ["second.mp4", "first.mp4"]);
  assert.equal(recents[0].cueCount, 2);
  assert.equal((await library.open(first)).project.video.name, "first.mp4");
  assert.equal((await library.open(second)).filePath, null);
});

test("autosaves move a project to the top and keep its file path", async (t) => {
  const library = withLibrary(t);
  const id = await library.importFile(project("saved.mp4"), "/projects/saved.captionforge.json", 0);
  await library.create(project("other.mp4"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await library.save(id, project("saved.mp4", 5));
  const [top] = await library.list();
  assert.equal(top.id, id);
  assert.equal(top.cueCount, 5);
  assert.equal(top.filePath, "/projects/saved.captionforge.json");
});

test("reopening the same project file reuses its library entry", async (t) => {
  const library = withLibrary(t);
  const filePath = "/projects/clip.captionforge.json";
  const id = await library.importFile(project("clip.mp4", 1), filePath, 0);
  // Library copy is newer than the file: keep the library edits.
  assert.equal(await library.importFile(project("clip.mp4", 9), filePath, 0), id);
  assert.equal((await library.open(id)).project.cues.length, 1);
  // File is newer: take the file's contents.
  assert.equal(await library.importFile(project("clip.mp4", 9), filePath, Date.now() + 60_000), id);
  assert.equal((await library.open(id)).project.cues.length, 9);
  assert.equal((await library.list()).length, 1);
});

test("removes projects and ignores damaged entries", async (t) => {
  const library = withLibrary(t);
  const id = await library.create(project("gone.mp4"));
  fs.writeFileSync(path.join(library.directory, "00000000-0000-4000-8000-000000000000.json"), "{ not json");
  await library.remove(id);
  assert.deepEqual(await library.list(), []);
});

test("rejects ids that could escape the library directory", async (t) => {
  const library = withLibrary(t);
  await assert.rejects(library.open("../state"), /Invalid project id/);
  await assert.rejects(library.remove("../../etc/passwd"), /Invalid project id/);
});

test("flags projects whose video is gone and relinks them", async (t) => {
  const library = withLibrary(t);
  const id = await library.create(project("moved.mp4", 3));
  assert.equal((await library.list())[0].videoMissing, true);
  assert.equal((await library.open(id)).videoMissing, true);

  const newLocation = path.join(library.directory, "moved.mp4");
  fs.writeFileSync(newLocation, "");
  const { summary, previousDuration } = await library.relink(id, { path: newLocation, name: "moved.mp4", duration: 31 });
  assert.equal(previousDuration, 30);
  assert.equal(summary.videoMissing, false);
  const reopened = await library.open(id);
  assert.equal(reopened.videoMissing, false);
  assert.equal(reopened.project.video.path, newLocation);
  assert.equal(reopened.project.cues.length, 3, "captions survive relinking");
  assert.equal(reopened.project.video.width, 1080, "fields not in the new probe are kept");
});
