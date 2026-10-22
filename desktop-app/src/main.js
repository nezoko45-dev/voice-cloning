const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const extractZip = require("extract-zip");
const tar = require("tar");
const ffmpegPath = require("ffmpeg-static");

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

function runtimeDir() { return path.join(app.getPath("userData"), "runtime"); }
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
function runProcess(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...options });
    let stderr = "";
    child.stdout?.on("data", chunk => {
      const line = chunk.toString().trim();
      if (line) sendProgress(line.slice(-220));
    });
    child.stderr?.on("data", chunk => {
      const line = chunk.toString();
      stderr += line;
      const latest = line.trim();
      if (latest) sendProgress(latest.slice(-220));
    });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.trim().slice(-1400) || `Process exited with code ${code}`)));
  });
}
async function walkForExecutable(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const found = await walkForExecutable(full);
      if (found) return found;
    } else if (/^pocket-tts(?:\.exe)?$/i.test(entry.name)) return full;
  }
  return null;
}
async function installEngine() {
  const dir = runtimeDir();
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, "engine-path.json");
  try {
    const saved = JSON.parse(await fs.readFile(marker, "utf8"));
    await fs.access(saved.path);
    return saved.path;
  } catch {}
  if (installPromise) return installPromise;
  installPromise = (async () => {
    sendProgress("Connecting to the official Pocket TTS release…");
    const apiUrl = `https://api.github.com/repos/${ENGINE_REPO}/releases/tags/${ENGINE_TAG}`;
    const releaseResponse = await fetch(apiUrl, { headers: { "Accept": "application/vnd.github+json", "User-Agent": "Voice-Studio-Desktop" } });
    if (!releaseResponse.ok) throw new Error(`Could not check the official engine release (HTTP ${releaseResponse.status}).`);
    const release = await releaseResponse.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const candidates = assets.filter(asset => {
      const name = asset.name.toLowerCase();
      return name.includes("windows") && (name.includes("x86_64") || name.includes("x86-64") || name.includes("win64")) && (name.endsWith(".zip") || name.endsWith(".tar.gz"));
    });
    if (!candidates.length) throw new Error("The pinned Pocket TTS release did not expose a recognizable Windows x64 archive. Please check the release page before retrying.");
    const asset = candidates[0];
    sendProgress(`Downloading Pocket TTS ${ENGINE_TAG} (${asset.name})…`);
    const response = await fetch(asset.browser_download_url, { headers: { "User-Agent": "Voice-Studio-Desktop" } });
    if (!response.ok || !response.body) throw new Error(`Engine download failed (HTTP ${response.status}).`);
    const archivePath = path.join(dir, asset.name);
    await pipeline(Readable.fromWeb(response.body), (await import("node:fs")).createWriteStream(archivePath));
    if (asset.digest && asset.digest.startsWith("sha256:")) {
      sendProgress("Verifying downloaded engine…");
      const hash = crypto.createHash("sha256").update(await fs.readFile(archivePath)).digest("hex");
      if (hash.toLowerCase() !== asset.digest.slice(7).toLowerCase()) {
        await fs.rm(archivePath, { force: true });
        throw new Error("Engine archive checksum did not match GitHub's published SHA-256 digest.");
      }
    }
    const unpackDir = path.join(dir, "unpacked");
    await fs.rm(unpackDir, { recursive: true, force: true });
    await fs.mkdir(unpackDir, { recursive: true });
    sendProgress("Extracting the native Windows engine…");
    if (asset.name.toLowerCase().endsWith(".zip")) await extractZip(archivePath, { dir: unpackDir });
    else await tar.x({ file: archivePath, cwd: unpackDir, strict: true });
    const executable = await walkForExecutable(unpackDir);
    if (!executable) throw new Error("The downloaded archive did not contain the expected pocket-tts executable.");
    if (process.platform === "win32" && !executable.toLowerCase().endsWith(".exe")) throw new Error("The release archive did not contain a Windows .exe.");
    await fs.writeFile(marker, JSON.stringify({ path: executable, version: ENGINE_TAG }, null, 2), "utf8");
    await fs.rm(archivePath, { force: true });
    sendProgress("Native engine installed. The speech model downloads on first generation.");
    return executable;
  })();
  try { return await installPromise; } finally { installPromise = null; }
}
async function resolveFfmpegExecutable() {
  if (!ffmpegPath) throw new Error("The bundled FFmpeg converter is missing. Reinstall Voice Studio using the latest Windows installer.");
  // Native executables cannot be launched from inside Electron's ASAR archive.
  // electron-builder places asarUnpack files beside app.asar in app.asar.unpacked.
  const candidates = [];
  if (app.isPackaged) candidates.push(ffmpegPath.replace(/app\.asar([\\/])/i, "app.asar.unpacked$1"));
  candidates.push(ffmpegPath);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("FFmpeg was not found in the installed app. Please reinstall the latest Voice Studio installer. Expected an executable under resources\\app.asar.unpacked\\node_modules\\ffmpeg-static.");
}
async function normalizeAudio(inputPath) {
  const executable = await resolveFfmpegExecutable();
  await fs.mkdir(workDir(), { recursive: true });
  const outputPath = path.join(workDir(), `reference-${Date.now()}.wav`);
  await runProcess(executable, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", outputPath]);
  return outputPath;
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
  ipcMain.handle("app:engine-status", async () => {
    try {
      const marker = JSON.parse(await fs.readFile(path.join(runtimeDir(), "engine-path.json"), "utf8"));
      await fs.access(marker.path);
      return { ready: true, version: marker.version };
    } catch { return { ready: false, message: "Pocket TTS will be downloaded automatically the first time you generate speech. Internet is required for the initial engine and model downloads." }; }
  });
  ipcMain.handle("tts:generate", async (_event, request) => {
    if (!request || typeof request.text !== "string" || !request.text.trim()) throw new Error("Enter text to generate speech.");
    if (request.text.length > 12000) throw new Error("Text is limited to 12,000 characters.");
    if (!request.referencePath) throw new Error("Choose a voice recording first.");
    if (process.platform !== "win32") throw new Error("This initial build targets Windows 10/11 x64.");
    await fs.mkdir(cacheDir(), { recursive: true });
    const outputDir = path.join(app.getPath("documents"), "Voice Studio");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "voice-studio-output.wav");
    const rawOutputPath = path.join(workDir(), `generated-raw-${Date.now()}.wav`);
    await fs.access(request.referencePath).catch(() => { throw new Error("The selected reference recording can no longer be found. Choose the WAV file again."); });
    const referenceStat = await fs.stat(request.referencePath);
    if (!referenceStat.isFile() || referenceStat.size < 44) throw new Error("The selected reference recording is empty or is not a valid audio file.");
    sendProgress(`Using reference recording: ${path.basename(request.referencePath)}. Text length: ${request.text.length} characters.`);
    const binary = await installEngine();
    const normalizedPath = await normalizeAudio(request.referencePath);
    try {
      sendProgress("Generating the exact text entered in Voice Studio with the selected reference recording…");
      await runProcess(binary, ["generate", "--text", request.text, "--voice", normalizedPath, "--output-path", rawOutputPath, "--language", "english"], {
        cwd: workDir(),
        env: { ...process.env, HF_HOME: cacheDir(), HF_HUB_CACHE: path.join(cacheDir(), "hub"), HUGGINGFACE_HUB_CACHE: path.join(cacheDir(), "hub") }
      });
      const rawStat = await fs.stat(rawOutputPath).catch(() => null);
      if (!rawStat || rawStat.size < 44) throw new Error("Pocket TTS exited without creating a valid output file. No new speech was generated; check the status messages above and try again.");
      sendProgress("Converting audio to a standard PCM WAV file…");
      const ffmpeg = await resolveFfmpegExecutable();
      await runProcess(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", rawOutputPath, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", outputPath]);
      const stat = await fs.stat(outputPath);
      if (stat.size < 44) throw new Error("The converted output WAV is empty or invalid.");
      sendProgress(`Generated ${request.text.length} characters using ${path.basename(request.referencePath)}. Saved to Documents\\Voice Studio\\voice-studio-output.wav.`);
      return { outputPath, audioUrl: pathToFileURL(outputPath).href };
    } finally {
      await fs.rm(normalizedPath, { force: true }).catch(() => {});
      await fs.rm(rawOutputPath, { force: true }).catch(() => {});
    }
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (bridgeServer) bridgeServer.close(); });
