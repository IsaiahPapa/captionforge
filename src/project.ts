import type { CaptionCue, CaptionProject, CaptionStyle, CaptionWord } from "./types";

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const STYLE_CHOICES: Partial<Record<keyof CaptionStyle, readonly unknown[]>> = {
  fontStyle: ["normal", "italic"],
  position: ["top", "center", "bottom"],
  transition: ["none", "pop", "fade"]
};

function parseStyle(candidate: unknown, defaults: CaptionStyle): CaptionStyle {
  const style: Fields = { ...defaults };
  if (!isRecord(candidate)) return defaults;
  for (const key of Object.keys(defaults) as (keyof CaptionStyle)[]) {
    const value = candidate[key];
    const expected = typeof defaults[key];
    const valid = STYLE_CHOICES[key]
      ? STYLE_CHOICES[key]!.includes(value)
      : expected === "number" ? isNumber(value) : typeof value === expected;
    if (valid) style[key] = value;
  }
  return style as unknown as CaptionStyle;
}

function parseWord(candidate: unknown): CaptionWord | null {
  if (!isRecord(candidate) || typeof candidate.text !== "string" || !isNumber(candidate.start) || !isNumber(candidate.end)) {
    return null;
  }
  return {
    id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
    text: candidate.text,
    start: candidate.start,
    end: candidate.end,
    ...(isNumber(candidate.confidence) ? { confidence: candidate.confidence } : {})
  };
}

function parseCue(candidate: unknown): CaptionCue | null {
  if (!isRecord(candidate) || typeof candidate.text !== "string" || !isNumber(candidate.start) || !isNumber(candidate.end)) {
    return null;
  }
  const words = Array.isArray(candidate.words) ? candidate.words.map(parseWord) : [];
  if (words.some((word) => !word)) return null;
  return {
    id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
    start: candidate.start,
    end: candidate.end,
    text: candidate.text,
    words: words as CaptionWord[]
  };
}

// Validates a project loaded from disk (an opened file or the autosaved
// draft). Missing style fields fall back to `defaultStyle`; anything that
// would break the editor is rejected with a readable error.
export function parseProject(candidate: unknown, defaultStyle: CaptionStyle): CaptionProject {
  const invalid = (detail: string) => new Error(`This isn't a CaptionForge project (${detail}).`);
  if (!isRecord(candidate)) throw invalid("unexpected file contents");
  const video = candidate.video;
  if (!isRecord(video) || typeof video.path !== "string" || !video.path) throw invalid("no video reference");
  if (!isNumber(video.width) || video.width <= 0 || !isNumber(video.height) || video.height <= 0) {
    throw invalid("missing video size");
  }
  if (!isNumber(video.duration) || video.duration <= 0) throw invalid("missing video length");
  if (!Array.isArray(candidate.cues)) throw invalid("no caption list");
  const cues = candidate.cues.map(parseCue);
  const broken = cues.findIndex((cue) => !cue);
  if (broken >= 0) throw invalid(`caption ${broken + 1} is damaged`);

  return {
    version: 1,
    video: {
      path: video.path,
      name: typeof video.name === "string" && video.name ? video.name : video.path.split(/[\\/]/).at(-1) ?? video.path,
      width: video.width,
      height: video.height,
      duration: video.duration,
      fps: isNumber(video.fps) ? video.fps : 0,
      size: isNumber(video.size) ? video.size : 0
    },
    language: typeof candidate.language === "string" ? candidate.language : "auto",
    cues: cues as CaptionCue[],
    style: parseStyle(candidate.style, defaultStyle)
  };
}
