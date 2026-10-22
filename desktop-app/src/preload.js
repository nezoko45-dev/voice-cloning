const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voiceStudio", {
  chooseReference: () => ipcRenderer.invoke("audio:choose-reference"),
  chooseOutput: () => ipcRenderer.invoke("audio:choose-output"),
  showOutput: outputPath => ipcRenderer.invoke("audio:show-output", outputPath),
  getEngineStatus: () => ipcRenderer.invoke("app:engine-status"),
  generate: request => ipcRenderer.invoke("tts:generate", request)
});