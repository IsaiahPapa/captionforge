const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { parseWhisperCppJson, wordsFromWhisperCpp } = require("../electron/services/transcription.cjs");
const { MODELS, downloadVerified } = require("../electron/services/whisper-models.cjs");

// Mirrors whisper-cli -ojf: raw token bytes, t_dtw in centiseconds (token end),
// offsets in milliseconds.
function token(text, from, dtw, p = 0.9) {
  return { text, offsets: { from, to: from + 100 }, t_dtw: dtw, p };
}

function whisperJson(tokens, language = "en") {
  const body = JSON.stringify({ result: { language }, transcription: [{ tokens }] });
  // whisper.cpp emits token bytes as-is, not \u escapes.
  return Buffer.from(body, "utf8");
}

test("groups tokens into words with DTW-based timings", () => {
  const raw = parseWhisperCppJson(whisperJson([
    token("[_BEG_]", 0, -1),
    token(" And", 320, 52),
    token(" so", 370, 88),
    token(",", 860, 110),
    token(" Amer", 1100, 180),
    token("icans", 1500, 230),
    token(",", 2300, 316),
    token(" ask", 3490, 420),
    token("[_TT_550]", 5500, -1)
  ]));
  const words = wordsFromWhisperCpp(raw, "en");
  assert.deepEqual(words.map((word) => word.text), ["And", "so,", "Americans,", "ask"]);
  assert.deepEqual(words.map((word) => [word.start, word.end]), [
    [0.32, 0.52],
    [0.52, 0.88],
    // After punctuation the earlier of its DTW time and the heuristic start wins.
    [1.1, 2.3],
    [3.16, 4.2]
  ]);
});

test("rejoins multi-byte characters split across tokens", () => {
  const bytes = Buffer.from("ö", "utf8");
  const json = Buffer.concat([
    Buffer.from('{"result":{"language":"de"},"transcription":[{"tokens":['),
    Buffer.from(`{"text":" sch","offsets":{"from":0,"to":100},"t_dtw":20,"p":0.9},`),
    Buffer.from('{"text":"'), bytes.subarray(0, 1), Buffer.from('","offsets":{"from":100,"to":150},"t_dtw":30,"p":0.8},'),
    Buffer.from('{"text":"'), bytes.subarray(1), Buffer.from('n","offsets":{"from":150,"to":200},"t_dtw":40,"p":0.7}'),
    Buffer.from("]}]}")
  ]);
  const words = wordsFromWhisperCpp(parseWhisperCppJson(json), "de");
  assert.deepEqual(words.map((word) => word.text), ["schön"]);
});

test("treats each character as a word in unspaced languages", () => {
  const raw = parseWhisperCppJson(whisperJson([
    token("你", 0, 30),
    token("好", 300, 60),
    token("。", 600, 80)
  ], "zh"));
  assert.deepEqual(wordsFromWhisperCpp(raw, "zh").map((word) => word.text), ["你", "好。"]);
});

test("tolerates unescaped control characters inside strings", () => {
  const json = Buffer.from('{"result":{"language":"en"},"transcription":[{"tokens":[{"text":" hi\tthere","offsets":{"from":0,"to":10},"t_dtw":5,"p":1}]}]}');
  assert.equal(parseWhisperCppJson(json).transcription[0].tokens[0].text, " hi\tthere");
});

test("attaches opening punctuation to the following word", () => {
  const raw = parseWhisperCppJson(whisperJson([
    token(" said", 0, 30),
    token(' "', 300, 35),
    token("hello", 350, 60),
    token('"', 600, 70)
  ]));
  assert.deepEqual(wordsFromWhisperCpp(raw, "en").map((word) => word.text), ["said", '"hello"']);
});

test("every model has a DTW preset and checksum", () => {
  for (const model of Object.values(MODELS)) {
    assert.match(model.sha256, /^[0-9a-f]{64}$/);
    assert.ok(model.size > 0 && model.dtw);
  }
});

async function withServer(payload, callback) {
  const server = http.createServer((_request, response) => response.end(payload));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "captionforge-model-test-"));
  try {
    await callback(`http://127.0.0.1:${server.address().port}/model.bin`, path.join(tempDir, "model.bin"));
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("downloads and verifies a model", async () => {
  const payload = crypto.randomBytes(300_000);
  const expected = { size: payload.length, sha256: crypto.createHash("sha256").update(payload).digest("hex") };
  await withServer(payload, async (url, destination) => {
    const progress = [];
    await downloadVerified(url, destination, expected, { onProgress: (received) => progress.push(received) });
    assert.deepEqual(fs.readFileSync(destination), payload);
    assert.equal(progress.at(-1), payload.length);
    assert.equal(fs.existsSync(`${destination}.part`), false);
  });
});

test("rejects a corrupted download and leaves nothing behind", async () => {
  const payload = crypto.randomBytes(1000);
  await withServer(payload, async (url, destination) => {
    await assert.rejects(
      downloadVerified(url, destination, { size: payload.length, sha256: "0".repeat(64) }),
      { code: "ECHECKSUM" }
    );
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), []);
  });
});

test("cancels an in-flight download", async () => {
  const payload = crypto.randomBytes(1000);
  await withServer(payload, async (url, destination) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(downloadVerified(url, destination, { size: 1000, sha256: "0".repeat(64) }, { signal: controller.signal }));
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), []);
  });
});
