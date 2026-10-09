const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { runProcess } = require("./process.cjs");
const { ffmpegPath } = require("./binaries.cjs");

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Every project lives in <userData>/projects/<id>.json and is autosaved there,
// so the home screen can always reopen recent work. `filePath` remembers the
// .captionforge.json the user saved or opened it as, if any.
function createProjectLibrary(userDataDirectory) {
  const directory = path.join(userDataDirectory, "projects");
  const writeQueues = new Map();

  function checkedId(id) {
    if (typeof id !== "string" || !PROJECT_ID.test(id)) throw new Error("Invalid project id");
    return id;
  }
  const entryPath = (id) => path.join(directory, `${checkedId(id)}.json`);
  const thumbnailPath = (id) => path.join(directory, `${checkedId(id)}.jpg`);

  async function readEntry(id) {
    return JSON.parse(await fs.readFile(entryPath(id), "utf8"));
  }

  function writeEntry(entry) {
    const target = entryPath(entry.id);
    const previous = writeQueues.get(entry.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      // Write-then-rename so a crash mid-save never leaves a truncated project.
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(entry), "utf8");
      await fs.rename(temporary, target);
    });
    writeQueues.set(entry.id, next);
    return next;
  }

  async function createThumbnail(id, video) {
    const seconds = Math.min(1, Math.max(0, (Number(video.duration) || 0) / 2));
    try {
      await fs.mkdir(directory, { recursive: true });
      await runProcess(ffmpegPath, [
        "-y", "-ss", seconds.toFixed(2), "-i", video.path,
        "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4",
        thumbnailPath(id)
      ]);
    } catch {
      // A missing thumbnail only affects the home screen artwork.
    }
  }

  async function summarize(entry) {
    const { project } = entry;
    const thumbnail = thumbnailPath(entry.id);
    return {
      id: entry.id,
      filePath: entry.filePath ?? null,
      updatedAt: entry.updatedAt,
      name: project.video.name,
      videoPath: project.video.path,
      duration: project.video.duration,
      width: project.video.width,
      height: project.video.height,
      cueCount: Array.isArray(project.cues) ? project.cues.length : 0,
      thumbnail: await exists(thumbnail) ? thumbnail : null
    };
  }

  async function list() {
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch {
      return [];
    }
    const entries = await Promise.all(names
      .filter((name) => name.endsWith(".json") && PROJECT_ID.test(name.slice(0, -5)))
      .map((name) => readEntry(name.slice(0, -5)).catch(() => null)));
    const summaries = await Promise.all(entries
      .filter((entry) => entry?.project?.video?.path)
      .map(summarize));
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function create(project, filePath = null) {
    const entry = { id: crypto.randomUUID(), filePath, updatedAt: Date.now(), project };
    await writeEntry(entry);
    await createThumbnail(entry.id, project.video);
    return entry.id;
  }

  async function save(id, project, filePath) {
    let current = null;
    try {
      current = await readEntry(id);
    } catch {
      // First save of this id.
    }
    await writeEntry({
      id: checkedId(id),
      filePath: filePath === undefined ? current?.filePath ?? null : filePath,
      updatedAt: Date.now(),
      project
    });
  }

  async function open(id) {
    const entry = await readEntry(id);
    return { id: entry.id, filePath: entry.filePath ?? null, project: entry.project };
  }

  // Opening a project file that is already in the library reuses that entry,
  // keeping whichever copy was edited more recently.
  async function importFile(project, filePath, fileModifiedAt) {
    const existing = (await list()).find((summary) => summary.filePath === filePath);
    if (existing) {
      if (existing.updatedAt < fileModifiedAt) await save(existing.id, project, filePath);
      return existing.id;
    }
    return create(project, filePath);
  }

  async function remove(id) {
    await writeQueues.get(id)?.catch(() => undefined);
    writeQueues.delete(id);
    await fs.rm(entryPath(id), { force: true });
    await fs.rm(thumbnailPath(id), { force: true });
  }

  return { directory, list, create, save, open, importFile, remove, createThumbnail };
}

module.exports = { createProjectLibrary };
