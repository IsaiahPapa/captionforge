const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

// Sizes and checksums come from the Hugging Face LFS pointers.
// `dtw` names whisper.cpp's alignment-head preset for word timestamps.
const MODELS = {
  tiny: {
    file: "ggml-tiny.bin",
    size: 77691713,
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    dtw: "tiny"
  },
  base: {
    file: "ggml-base.bin",
    size: 147951465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    dtw: "base"
  },
  small: {
    file: "ggml-small.bin",
    size: 487601967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    dtw: "small"
  },
  medium: {
    file: "ggml-medium.bin",
    size: 1533763059,
    sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    dtw: "medium"
  },
  // 5-bit quantized: a third of the full turbo download with near-identical output.
  turbo: {
    file: "ggml-large-v3-turbo-q5_0.bin",
    size: 574041195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    dtw: "large.v3.turbo"
  }
};

function modelInfo(name) {
  const model = MODELS[name];
  if (!model) throw new Error(`Unknown Whisper model "${name}"`);
  return model;
}

async function isInstalled(modelsDirectory, model) {
  try {
    return (await fsp.stat(path.join(modelsDirectory, model.file))).size === model.size;
  } catch {
    return false;
  }
}

async function listModels(modelsDirectory) {
  return Promise.all(Object.entries(MODELS).map(async ([id, model]) => ({
    id,
    size: model.size,
    installed: await isInstalled(modelsDirectory, model)
  })));
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

async function assertFreeSpace(directory, bytes) {
  if (!fsp.statfs) return;
  const stats = await fsp.statfs(directory);
  const available = stats.bavail * stats.bsize;
  if (available < bytes) {
    throw new Error(`Not enough disk space for this model: it needs ${formatMegabytes(bytes)}, ${formatMegabytes(available)} is free.`);
  }
}

// Streams `url` to `destination`, failing unless the bytes match `expected`.
async function downloadVerified(url, destination, expected, { signal, onProgress } = {}) {
  const partialPath = `${destination}.part`;
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const hash = crypto.createHash("sha256");
  let received = 0;
  let lastReport = 0;
  try {
    const output = fs.createWriteStream(partialPath);
    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        hash.update(chunk);
        received += chunk.length;
        if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
        const now = Date.now();
        if (now - lastReport > 200) {
          lastReport = now;
          onProgress?.(received, expected.size);
        }
      }
    } finally {
      await new Promise((resolve, reject) => output.end((error) => (error ? reject(error) : resolve())));
    }
    if (received !== expected.size || hash.digest("hex") !== expected.sha256) {
      throw Object.assign(new Error("Checksum mismatch"), { code: "ECHECKSUM" });
    }
    await fsp.rename(partialPath, destination);
    onProgress?.(received, expected.size);
    return destination;
  } catch (error) {
    await fsp.rm(partialPath, { force: true });
    throw error;
  }
}

// Returns the local path of a verified model, downloading it first if needed.
async function ensureModel(name, modelsDirectory, { signal, onProgress } = {}) {
  const model = modelInfo(name);
  const modelPath = path.join(modelsDirectory, model.file);
  if (await isInstalled(modelsDirectory, model)) return modelPath;

  await fsp.mkdir(modelsDirectory, { recursive: true });
  await assertFreeSpace(modelsDirectory, model.size);
  try {
    return await downloadVerified(`${MODEL_BASE_URL}/${model.file}`, modelPath, model, { signal, onProgress });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.code === "ECHECKSUM") throw new Error(`The downloaded ${name} model was corrupted. Please try again.`);
    throw new Error(`Could not download the ${name} model (${error.message}). Check your internet connection and try again.`);
  }
}

module.exports = { MODELS, MODEL_BASE_URL, downloadVerified, ensureModel, listModels, modelInfo, formatMegabytes };
