const test = require("node:test");
const assert = require("node:assert/strict");
const { wordsToCues } = require("../electron/services/transcription.cjs");

function makeWords(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `word-${index + 1}`,
    text: `word${index + 1}`,
    start: index * 0.5,
    end: index * 0.5 + 0.4
  }));
}

test("creates strict, non-overlapping three-word batches", () => {
  const source = makeWords(7);
  const cues = wordsToCues(source, 3);

  assert.deepEqual(cues.map((cue) => cue.words.map((word) => word.id)), [
    ["word-1", "word-2", "word-3"],
    ["word-4", "word-5", "word-6"],
    ["word-7"]
  ]);
  assert.equal(cues.flatMap((cue) => cue.words).length, source.length);
  assert.equal(new Set(cues.flatMap((cue) => cue.words.map((word) => word.id))).size, source.length);
});

test("uses each word exactly once for other batch sizes", () => {
  const source = makeWords(11);
  for (const size of [1, 2, 4, 5, 6]) {
    const flattened = wordsToCues(source, size).flatMap((cue) => cue.words);
    assert.deepEqual(flattened.map((word) => word.id), source.map((word) => word.id));
    assert.ok(wordsToCues(source, size).every((cue) => cue.words.length <= size));
  }
});
