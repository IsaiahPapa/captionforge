const test = require("node:test");
const assert = require("node:assert/strict");

const loadModule = () => import("../src/caption-edit.ts");

function cue(...words) {
  return {
    id: "cue",
    start: words[0][1],
    end: words.at(-1)[2],
    text: words.map(([text]) => text).join(" "),
    words: words.map(([text, start, end], index) => ({ id: `w${index}`, text, start, end, confidence: 0.9 }))
  };
}

const timings = (result) => result.words.map((word) => [word.text, +word.start.toFixed(3), +word.end.toFixed(3)]);

test("fixing a typo keeps every word's transcribed timing", async () => {
  const { retimeWords } = await loadModule();
  const original = cue(["teh", 0, 0.2], ["quick", 0.5, 0.9], ["fox", 1.4, 1.6]);
  const edited = retimeWords(original, "the quick fox");
  assert.deepEqual(timings(edited), [["the", 0, 0.2], ["quick", 0.5, 0.9], ["fox", 1.4, 1.6]]);
  assert.equal(edited.words[0].id, "w0");
});

test("splitting a word shares only that word's time", async () => {
  const { retimeWords } = await loadModule();
  const original = cue(["one", 0, 0.4], ["twothree", 0.6, 1.0], ["four", 1.5, 2]);
  assert.deepEqual(timings(retimeWords(original, "one two three four")),
    [["one", 0, 0.4], ["two", 0.6, 0.8], ["three", 0.8, 1], ["four", 1.5, 2]]);
});

test("appending a word shares the last word's time; deleting removes only that word", async () => {
  const { retimeWords } = await loadModule();
  const original = cue(["one", 0, 0.4], ["two", 0.6, 1.0]);
  assert.deepEqual(timings(retimeWords(original, "one two three")),
    [["one", 0, 0.4], ["two", 0.6, 0.8], ["three", 0.8, 1]]);
  assert.deepEqual(timings(retimeWords(original, "two")), [["two", 0.6, 1]]);
});

test("typing word by word never moves untouched words", async () => {
  const { retimeWords } = await loadModule();
  let current = cue(["hello", 0, 0.5], ["world", 1, 1.5]);
  for (const text of ["hello world", "hello  world", "hello b world", "hello bi world", "hello big world"]) {
    current = retimeWords(current, text);
  }
  assert.deepEqual(timings(current)[0], ["hello", 0, 0.25]);
  assert.deepEqual(timings(current).at(-1), ["world", 1, 1.5]);
});

test("text typed into an empty cue spreads across the cue", async () => {
  const { retimeWords } = await loadModule();
  const empty = { id: "cue", start: 2, end: 3, text: "", words: [] };
  assert.deepEqual(timings(retimeWords(empty, "a b")), [["a", 2, 2.5], ["b", 2.5, 3]]);
});
