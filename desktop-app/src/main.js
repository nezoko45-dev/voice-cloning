const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const extractZip = require("extract-zip");
const tar = require("tar");
const ffmpegPath = require("ffmpeg-static");

const ENGINE_REPO = "kyutai-labs/pocket-tts";
const ENGINE_TAG = "v4.0.1";
let mainWindow;
let installPromise = null;

function runtimeDir() { return path.join(app.getPath("userData"), "runtime"); }
function workDir() { return path.join(app.getPath("userData"), "work"); }
function cacheDir() { return path.join(app.getPath("userData"), "model-cache"); }
function sendProgress(message) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("runtime:progress", message);
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
    if (process.platform === "win32" && !executable.toLowerCase().endsWith(".exe")) {
      throw new Error("The release archive did not contain a Windows .exe.");
    }
    await fs.writeFile(marker, JSON.stringify({ path: executable, version: ENGINE_TAG }, null, 2), "utf8");
    await fs.rm(archivePath, { force: true });
    sendProgress("Native engine installed. The speech model downloads on first generation.");
    return executable;
  })();
  try { return await installPromise; } finally { installPromise = null; }
}
async function normalizeAudio(inputPath) {
  if (!ffmpegPath) throw new Error("The bundled FFmpeg converter is missing from this build.");
  await fs.mkdir(workDir(), { recursive: true });
  const outputPath = path.join(workDir(), `reference-${Date.now()}.wav`);
  await runProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", outputPath]);
  return outputPath;
}
app.whenReady().then(() => {
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
    if (!request.referencePath) throw new Error("Choose a voice recording first.");
    if (!request.outputPath) throw new Error("Choose an output WAV path.");
    if (process.platform !== "win32") throw new Error("This initial build targets Windows 10/11 x64.");
    await fs.mkdir(cacheDir(), { recursive: true });
    const binary = await installEngine();
    const normalizedPath = await normalizeAudio(request.referencePath);
    try {
      sendProgress("Loading the local speech model. The first run downloads model files; later runs use the local cache.");
      await runProcess(binary, ["generate", "--text", request.text, "--voice", normalizedPath, "--output-path", request.outputPath, "--language", "english"], {
        cwd: workDir(),
        env: {
          ...process.env,
          HF_HOME: cacheDir(),
          HF_HUB_CACHE: path.join(cacheDir(), "hub"),
          HUGGINGFACE_HUB_CACHE: path.join(cacheDir(), "hub")
        }
      });
      const stat = await fs.stat(request.outputPath);
      if (stat.size < 44) throw new Error("The engine finished but the output WAV is empty or invalid.");
      sendProgress("Speech generation finished.");
      return { outputPath: request.outputPath };
    } finally {
      await fs.rm(normalizedPath, { force: true }).catch(() => {});
    }
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });