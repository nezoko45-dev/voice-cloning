const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voiceStudio", {
  chooseReference: () => ipcRenderer.invoke("audio:choose-reference"),
  chooseOutput: () => ipcRenderer.invoke("audio:choose-output"),
  getEngineStatus: () => ipcRenderer.invoke("app:engine-status"),
  generate: request => ipcRenderer.invoke("tts:generate", request)
});