const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { Worker } = require("node:worker_threads");
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = new Set(["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]);
let inferenceWorker = null;
let inferenceRequestId = 0;
const inferenceRequests = new Map();
let kokoroReady = false;
let whisperReady = false;

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 47831;
const MAX_BRIDGE_BODY = 24 * 1024;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
let mainWindow;
let bridgeServer = null;
let bridgeToken = null;

function sendProgress(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("runtime:progress", message);
}
function sendBridgeText(text) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("bridge:text", { text });
}
async function loadBridgeToken() {
  const tokenPath = path.join(app.getPath("userData"), "bridge-token.txt");
  try {
    const existing = (await fs.readFile(tokenPath, "utf8")).trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return existing;
  } catch {}
  const token = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, token, { encoding: "utf8", mode: 0o600 });
  return token;
}
function replyJson(res, status, body, origin = "") {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
  });
  res.end(JSON.stringify(body));
}
async function startBridge() {
  bridgeToken = await loadBridgeToken();
  bridgeServer = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (!EXTENSION_ORIGIN.test(origin)) return replyJson(res, 403, { ok: false, error: "Only a Chrome extension origin is accepted." });
    if (req.method === "OPTIONS" && (req.url === "/api/text" || req.url === "/api/health")) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "300",
        "Vary": "Origin"
      });
      return res.end();
    }
    if (req.method === "GET" && req.url === "/api/health") {
      if (req.headers.authorization !== `Bearer ${bridgeToken}`) return replyJson(res, 401, { ok: false, error: "Bridge token is missing or incorrect." }, origin);
      return replyJson(res, 200, { ok: true, app: "Voice Studio" }, origin);
    }
    if (req.method !== "POST" || req.url !== "/api/text") {
      return replyJson(res, 404, { ok: false, error: "Not found." }, origin);
    }
    if (req.headers.authorization !== `Bearer ${bridgeToken}`) {
      return replyJson(res, 401, { ok: false, error: "Bridge token is missing or incorrect." }, origin);
    }
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return replyJson(res, 415, { ok: false, error: "Send application/json." }, origin);
    const length = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(length) && length > MAX_BRIDGE_BODY) {
      req.resume();
      return replyJson(res, 413, { ok: false, error: "Text payload is too large (maximum 12,000 characters)." }, origin);
    }
    try {
      let raw = "";
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BRIDGE_BODY) {
          res.destroy();
          return;
        }
        raw += chunk.toString("utf8");
      }
      const body = JSON.parse(raw);
      if (!body || typeof body.text !== "string") return replyJson(res, 400, { ok: false, error: "Request must contain a text string." }, origin);
      const text = body.text.trim();
      if (!text) return replyJson(res, 400, { ok: false, error: "Text cannot be empty." }, origin);
      if (text.length > 12000) return replyJson(res, 413, { ok: false, error: "Text exceeds the 12,000-character limit." }, origin);
      if (!mainWindow || mainWindow.isDestroyed()) return replyJson(res, 503, { ok: false, error: "Voice Studio is not open." }, origin);
      sendBridgeText(text);
      return replyJson(res, 200, { ok: true, received: text.length }, origin);
    } catch {
      if (!res.destroyed) replyJson(res, 400, { ok: false, error: "Invalid JSON request body." }, origin);
    }
  });
  bridgeServer.on("error", error => sendProgress(`Local extension bridge could not start: ${error.message}`));
  bridgeServer.listen(BRIDGE_PORT, BRIDGE_HOST);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 820, minWidth: 760, minHeight: 640,
    backgroundColor: "#111318", title: "Voice Studio",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
