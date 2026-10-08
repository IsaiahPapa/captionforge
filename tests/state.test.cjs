const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStateStore } = require("../electron/services/state.cjs");

test("migrates renderer settings once and then uses app-level persistence", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "captionforge-state-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyState = {
    version: 1,
    project: { version: 1, video: { path: "/video.mp4" } },
    userStylePresets: [{ id: "user-test", name: "My style", fontFamily: "Inter" }],
    exportSettings: { codec: "h264" }
  };

  const firstStore = createStateStore(directory);
  assert.deepEqual(await firstStore.load(legacyState), legacyState);

  const updatedState = { ...legacyState, project: null };
  await firstStore.save(updatedState);

  const restartedStore = createStateStore(directory);
  assert.deepEqual(await restartedStore.load({ ...legacyState, project: { stale: true } }), updatedState);
  assert.deepEqual(JSON.parse(await fs.readFile(firstStore.statePath, "utf8")), updatedState);
});
