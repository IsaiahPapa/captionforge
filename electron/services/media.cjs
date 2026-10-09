const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { runProcess } = require("./process.cjs");
const { ffmpegPath, ffprobePath } = require("./binaries.cjs");
const {
  createStaticFontInstance,
  resolveFontFace,
  resolveUserFontDirectory,
  resolveUserFontFile
} = require("./fonts.cjs");

sharp.cache(false);
sharp.concurrency(1);

const DEFAULT_EXPORT_SETTINGS = {
  resolution: "source",
  quality: "balanced",
  codec: "h264",
  frameRate: "source",
  hardwareAcceleration: true,
  audioBitrate: 192
};
const DEFAULT_WORD_TIMING_OFFSET_MS = 120;

function wordTimingOffsetSeconds(style) {
  const value = Number(style.wordTimingOffsetMs);
  return (Number.isFinite(value) ? value : DEFAULT_WORD_TIMING_OFFSET_MS) / 1000;
}

function normalizeExportSettings(settings = {}) {
  const merged = { ...DEFAULT_EXPORT_SETTINGS, ...settings };
  return {
    resolution: ["source", "1080", "720"].includes(merged.resolution) ? merged.resolution : "source",
    quality: ["draft", "balanced", "high"].includes(merged.quality) ? merged.quality : "balanced",
    codec: merged.codec === "hevc" ? "hevc" : "h264",
    frameRate: ["source", "24", "30", "60"].includes(String(merged.frameRate)) ? String(merged.frameRate) : "source",
    hardwareAcceleration: merged.hardwareAcceleration !== false,
    audioBitrate: [128, 192, 320].includes(Number(merged.audioBitrate)) ? Number(merged.audioBitrate) : 192
  };
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function exportDimensions(video, resolution) {
  if (resolution === "source") return { width: even(video.width), height: even(video.height) };
  const targetLongEdge = resolution === "720" ? 1280 : 1920;
  const scale = Math.min(1, targetLongEdge / Math.max(video.width, video.height));
  return { width: even(video.width * scale), height: even(video.height * scale) };
}

function projectAtDimensions(project, dimensions) {
  const scale = dimensions.width / project.video.width;
  return {
    ...project,
    video: { ...project.video, ...dimensions },
    style: {
      ...project.style,
      fontSize: Math.max(12, project.style.fontSize * scale),
      letterSpacing: project.style.letterSpacing * scale,
      outlineWidth: project.style.outlineWidth * scale,
      shadow: project.style.shadow * scale
    }
  };
}

// Phones usually store portrait video as landscape frames plus a rotation flag.
// Browsers and FFmpeg both apply that flag, so report the displayed size.
function displayDimensions(stream) {
  const width = Number(stream.width);
  const height = Number(stream.height);
  const rotation = Number(
    stream.side_data_list?.find((data) => data.rotation != null)?.rotation
    ?? stream.tags?.rotate
    ?? 0
  );
  return Math.abs(Math.round(rotation)) % 180 === 90
    ? { width: height, height: width }
    : { width, height };
}

async function probeMedia(filePath) {
  const { stdout } = await runProcess(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=index,codec_type,width,height,r_frame_rate:stream_tags=rotate:stream_side_data_list",
    "-of", "json",
    filePath
  ]);
  const result = JSON.parse(stdout);
  const videoStream = result.streams.find((stream) => stream.codec_type === "video");
  if (!videoStream) throw new Error("The selected file does not contain a video stream.");
  const [numerator, denominator] = String(videoStream.r_frame_rate || "0/1").split("/").map(Number);
  return {
    path: filePath,
    name: path.basename(filePath),
    ...displayDimensions(videoStream),
    duration: Number(result.format.duration),
    fps: denominator ? numerator / denominator : 0,
    size: Number(result.format.size)
  };
}

function assColor(hex, alpha = "00") {
  const normalized = hex.replace("#", "").padEnd(6, "0");
  return `&H${alpha}${normalized.slice(4, 6)}${normalized.slice(2, 4)}${normalized.slice(0, 2)}`;
}

function assTime(seconds) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe % 1) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function escapeAss(value) {
  return value
    .replaceAll("\\", "⧵")
    .replaceAll("{", "｛")
    .replaceAll("}", "｝")
    .replace(/\r?\n/g, "\\N");
}