function runInference(action, payload) {
  if (!inferenceWorker) {
    inferenceWorker = new Worker(path.join(__dirname, "inference-worker.js"), {
      workerData: { userDataPath: app.getPath("userData") }
    });
    inferenceWorker.on("message", message => {
      if (!message) return;
      if (message.type === "progress") return sendProgress(message.message);
      if (message.type === "model-ready") {
        if (message.model === "kokoro") kokoroReady = true;
        if (message.model === "whisper") whisperReady = true;
        return;
      }
      const pending = inferenceRequests.get(message.id);
      if (!pending) return;
      inferenceRequests.delete(message.id);
      if (message.type === "error") pending.reject(new Error(message.error || "Background inference failed."));
      else pending.resolve(message.result);
    });
    inferenceWorker.on("error", error => {
      for (const pending of inferenceRequests.values()) pending.reject(error);
      inferenceRequests.clear();
      inferenceWorker = null;
      sendProgress("Background speech worker stopped: " + error.message);
    });
    inferenceWorker.on("exit", code => {
      if (inferenceWorker && code !== 0) {
        const error = new Error("Background speech worker exited unexpectedly (" + code + ").");
        for (const pending of inferenceRequests.values()) pending.reject(error);
        inferenceRequests.clear();
        inferenceWorker = null;
      }
    });
  }
  const id = ++inferenceRequestId;
  return new Promise((resolve, reject) => {
    inferenceRequests.set(id, { resolve, reject });
    try {
      inferenceWorker.postMessage({ id, action, payload });
    } catch (error) {
      inferenceRequests.delete(id);
      reject(error);
    }
  });
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(mainWindow && webContents === mainWindow.webContents && permission === "media"));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(mainWindow && webContents === mainWindow.webContents && permission === "media")
  );
  await startBridge();
  ipcMain.handle("bridge:get-info", () => ({ host: BRIDGE_HOST, port: BRIDGE_PORT, token: bridgeToken }));
  ipcMain.handle("bridge:copy-token", () => { clipboard.writeText(bridgeToken); return true; });
  ipcMain.handle("speech:transcribe", async (_event, request) => {
    if (!request || !(request.samples instanceof Float32Array)) throw new Error("Invalid audio recording.");
    return { text: await runInference("transcribe", { samples: request.samples }) };
  });
  ipcMain.handle("audio:choose-reference", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a voice recording", properties: ["openFile"],
      filters: [{ name: "Audio and video files", extensions: ["wav","mp3","m4a","flac","ogg","opus","aac","aiff","wma","mp4","webm","mov","mkv"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0], stat = await fs.stat(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size };
  });
  ipcMain.handle("audio:choose-output", async (_event, currentPath) => {
    const defaultPath = typeof currentPath === "string" && path.isAbsolute(currentPath) ? currentPath : path.join(app.getPath("documents"), "Voice Studio", "voice-studio-output.wav");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Choose output audio file", defaultPath,
      filters: [{ name: "WAV audio", extensions: ["wav"] }]
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle("audio:show-output", async (_event, outputPath) => {
    if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new Error("Invalid output path.");
    await shell.showItemInFolder(outputPath);
  });
  ipcMain.handle("app:engine-status", async () => ({
    ready: kokoroReady,
    version: "Kokoro 82M (ONNX)",
    message: "Kokoro runs locally. Its model is downloaded on the first generation and cached on this PC; internet is needed only for that initial download."
  }));
  ipcMain.handle("tts:generate", async (_event, request) => {
    if (!request || typeof request.text !== "string" || !request.text.trim()) throw new Error("Enter text to generate speech.");
    if (request.text.length > 12000) throw new Error("Text is limited to 12,000 characters.");
    if (process.platform !== "win32") throw new Error("This initial build targets Windows 10/11 x64.");
    const outputDir = path.join(app.getPath("documents"), "Voice Studio");
    const requestedOutputPath = typeof request.outputPath === "string" ? request.outputPath.trim() : "";
    const outputPath = requestedOutputPath || path.join(outputDir, "voice-studio-output.wav");
    if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== ".wav") throw new Error("Choose a valid absolute output path ending in .wav.");
    const result = await runInference("generate", {
      text: request.text.trim(),
      voice: typeof request.voice === "string" ? request.voice : "af_heart",
      outputPath
    });
    return { ...result, audioUrl: pathToFileURL(result.outputPath).href };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  if (bridgeServer) bridgeServer.close();
  if (inferenceWorker) inferenceWorker.terminate().catch(() => {});
});
