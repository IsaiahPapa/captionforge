const { renderVideo } = require("../electron/services/media.cjs");

const videoPath = process.argv[2];
const outputPath = process.argv[3];
if (!videoPath || !outputPath) {
  console.error("Usage: node tests/export-stress.cjs input.mp4 output.mp4");
  process.exit(2);
}

const words = Array.from({ length: 180 }, (_, index) => ({
  id: `word-${index}`,
  text: `word${index}`,
  start: index * 0.22,
  end: Math.min(40.2, index * 0.22 + 0.2)
}));
const cues = [];
for (let index = 0; index < words.length; index += 3) {
  const batch = words.slice(index, index + 3);
  cues.push({
    id: `cue-${index / 3}`,
    start: batch[0].start,
    end: batch.at(-1).end,
    text: batch.map((word) => word.text).join(" "),
    words: batch
  });
}

const project = {
  version: 1,
  language: "en",
  video: {
    path: videoPath,
    name: "stress-test.mp4",
    width: 1080,
    height: 1920,
    duration: 40.25,
    fps: 24,
    size: 0
  },
  cues,
  style: {
    id: "stress",
    name: "Stress",
    fontFamily: "Arial",
    fontSize: 72,
    fontWeight: 800,
    fontStyle: "normal",
    letterSpacing: 0,
    primaryColor: "#ffffff",
    activeColor: "#f6e44d",
    outlineColor: "#080808",
    outlineWidth: 5,
    shadow: 2,
    position: "center",
    marginPercent: 10,
    verticalOffsetPercent: 0,
    uppercase: true,
    highlightActiveWord: true,
    transition: "pop"
  }
};

renderVideo(project, outputPath, {
  signal: new AbortController().signal,
  onProgress(progress) {
    console.log(JSON.stringify(progress));
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