function alignment(style) {
  if (style.position === "top") return 8;
  if (style.position === "center") return 5;
  return 2;
}

// The preview lays captions out in the middle 84% of the frame and wraps
// greedily (CSS flex-wrap); export mirrors both so long captions wrap the
// same way instead of running off the edges.
const CAPTION_SIDE_MARGIN = 0.08;

function captionPosition(style, video) {
  const offset = Number(style.verticalOffsetPercent) || 0;
  const basePercent = style.position === "top"
    ? 10
    : style.position === "bottom"
      ? 100 - (Number(style.marginPercent) || 12)
      : 50;
  const yPercent = Math.max(0, Math.min(100, basePercent - offset));
  return {
    alignment: alignment(style),
    x: Math.round(video.width / 2),
    y: Math.round(video.height * yPercent / 100)
  };
}

function cueEvents(cue, style) {
  const timingOffset = wordTimingOffsetSeconds(style);
  const words = cue.words?.length ? cue.words : [{
    text: cue.text,
    start: cue.start,
    end: cue.end
  }];
  const events = [];
  if (!style.highlightActiveWord || words.length === 1) {
    events.push({ start: cue.start, end: cue.end, text: escapeAss(style.uppercase ? cue.text.toUpperCase() : cue.text) });
    return events;
  }
  words.forEach((activeWord, activeIndex) => {
    const decorated = words.map((word, wordIndex) => {
      const raw = style.uppercase ? word.text.toUpperCase() : word.text;
      if (wordIndex !== activeIndex) return escapeAss(raw);
      const transition = style.transition === "pop"
        ? `{\\c${assColor(style.activeColor)}\\frz-2\\t(0,55,\\frz1)\\t(55,105,\\frz0)}`
        : style.transition === "fade"
          ? `{\\c${assColor(style.activeColor)}\\alpha&H44&\\t(0,80,\\alpha&H00&)}`
          : `{\\c${assColor(style.activeColor)}}`;
      return `${transition}${escapeAss(raw)}{\\r}`;
    }).join(" ");
    events.push({
      start: activeIndex === 0
        ? cue.start
        : Math.max(cue.start, activeWord.start - timingOffset),
      end: Math.min(
        cue.end,
        words[activeIndex + 1]
          ? words[activeIndex + 1].start - timingOffset
          : activeWord.end ?? cue.end
      ),
      text: decorated
    });
  });
  return events;
}

function buildAss(project) {
  const { style, video, cues } = project;
  const position = captionPosition(style, video);
  const fontFamily = String(style.fontFamily || "Arial").replaceAll(",", "");
  const fontWeight = Math.max(100, Math.min(900, Number(style.fontWeight) || 400));
  const italic = style.fontStyle === "italic" ? -1 : 0;
  const letterSpacing = Number(style.letterSpacing) || 0;
  const positionOverride = `{\\an${position.alignment}\\pos(${position.x},${position.y})}`;
  const sideMargin = Math.round(video.width * CAPTION_SIDE_MARGIN);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${video.width}
PlayResY: ${video.height}
ScaledBorderAndShadow: yes
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${style.fontSize},${assColor(style.primaryColor)},${assColor(style.activeColor)},${assColor(style.outlineColor)},&H90000000,${fontWeight},${italic},0,0,100,100,${letterSpacing},0,1,${style.outlineWidth},${style.shadow},${position.alignment},${sideMargin},${sideMargin},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = cues.flatMap((cue) => cueEvents(cue, style))
    .filter((event) => event.end > event.start)
    .map((event) => `Dialogue: 0,${assTime(event.start)},${assTime(event.end)},Default,,0,0,0,,${positionOverride}${event.text}`);
  return `${header}\n${events.join("\n")}\n`;
}

