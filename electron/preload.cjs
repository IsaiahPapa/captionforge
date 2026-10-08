const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("captionForge", {
  openVideo: () => ipcRenderer.invoke("dialog:open-video"),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  createPreview: (filePath) => ipcRenderer.invoke("media:create-preview", filePath),
  listFonts: () => ipcRenderer.invoke("fonts:list"),
  listModels: () => ipcRenderer.invoke("models:list"),
  loadState: (legacyState) => ipcRenderer.invoke("state:load", legacyState),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  transcribe: (options) => ipcRenderer.invoke("transcription:start", options),
  exportVideo: (project, settings) => ipcRenderer.invoke("export:start", project, settings),
  cancelJob: () => ipcRenderer.invoke("job:cancel"),
  mediaUrl: (filePath) => `captionforge://media/video?path=${encodeURIComponent(filePath)}`,
  onProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("job:progress", handler);
    return () => ipcRenderer.removeListener("job:progress", handler);
  }
});
