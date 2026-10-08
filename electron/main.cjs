const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createPreviewProxy, probeMedia, renderVideo } = require("./services/media.cjs");
const { serveMediaFile } = require("./services/media-protocol.cjs");
const { transcribeVideo } = require("./services/transcription.cjs");
const { listModels } = require("./services/whisper-models.cjs");
const { listSystemFonts } = require("./services/fonts.cjs");
const { createStateStore } = require("./services/state.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "captionforge",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

let mainWindow;
let activeJob;

function sendProgress(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0d0e12",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  const stateStore = createStateStore(app.getPath("userData"));
  const modelsDirectory = path.join(app.getPath("userData"), "models");

  protocol.handle("captionforge", (request) => {
    const requestUrl = new URL(request.url);
    const filePath = requestUrl.searchParams.get("path");
    if (!filePath) return new Response("Missing media path", { status: 400 });
    return serveMediaFile(request, filePath);
  });

  ipcMain.handle("dialog:open-video", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a video",
      properties: ["openFile"],
      filters: [
        { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return probeMedia(result.filePaths[0]);
  });

  ipcMain.handle("media:create-preview", async (_event, filePath) => {
    return createPreviewProxy(filePath);
  });

  ipcMain.handle("fonts:list", () => listSystemFonts());
  ipcMain.handle("models:list", () => listModels(modelsDirectory));

  ipcMain.handle("state:load", (_event, legacyState) => stateStore.load(legacyState));
  ipcMain.handle("state:save", (_event, state) => stateStore.save(state));

  ipcMain.handle("project:save", async (_event, project) => {
    const suggestedName = `${path.parse(project.video.name).name}.captionforge.json`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save CaptionForge project",
      defaultPath: suggestedName,
      filters: [{ name: "CaptionForge project", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), "utf8");
    return result.filePath;
  });

  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open CaptionForge project",
      properties: ["openFile"],
      filters: [{ name: "CaptionForge project", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
  });

  ipcMain.handle("transcription:start", async (_event, options) => {
    const controller = new AbortController();
    activeJob = controller;
    try {
      return await transcribeVideo(options, {
        signal: controller.signal,
        modelsDirectory,
        onProgress: (progress) => sendProgress("job:progress", progress)
      });
    } finally {
      if (activeJob === controller) activeJob = null;
    }
  });

  ipcMain.handle("export:start", async (_event, project, settings) => {
    const baseName = `${path.parse(project.video.name).name}-captioned.mp4`;
    const sourceDirectory = project.video.path ? path.dirname(project.video.path) : "";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export captioned video",
      defaultPath: sourceDirectory ? path.join(sourceDirectory, baseName) : baseName,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }]
    });
    if (result.canceled || !result.filePath) return null;
    const controller = new AbortController();
    activeJob = controller;
    try {
      await renderVideo(project, result.filePath, {
        signal: controller.signal,
        onProgress: (progress) => sendProgress("job:progress", progress)
      }, settings);
      return result.filePath;
    } finally {
      if (activeJob === controller) activeJob = null;
    }
  });

  ipcMain.handle("job:cancel", () => {
    activeJob?.abort();
    return Boolean(activeJob);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
