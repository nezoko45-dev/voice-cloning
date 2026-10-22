const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
let mainWindow;
function enginePath() {
  return app.isPackaged ? path.join(process.resourcesPath, "runtime", "voice-engine.exe") : path.join(__dirname, "..", "runtime", "voice-engine.exe");
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1120, height: 820, minWidth: 760, minHeight: 640, backgroundColor: "#111318", title: "Voice Studio", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
app.whenReady().then(() => {
  ipcMain.handle("audio:choose-reference", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Choose a voice recording", properties: ["openFile"], filters: [{ name: "Audio files", extensions: ["wav","mp3","m4a","flac","ogg","opus","aac","aiff","wma","mp4","webm"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0], stat = await fs.stat(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size };
  });
  ipcMain.handle("audio:choose-output", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: "Save generated speech", defaultPath: "voice-studio-output.wav", filters: [{ name: "WAV audio", extensions: ["wav"] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle("audio:show-output", async (_event, outputPath) => {
    if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new Error("Invalid output path.");
    await shell.showItemInFolder(outputPath);
  });
  ipcMain.handle("app:engine-status", async () => {
    try { await fs.access(enginePath()); return { ready: true }; }
    catch { return { ready: false, message: "The Windows voice engine has not been bundled yet. This build has the app interface, but speech generation needs a compatible local runtime and model." }; }
  });
  ipcMain.handle("tts:generate", async (_event, request) => {
    if (!request || typeof request.text !== "string" || !request.text.trim()) throw new Error("Enter text to generate speech.");
    if (!request.referencePath) throw new Error("Choose a voice recording first.");
    if (!request.outputPath) throw new Error("Choose an output WAV path.");
    const binary = enginePath();
    try { await fs.access(binary); } catch { throw new Error("The speech engine is not included in this build yet. No text or audio was sent anywhere."); }
    const child = spawn(binary, ["--text", request.text, "--reference", request.referencePath, "--output", request.outputPath], { windowsHide: true, stdio: ["ignore","ignore","pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.trim() || "Voice engine failed."))); });
    return { outputPath: request.outputPath };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });