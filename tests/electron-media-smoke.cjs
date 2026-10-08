const { app, BrowserWindow, protocol } = require("electron");
const { serveMediaFile } = require("../electron/services/media-protocol.cjs");

const mediaPath = process.argv[2];
if (!mediaPath) {
  console.error("Usage: electron tests/electron-media-smoke.cjs /absolute/path/to/video.mp4");
  process.exit(2);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "captionforge-smoke",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

app.whenReady().then(async () => {
  protocol.handle("captionforge-smoke", (request) => serveMediaFile(request, mediaPath));
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,<video id='video' muted></video>");
  const mediaUrl = `captionforge-smoke://media/video?path=${encodeURIComponent(mediaPath)}`;
  const result = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const video = document.getElementById("video");
      const timeout = setTimeout(() => resolve({ ok: false, reason: "timeout", readyState: video.readyState }), 15000);
      video.addEventListener("loadedmetadata", () => {
        const target = Math.min(Math.max(video.duration * 0.6, 0.1), Math.max(video.duration - 0.1, 0.1));
        const finishIfTargetWasReached = () => {
          if (Math.abs(video.currentTime - target) >= 0.25) return;
          clearTimeout(timeout);
          resolve({
            ok: true,
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            currentTime: video.currentTime,
            target,
            readyState: video.readyState
          });
        };
        video.addEventListener("seeked", finishIfTargetWasReached);
        video.addEventListener("timeupdate", finishIfTargetWasReached);
        video.currentTime = target;
      }, { once: true });
      video.addEventListener("error", () => {
        clearTimeout(timeout);
        resolve({ ok: false, reason: "media-error", code: video.error?.code, message: video.error?.message });
      }, { once: true });
      video.src = ${JSON.stringify(mediaUrl)};
      video.load();
    })
  `);
  console.log(JSON.stringify(result));
  app.exit(result.ok ? 0 : 1);
});
