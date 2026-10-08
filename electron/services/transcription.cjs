const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { runProcess } = require("./process.cjs");
const { ffmpegPath, whisperCliPath } = require("./binaries.cjs");
const { ensureModel, formatMegabytes, modelInfo } = require("./whisper-models.cjs");

// Scripts written without spaces between words; each token is its own word.
const UNSPACED_LANGUAGES = new Set(["zh", "yue", "ja", "th", "lo", "km", "my", "bo"]);
const OPENING_PUNCTUATION = /^\s+["'“‘¿¡([{«-]+$/;

function wordsToCues(words, batchSize = 3) {
  const cues = [];
  const strictSize = Math.max(1, Math.floor(Number(batchSize) || 3));
  for (let index = 0; index < words.length; index += strictSize) {
    const group = words.slice(index, index + strictSize);
    cues.push({
      id: crypto.randomUUID(),
      start: group[0].start,
      end: group.at(-1).end,
      text: group.map((item) => item.text).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
      words: group
    });
  }
  return cues;
}

// whisper.cpp writes raw token bytes: a multi-byte character can be split across
// tokens and control characters are not escaped. Parse byte-per-char (latin1)
// and decode to UTF-8 only once tokens have been joined.
function parseWhisperCppJson(buffer) {
  let inString = false;
  let escaped = false;
  let text = "";
  for (const char of buffer.toString("latin1")) {
    if (inString && !escaped && char.charCodeAt(0) < 0x20) {
      text += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    if (escaped) escaped = false;
    else if (char === "\\") escaped = inString;
    else if (char === '"') inString = !inString;
    text += char;
  }
  return JSON.parse(text);
}

const decode = (latin1) => Buffer.from(latin1, "latin1").toString("utf8");
const hasWordCharacters = (text) => /[\p{L}\p{N}]/u.test(text);
const tokenEnd = (token) => (token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.to / 1000);

// Builds word timings from whisper.cpp `-ojf -dtw` output. A token's DTW time
// marks where it ends, so a word starts where the previous token ended. A
// trailing punctuation token also absorbs any following pause, so after one
// the earlier heuristic token start wins. Measured against openai-whisper's
// word timestamps this lands within ~10–80 ms on average.
function wordsFromWhisperCpp(result, language) {
  const tokens = (result.transcription || [])
    .flatMap((segment) => segment.tokens || [])
    .filter((token) => !/^\[_.*\]$/.test(token.text));

  const units = [];
  let pending = null;
  for (const token of tokens) {
    pending = pending
      ? { raw: pending.raw + token.text, tokens: [...pending.tokens, token] }
      : { raw: token.text, tokens: [token] };
    if (!decode(pending.raw).includes("�")) {
      units.push(pending);
      pending = null;
    }
  }
  if (pending) units.push(pending);

  const unspaced = UNSPACED_LANGUAGES.has(language);
  const groups = [];
  for (const unit of units) {
    const text = decode(unit.raw);
    const previous = groups.at(-1);
    const joinsPrevious = previous && (
      !hasWordCharacters(previous.text)
      || (!hasWordCharacters(text) && !OPENING_PUNCTUATION.test(text))
      || (!unspaced && hasWordCharacters(text) && !/^\s/.test(text))
    );
    if (joinsPrevious) {
      previous.text += text;
      previous.tokens.push(...unit.tokens);
    } else {
      groups.push({ text, tokens: [...unit.tokens] });
    }
  }

  const words = [];
  for (const [index, group] of groups.entries()) {
    const text = group.text.trim();
    if (!hasWordCharacters(text)) continue;
    const wordTokens = group.tokens.filter((token) => hasWordCharacters(decode(token.text)));
    const end = tokenEnd((wordTokens.length ? wordTokens : group.tokens).at(-1));
    const heuristicStart = group.tokens[0].offsets.from / 1000;
    const previousToken = groups[index - 1]?.tokens.at(-1);
    let start = !previousToken
      ? heuristicStart
      : hasWordCharacters(decode(previousToken.text))
        ? tokenEnd(previousToken)
        : Math.min(tokenEnd(previousToken), heuristicStart);
    start = Math.max(words.at(-1)?.start ?? 0, Math.min(start, end - 0.05));
    const probabilities = (wordTokens.length ? wordTokens : group.tokens).map((token) => Number(token.p));
    words.push({
      id: crypto.randomUUID(),
      text,
      start,
      end: Math.max(end, start + 0.05),
      confidence: probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
    });
  }
  return words;
}

async function transcribeVideo(options, context) {
  if (!whisperCliPath) {
    throw new Error("CaptionForge's speech recognizer is missing. Reinstall the app (developers: run `node scripts/fetch-whisper.cjs`).");
  }
  const model = modelInfo(options.model);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "captionforge-"));
  const wavPath = path.join(tempDir, "audio.wav");
  const outputBase = path.join(tempDir, "audio");
  try {
    context.onProgress({ stage: "model", value: 0, message: "Preparing…" });
    const modelPath = await ensureModel(options.model, context.modelsDirectory, {
      signal: context.signal,
      onProgress(received, total) {
        context.onProgress({
          stage: "model",
          value: 0.1 * received / total,
          message: `Downloading the ${options.model} model (one time)… ${formatMegabytes(received)} of ${formatMegabytes(total)}`
        });
      }
    });

    context.onProgress({ stage: "audio", value: 0.1, message: "Extracting audio…" });
    await runProcess(ffmpegPath, [
      "-y", "-i", options.videoPath, "-vn", "-ar", "16000", "-ac", "1",
      "-c:a", "pcm_s16le", wavPath
    ], { signal: context.signal });

    context.onProgress({ stage: "transcribing", value: 0.15, message: `Transcribing with Whisper ${options.model}…` });
    let observedProgress = 0.15;
    const threads = Math.max(1, Math.min(8, os.availableParallelism()));
    await runProcess(whisperCliPath, [
      "-m", modelPath,
      "-f", wavPath,
      "-of", outputBase,
      "-ojf",
      "-l", options.language && options.language !== "auto" ? options.language : "auto",
      // DTW token timestamps (the same technique openai-whisper uses for words);
      // whisper.cpp requires flash attention off for them.
      "-dtw", model.dtw,
      "-nfa",
      "-t", String(threads),
      "-pp",
      "-np"
    ], {
      signal: context.signal,
      onStderr(value) {
        const matches = [...value.matchAll(/progress\s*=\s*(\d{1,3})%/g)];
        if (matches.length) {
          const percent = Number(matches.at(-1)[1]) / 100;
          observedProgress = Math.max(observedProgress, 0.15 + percent * 0.8);
          context.onProgress({
            stage: "transcribing",
            value: observedProgress,
            message: `Transcribing… ${Math.round(percent * 100)}%`
          });
        }
      }
    });

    const raw = parseWhisperCppJson(await fs.readFile(`${outputBase}.json`));
    const language = raw.result?.language || options.language || "auto";
    const words = wordsFromWhisperCpp(raw, language);

    context.onProgress({ stage: "complete", value: 1, message: "Transcript ready" });
    return {
      language,
      cues: wordsToCues(words, options.wordsPerCue || 3)
    };
  } catch (error) {
    if (context.signal?.aborted) throw new Error("Job cancelled");
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { transcribeVideo, wordsToCues, wordsFromWhisperCpp, parseWhisperCppJson };
