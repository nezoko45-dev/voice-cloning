const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("voiceStudio", {
  chooseReference: () => ipcRenderer.invoke("audio:choose-reference"),
  chooseOutput: currentPath => ipcRenderer.invoke("audio:choose-output", currentPath),
  showOutput: outputPath => ipcRenderer.invoke("audio:show-output", outputPath),
  getEngineStatus: () => ipcRenderer.invoke("app:engine-status"),
  getBridgeInfo: () => ipcRenderer.invoke("bridge:get-info"),
  copyBridgeToken: () => ipcRenderer.invoke("bridge:copy-token"),
  generate: request => ipcRenderer.invoke("tts:generate", request),
  transcribe: samples => ipcRenderer.invoke("speech:transcribe", { samples }),
  onBridgeText: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bridge:text", listener);
    return () => ipcRenderer.removeListener("bridge:text", listener);
  },
  onProgress: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("runtime:progress", listener);
    return () => ipcRenderer.removeListener("runtime:progress", listener);
  }
});
