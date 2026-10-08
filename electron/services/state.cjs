const fs = require("node:fs/promises");
const path = require("node:path");

function normalizeState(candidate = {}) {
  return {
    version: 1,
    project: candidate.project && typeof candidate.project === "object" ? candidate.project : null,
    userStylePresets: Array.isArray(candidate.userStylePresets) ? candidate.userStylePresets : [],
    exportSettings: candidate.exportSettings && typeof candidate.exportSettings === "object"
      ? candidate.exportSettings
      : null
  };
}

function createStateStore(userDataDirectory) {
  const statePath = path.join(userDataDirectory, "state.json");
  let cachedState = null;
  let writeQueue = Promise.resolve();

  async function writeState(state) {
    await fs.mkdir(userDataDirectory, { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }

  async function load(legacyState) {
    if (cachedState) return cachedState;
    try {
      cachedState = normalizeState(JSON.parse(await fs.readFile(statePath, "utf8")));
      return cachedState;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      cachedState = normalizeState(legacyState);
      await writeState(cachedState);
      return cachedState;
    }
  }

  async function save(candidate) {
    cachedState = normalizeState(candidate);
    writeQueue = writeQueue.then(() => writeState(cachedState));
    await writeQueue;
    return cachedState;
  }

  return { load, save, statePath };
}

module.exports = { createStateStore, normalizeState };
