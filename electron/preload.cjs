const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("captionForge", {
  openVideo: () => ipcRenderer.invoke("dialog:open-video"),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  createPreview: (filePath) => ipcRenderer.invoke("media:create-preview", filePath),
  listFonts: () => ipcRenderer.invoke("fonts:list"),
  listModels: () => ipcRenderer.invoke("models:list"),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (project) => ipcRenderer.invoke("projects:create", project),
  saveLibraryProject: (id, project) => ipcRenderer.invoke("projects:save", id, project),
  openLibraryProject: (id) => ipcRenderer.invoke("projects:open", id),
  importProject: (project, filePath, modifiedAt) => ipcRenderer.invoke("projects:import", project, filePath, modifiedAt),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  relinkProject: (id) => ipcRenderer.invoke("projects:relink", id),
  mediaExists: (filePath) => ipcRenderer.invoke("media:exists", filePath),
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
