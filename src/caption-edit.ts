import type { CaptionCue, CaptionWord } from "./types";

// Applies edited cue text while keeping transcribed word timings. Words before
// and after the edited stretch keep their timestamps (and ids); only the
// changed words are re-spaced across the time the replaced words occupied.
// Runs on every keystroke, so a typo fix never disturbs its neighbors.
export function retimeWords(cue: CaptionCue, text: string): CaptionCue {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const previous = cue.words;

  let prefix = 0;
  while (prefix < tokens.length && prefix < previous.length && tokens[prefix] === previous[prefix].text) prefix++;
  let suffix = 0;
  while (
    suffix < tokens.length - prefix
    && suffix < previous.length - prefix
    && tokens[tokens.length - 1 - suffix] === previous[previous.length - 1 - suffix].text
  ) suffix++;

  // A pure insertion has no time of its own; share a neighbor's instead.
  if (prefix + suffix === previous.length && tokens.length > previous.length) {
    if (prefix > 0) prefix--;
    else if (suffix > 0) suffix--;
  }

  const replaced = previous.slice(prefix, previous.length - suffix);
  const inserted = tokens.slice(prefix, tokens.length - suffix);
  const spanStart = replaced[0]?.start ?? previous[prefix - 1]?.end ?? cue.start;
  const spanEnd = replaced.at(-1)?.end ?? previous[previous.length - suffix]?.start ?? cue.end;
  const step = Math.max(0, spanEnd - spanStart) / Math.max(1, inserted.length);

  const middle: CaptionWord[] = inserted.map((token, index) => {
    // Same number of words in and out: keep each word's own timing.
    const original = replaced.length === inserted.length ? replaced[index] : undefined;
    return {
      id: replaced[index]?.id ?? crypto.randomUUID(),
      text: token,
      start: original?.start ?? spanStart + step * index,
      end: original?.end ?? spanStart + step * (index + 1),
      confidence: original?.confidence
    };
  });

  return {
    ...cue,
    text,
    words: [...previous.slice(0, prefix), ...middle, ...previous.slice(previous.length - suffix)]
  };
}