function escapeAssFilterPath(filePath) {
  return filePath
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function buildAssFilter(assPath, fontDirectory = null) {
  const options = [`filename='${escapeAssFilterPath(assPath)}'`];
  if (fontDirectory) options.push(`fontsdir='${escapeAssFilterPath(fontDirectory)}'`);
  return `ass=${options.join(":")}`;
}

async function selectEncoder(codec = "h264", hardwareAcceleration = true) {
  const { stdout } = await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]);
  const software = codec === "hevc" ? "libx265" : "libx264";
  if (!hardwareAcceleration) return software;
  const candidates = codec === "hevc"
    ? process.platform === "darwin"
      ? ["hevc_videotoolbox", software]
      : process.platform === "win32"
        ? ["hevc_nvenc", "hevc_qsv", "hevc_amf", software]
        : ["hevc_nvenc", "hevc_vaapi", software]
    : process.platform === "darwin"
      ? ["h264_videotoolbox", software]
      : process.platform === "win32"
        ? ["h264_nvenc", "h264_qsv", "h264_amf", software]
        : ["h264_nvenc", "h264_vaapi", software];
  return candidates.find((encoder) => stdout.includes(encoder)) || software;
}

async function supportsAssFilter() {
  const { stdout } = await runProcess(ffmpegPath, ["-hide_banner", "-filters"]);
  return /^\s*[TSC.]{3}\s+ass\s/m.test(stdout);
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function captionStates(project) {
  const timingOffset = wordTimingOffsetSeconds(project.style);
  return project.cues.flatMap((cue) => {
    const words = cue.words?.length ? cue.words : [{
      text: cue.text,
      start: cue.start,
      end: cue.end
    }];
    if (!project.style.highlightActiveWord || words.length === 1) {
      return [{ start: cue.start, end: cue.end, words, activeIndex: -1 }];
    }
    return words.map((word, activeIndex) => ({
      start: activeIndex === 0
        ? cue.start
        : Math.max(cue.start, word.start - timingOffset),
      end: Math.min(
        cue.end,
        words[activeIndex + 1]
          ? words[activeIndex + 1].start - timingOffset
          : cue.end
      ),
      words,
      activeIndex
    }));
  }).filter((state) => state.end > state.start)
    .sort((a, b) => a.start - b.start);
}

function splitLines(words, fontSize, maxWidth) {
  const lines = [];
  let line = [];
  let estimatedWidth = 0;
  for (const [index, word] of words.entries()) {
    const width = String(word.text).length * (fontSize * 0.58 + (Number(word.letterSpacing) || 0)) + (line.length ? fontSize * 0.28 : 0);
    if (line.length && estimatedWidth + width > maxWidth) {
      lines.push(line);
      line = [];
      estimatedWidth = 0;
    }
    line.push({ ...word, originalIndex: index });
    estimatedWidth += width;
  }
  if (line.length) lines.push(line);
  return lines;
}

function stateSvg(project, state) {
  const { style, video } = project;
  const fontSize = Math.max(12, Number(style.fontSize) || 64);
  const letterSpacing = Number(style.letterSpacing) || 0;
  const lineHeight = fontSize * 1.12;
  const wordsWithSpacing = state.words.map((word) => ({ ...word, letterSpacing }));
  const lines = splitLines(wordsWithSpacing, fontSize, video.width * (1 - 2 * CAPTION_SIDE_MARGIN));
  const totalHeight = lines.length * lineHeight;
  const offsetY = -video.height * (Number(style.verticalOffsetPercent) || 0) / 100;
  const centerY = style.position === "top"
    ? video.height * 0.1 + offsetY + totalHeight / 2
    : style.position === "bottom"
      ? video.height * (1 - (Number(style.marginPercent) || 12) / 100) + offsetY - totalHeight / 2
      : video.height / 2 + offsetY;
  const textRows = lines.map((line, lineIndex) => {
    const y = centerY - totalHeight / 2 + lineHeight * (lineIndex + 0.5);
    const spans = line.map((word, wordIndex) => {
      const isActive = word.originalIndex === state.activeIndex;
      const text = style.uppercase ? String(word.text).toUpperCase() : String(word.text);
      const fill = isActive ? style.activeColor : style.primaryColor;
      const fixedGap = wordIndex ? ` dx="${(fontSize * 0.28).toFixed(2)}"` : "";
      return `<tspan fill="${xml(fill)}" font-size="${fontSize}"${fixedGap}>${xml(text)}</tspan>`;
    }).join("");
    return `<text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle">${spans}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${video.width}" height="${video.height}" viewBox="0 0 ${video.width} ${video.height}">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="${Math.max(0, style.shadow)}" stdDeviation="${Math.max(0, style.shadow)}" flood-color="#000000" flood-opacity="0.75"/>
      </filter>
    </defs>
    <g font-family="${xml(style.fontFamily)}" font-size="${fontSize}" font-weight="${style.fontWeight}" font-style="${style.fontStyle === "italic" ? "italic" : "normal"}" letter-spacing="${letterSpacing}" fill="${xml(style.primaryColor)}"
      stroke="${xml(style.outlineColor)}" stroke-width="${Math.max(0, style.outlineWidth * 2)}" stroke-linejoin="round"
      paint-order="stroke fill" filter="url(#shadow)">${textRows}</g>
  </svg>`;
}

async function createRasterTimeline(project, tempDir, context) {
  const transparentPath = path.join(tempDir, "overlay-transparent.png");
  await sharp({
    create: {
      width: project.video.width,
      height: project.video.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).png().toFile(transparentPath);

  const rawStates = captionStates(project);
  const entries = [];
  let cursor = 0;
  let imageIndex = 0;
  for (const state of rawStates) {
    const start = Math.max(cursor, state.start);
    if (start > cursor) entries.push({ file: transparentPath, duration: start - cursor });
    const end = Math.min(project.video.duration, state.end);
    if (end <= start) continue;
    const imagePath = path.join(tempDir, `overlay-${String(imageIndex++).padStart(4, "0")}.png`);
    await sharp(Buffer.from(stateSvg(project, state))).png().toFile(imagePath);
    entries.push({ file: imagePath, duration: end - start });
    cursor = end;
    if (imageIndex % 5 === 0 || imageIndex === rawStates.length) {
      context?.onProgress({
        stage: "export",
        value: Math.min(0.09, imageIndex / Math.max(1, rawStates.length) * 0.09),
        message: `Preparing caption frames… ${imageIndex}/${rawStates.length}`
      });
    }
  }
  if (cursor < project.video.duration) {
    entries.push({ file: transparentPath, duration: project.video.duration - cursor });
  }
  if (!entries.length) entries.push({ file: transparentPath, duration: project.video.duration });

  const concatPath = path.join(tempDir, "overlay.ffconcat");
  const concatLines = ["ffconcat version 1.0"];
  for (const entry of entries) {
    concatLines.push(`file '${entry.file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`);
    concatLines.push(`duration ${Math.max(0.001, entry.duration).toFixed(6)}`);
  }
  concatLines.push(`file '${entries.at(-1).file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`);
  await fs.writeFile(concatPath, `${concatLines.join("\n")}\n`, "utf8");
  return concatPath;
}

async function createPreviewProxy(filePath) {
  const stat = await fs.stat(filePath);
  const key = crypto.createHash("sha256")
    .update(`${filePath}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  const outputPath = path.join(os.tmpdir(), `captionforge-preview-${key}.mp4`);
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    // A preview for this source has not been created yet.
  }
  await runProcess(ffmpegPath, [
    "-y", "-i", filePath,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath
  ]);
  return outputPath;
}

function softwareVideoArgs(encoder, settings) {
  const quality = settings.quality;
  const preset = quality === "draft" ? "veryfast" : quality === "high" ? "medium" : "fast";
  const crf = encoder === "libx265"
    ? quality === "draft" ? "28" : quality === "high" ? "20" : "24"
    : quality === "draft" ? "24" : quality === "high" ? "17" : "20";
  return ["-preset", preset, "-crf", crf];
}

function hardwareVideoArgs(settings, dimensions) {
  const pixels = dimensions.width * dimensions.height;
  const multiplier = pixels / (1080 * 1920);
  const baseMbps = settings.quality === "draft" ? 6 : settings.quality === "high" ? 16 : 10;
  return ["-b:v", `${Math.max(2, Math.round(baseMbps * Math.max(0.45, multiplier)))}M`];
}

async function renderVideo(project, outputPath, context, rawSettings = {}) {
  const settings = normalizeExportSettings(rawSettings);
  const dimensions = exportDimensions(project.video, settings.resolution);
  const renderProject = projectAtDimensions(project, dimensions);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "captionforge-render-"));
  const assPath = path.join(tempDir, "captions.ass");
  try {
    context.onProgress({ stage: "export", value: 0.01, message: "Matching the export font…" });
    const resolvedFontFace = await resolveFontFace(
      renderProject.style.fontFamily,
      renderProject.style.fontWeight,
      renderProject.style.fontStyle
    );
    // Prefer an actual user font file over CoreText's synthesized face names
    // (for example, "Inter Regular Bold" for a variable Inter installation).
    const userFontFile = await resolveUserFontFile(renderProject.style.fontFamily);
    const captionText = renderProject.cues.map((cue) => cue.text).join("\n");
    const staticFontDirectory = userFontFile
      ? await createStaticFontInstance(userFontFile, renderProject.style.fontWeight, tempDir, captionText)
      : null;
    const assProject = staticFontDirectory
      ? {
          ...renderProject,
          style: {
            ...renderProject.style,
            // The temporary font already contains the requested outlines.
            // Zero prevents libass from applying a second synthetic bold pass.
            fontWeight: 0
          }
        }
      : resolvedFontFace
      ? {
          ...renderProject,
          style: {
            ...renderProject.style,
            fontFamily: resolvedFontFace,
            fontWeight: 0
          }
        }
      : renderProject;
    await fs.writeFile(assPath, buildAss(assProject), "utf8");
    const useAss = Boolean(staticFontDirectory || resolvedFontFace) && await supportsAssFilter();
    const userFontDirectory = staticFontDirectory || (useAss ? await resolveUserFontDirectory() : null);
    const overlayTimeline = useAss ? null : await createRasterTimeline(renderProject, tempDir, context);
    const softwareEncoder = settings.codec === "hevc" ? "libx265" : "libx264";
    const preferredEncoder = await selectEncoder(settings.codec, settings.hardwareAcceleration);
    const encoders = preferredEncoder === softwareEncoder ? [softwareEncoder] : [preferredEncoder, softwareEncoder];
    for (const [index, encoder] of encoders.entries()) {
      context.onProgress({
        stage: "export",
        value: index === 0 ? 0.1 : 0.11,
        message: index === 0 ? `Rendering with ${encoder}…` : "Hardware encoder unavailable. Retrying safely…"
      });
      try {
        const captionArgs = useAss
          ? ["-vf", `scale=${dimensions.width}:${dimensions.height},${buildAssFilter(assPath, userFontDirectory)}`]
          : [
              "-f", "concat", "-safe", "0", "-i", overlayTimeline,
              "-filter_complex", `[0:v]scale=${dimensions.width}:${dimensions.height}[base];[base][1:v]overlay=0:0:format=auto[vout]`,
              "-map", "[vout]", "-map", "0:a:0?"
            ];
        const isSoftware = encoder === "libx264" || encoder === "libx265";
        await runProcess(ffmpegPath, [
          "-y", "-i", project.video.path,
          ...captionArgs,
          "-dn",
          "-c:v", encoder,
          ...(isSoftware ? softwareVideoArgs(encoder, settings) : hardwareVideoArgs(settings, dimensions)),
          ...(settings.frameRate === "source" ? [] : ["-r", settings.frameRate]),
          ...(settings.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", `${settings.audioBitrate}k`,
          "-movflags", "+faststart",
          "-progress", "pipe:1", "-nostats",
          outputPath
        ], {
          signal: context.signal,
          onStdout(value) {
            const match = value.match(/out_time_ms=(\d+)/);
            if (!match) return;
            const seconds = Number(match[1]) / 1_000_000;
            const ratio = Math.min(1, seconds / project.video.duration);
            const progress = Math.min(0.99, 0.1 + ratio * 0.89);
            context.onProgress({ stage: "export", value: progress, message: `Rendering… ${Math.round(ratio * 100)}%` });
          }
        });
        break;
      } catch (error) {
        if (context.signal.aborted || encoder === "libx264") throw error;
      }
    }
    context.onProgress({ stage: "complete", value: 1, message: "Export complete" });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_EXPORT_SETTINGS,
  normalizeExportSettings,
  exportDimensions,
  displayDimensions,
  probeMedia,
  buildAss,
  buildAssFilter,
  createPreviewProxy,
  renderVideo
};
