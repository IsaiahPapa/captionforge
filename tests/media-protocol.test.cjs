const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseRange, serveMediaFile } = require("../electron/services/media-protocol.cjs");

test("parses open, bounded, and suffix byte ranges", () => {
  assert.deepEqual(parseRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange("bytes=6-", 10), { start: 6, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.equal(parseRange("bytes=20-30", 10), null);
});

test("serves media ranges with partial-content headers", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "captionforge-range-test-"));
  const filePath = path.join(directory, "clip.mp4");
  try {
    await fs.writeFile(filePath, Buffer.from("0123456789"));
    const response = await serveMediaFile(new Request("https://media.test/clip", {
      headers: { Range: "bytes=3-6" }
    }), filePath);

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-range"), "bytes 3-6/10");
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "3456");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
