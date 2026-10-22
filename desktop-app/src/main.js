const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = new Set(["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]);
let kokoroPipelinePromise = null;
let kokoroPipeline = null;

const ENGINE_REPO = "kyutai-labs/pocket-tts";
const ENGINE_TAG = "v4.0.1";
const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 47831;
const MAX_BRIDGE_BODY = 24 * 1024;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
let mainWindow;
let installPromise = null;
let bridgeServer = null;
let bridgeToken = null;

function workDir() { return path.join(app.getPath("userData"), "work"); }
function cacheDir() { return path.join(app.getPath("userData"), "model-cache"); }
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}
function splitTextIntoChunks(text, maxChars = 360) {
  const sentences = text.trim().match(/[^.!?]+[.!?]+[)"'\\]]*|[^.!?]+$/g) || [text.trim()];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length <= maxChars && (!current || (current.length + 1 + part.length) <= maxChars)) {
      current = current ? current + " " + part : part;
      continue;
    }
    if (current) { chunks.push(current); current = ""; }
    if (part.length <= maxChars) { current = part; continue; }
    let piece = "";
    for (const word of part.split(/\\s+/)) {
      if (piece && piece.length + 1 + word.length > maxChars) {
        chunks.push(piece);
        piece = "";
      }
      piece = piece ? piece + " " + word : word;
    }
    if (piece) current = piece;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.trim()];
}
async function getKokoroPipeline() {
  if (kokoroPipeline) return kokoroPipeline;
  if (kokoroPipelinePromise) return kokoroPipelinePromise;
  kokoroPipelinePromise = (async () => {
    const modelCache = path.join(app.getPath("userData"), "kokoro-model-cache");
    await fs.mkdir(modelCache, { recursive: true });
    sendProgress("Preparing Kokoro TTS. The first run downloads its local model (internet required).");
    const transformers = await import("@huggingface/transformers");
    transformers.env.cacheDir = modelCache;
    transformers.env.allowRemoteModels = true;
    transformers.env.useBrowserCache = false;
    const tts = await transformers.pipeline("text-to-speech", KOKORO_MODEL, {
      dtype: "q8",
      progress_callback: event => {
        if (!event || typeof event.status !== "string") return;
        if (event.status === "progress" && Number.isFinite(event.progress)) {
          sendProgress("Downloading Kokoro model: " + Math.round(event.progress) + "%");
        } else if (event.status === "done") {
          sendProgress("Kokoro model file ready.");
        } else if (event.status === "download") {
          sendProgress("Downloading Kokoro model file…");
        }
      }
    });
    kokoroPipeline = tts;
    return tts;
  })();
  try { return await kokoroPipelinePromise; }
  catch (error) {
    kokoroPipelinePromise = null;
    throw error;
  }
}
function writePcmWav(samples, sampleRate, outputPath) {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    wav.writeInt16LE(sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), 44 + i * 2);
  }
  return fs.writeFile(outputPath, wav);
}
app.whenReady().then(async () => {
  await startBridge();
  ipcMain.handle("bridge:get-info", () => ({ host: BRIDGE_HOST, port: BRIDGE_PORT, token: bridgeToken }));
  ipcMain.handle("bridge:copy-token", () => { clipboard.writeText(bridgeToken); return true; });
  ipcMain.handle("audio:choose-reference", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a voice recording", properties: ["openFile"],
      filters: [{ name: "Audio and video files", extensions: ["wav","mp3","m4a","flac","ogg","opus","aac","aiff","wma","mp4","webm","mov","mkv"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0], stat = await fs.stat(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size };
  });
  ipcMain.handle("audio:choose-output", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save generated speech", defaultPath: "voice-studio-output.wav",
      filters: [{ name: "WAV audio", extensions: ["wav"] }]
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle("audio:show-output", async (_event, outputPath) => {
    if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new Error("Invalid output path.");
    await shell.showItemInFolder(outputPath);
  });
  ipcMain.handle("app:engine-status", async () => ({
    ready: Boolean(kokoroPipeline),
    version: "Kokoro 82M (ONNX)",
    message: "Kokoro runs locally. Its model is downloaded on the first generation and cached on this PC; internet is needed only for that initial download."
  }));
  ipcMain.handle("tts:generate", async (_event, request) => {
    if (!request || typeof request.text !== "string" || !request.text.trim()) throw new Error("Enter text to generate speech.");
    if (request.text.length > 12000) throw new Error("Text is limited to 12,000 characters.");
    if (process.platform !== "win32") throw new Error("This initial build targets Windows 10/11 x64.");
    const voice = typeof request.voice === "string" && KOKORO_VOICES.has(request.voice) ? request.voice : "af_heart";
    const text = request.text.trim();
    const chunks = splitTextIntoChunks(text);
    const outputDir = path.join(app.getPath("documents"), "Voice Studio");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "voice-studio-output.wav");
    const tts = await getKokoroPipeline();
    const generatedChunks = [];
    let sampleRate = 24000;
    for (let i = 0; i < chunks.length; i++) {
      sendProgress("Kokoro is generating text chunk " + (i + 1) + " of " + chunks.length + " using voice " + voice + "…");
      const result = await tts(chunks[i], { voice });
      if (!result || !result.audio || !result.audio.length) throw new Error("Kokoro returned no audio for text chunk " + (i + 1) + ". Please try a shorter sentence.");
      if (Number.isFinite(result.sampling_rate)) sampleRate = result.sampling_rate;
      generatedChunks.push(Float32Array.from(result.audio));
    }
    const silenceLength = Math.round(sampleRate * 0.16);
    const totalSamples = generatedChunks.reduce((sum, chunk) => sum + chunk.length, 0) + Math.max(0, generatedChunks.length - 1) * silenceLength;
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    generatedChunks.forEach((chunk, index) => {
      combined.set(chunk, offset);
      offset += chunk.length;
      if (index < generatedChunks.length - 1) offset += silenceLength;
    });
    await writePcmWav(combined, sampleRate, outputPath);
    const stat = await fs.stat(outputPath);
    if (stat.size < 44 || combined.length === 0) throw new Error("Kokoro did not produce a valid WAV file.");
    sendProgress("Generated " + text.length + " characters with Kokoro voice " + voice + ". Saved to Documents\\\\Voice Studio\\\\voice-studio-output.wav.");
    return { outputPath, audioUrl: pathToFileURL(outputPath).href, voice, characters: text.length };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (bridgeServer) bridgeServer.close(); });
