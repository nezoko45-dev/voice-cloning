const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const fs = require("node:fs/promises");

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICES = new Set(["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]);
let kokoroPromise = null, kokoro = null, whisperPromise = null, whisper = null;

function progress(message) { parentPort.postMessage({ type: "progress", message }); }
function splitTextIntoChunks(text, maxChars = 360) {
  const sentences = text.trim().match(/[^.!?]+[.!?]*/g) || [text.trim()];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length <= maxChars && (!current || current.length + 1 + part.length <= maxChars)) {
      current = current ? current + " " + part : part;
      continue;
    }
    if (current) { chunks.push(current); current = ""; }
    if (part.length <= maxChars) { current = part; continue; }
    let piece = "";
    for (const word of part.split(/\s+/)) {
      if (piece && piece.length + 1 + word.length > maxChars) { chunks.push(piece); piece = ""; }
      piece = piece ? piece + " " + word : word;
    }
    if (piece) current = piece;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.trim()];
}
async function transformersFor(cacheName) {
  const cacheDir = path.join(workerData.userDataPath, cacheName);
  await fs.mkdir(cacheDir, { recursive: true });
  const transformers = await import("@huggingface/transformers");
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowRemoteModels = true;
  transformers.env.useBrowserCache = false;
  return transformers;
}
async function getKokoro() {
  if (kokoro) return kokoro;
  if (!kokoroPromise) kokoroPromise = (async () => {
    progress("Preparing Kokoro TTS in the background. The first run downloads its local model.");
    const transformers = await transformersFor("kokoro-model-cache");
    const { KokoroTTS } = await import("kokoro-js");
    const model = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: "q8", device: "cpu",
      progress_callback: event => {
        if (!event || typeof event.status !== "string") return;
        if (event.status === "progress" && Number.isFinite(event.progress)) progress("Downloading Kokoro model: " + Math.round(event.progress) + "%");
        else if (event.status === "done") progress("Kokoro model file ready.");
        else if (event.status === "download") progress("Downloading Kokoro model file…");
      }
    });
    kokoro = model;
    parentPort.postMessage({ type: "model-ready", model: "kokoro" });
    return model;
  })();
  try { return await kokoroPromise; } catch (error) { kokoroPromise = null; throw error; }
}
async function getWhisper() {
  if (whisper) return whisper;
  if (!whisperPromise) whisperPromise = (async () => {
    progress("Preparing offline speech recognition in the background. First use downloads a local Whisper model.");
    const transformers = await transformersFor("speech-model-cache");
    const model = await transformers.pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
      dtype: "q8", device: "cpu",
      progress_callback: event => {
        if (event && event.status === "progress" && Number.isFinite(event.progress)) progress("Downloading speech recognition model: " + Math.round(event.progress) + "%");
      }
    });
    whisper = model;
    parentPort.postMessage({ type: "model-ready", model: "whisper" });
    return model;
  })();
  try { return await whisperPromise; } catch (error) { whisperPromise = null; throw error; }
}
async function transcribe(samples) {
  if (!(samples instanceof Float32Array) || samples.length < 1600) throw new Error("No clear speech was captured. Please try again.");
  if (samples.length > 16000 * 180) throw new Error("Recording is longer than 3 minutes. Please record a shorter segment.");
  const model = await getWhisper();
  progress("Transcribing your recording locally in the background…");
  const result = await model(samples, { chunk_length_s: 30, stride_length_s: 5 });
  const text = result && typeof result.text === "string" ? result.text.trim() : "";
  if (!text) throw new Error("No speech was recognized. Try speaking closer to the microphone.");
  return text;
}
async function writePcmWav(samples, sampleRate, outputPath) {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    wav.writeInt16LE(sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), 44 + i * 2);
  }
  await fs.writeFile(outputPath, wav);
}
async function generate(request) {
  const voice = KOKORO_VOICES.has(request.voice) ? request.voice : "af_heart";
  const text = request.text.trim();
  const chunks = splitTextIntoChunks(text);
  const outputPath = request.outputPath;
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== ".wav") throw new Error("Choose a valid absolute output path ending in .wav.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tts = await getKokoro();
  const generatedChunks = [];
  let sampleRate = 24000;
  for (let i = 0; i < chunks.length; i++) {
    progress("Kokoro is generating text chunk " + (i + 1) + " of " + chunks.length + " using voice " + voice + "…");
    const result = await tts.generate(chunks[i], { voice });
    if (!result || !result.audio || !result.audio.length) throw new Error("Kokoro returned no audio for text chunk " + (i + 1) + ". Please try a shorter sentence.");
    if (Number.isFinite(result.sampling_rate)) sampleRate = result.sampling_rate;
    generatedChunks.push(Float32Array.from(result.audio));
  }
  const silenceLength = Math.round(sampleRate * 0.16);
  const totalSamples = generatedChunks.reduce((sum, chunk) => sum + chunk.length, 0) + Math.max(0, generatedChunks.length - 1) * silenceLength;
  const combined = new Float32Array(totalSamples);
  let offset = 0;
  generatedChunks.forEach((chunk, index) => {
    combined.set(chunk, offset); offset += chunk.length;
    if (index < generatedChunks.length - 1) offset += silenceLength;
  });
  await writePcmWav(combined, sampleRate, outputPath);
  const stat = await fs.stat(outputPath);
  if (stat.size < 44 || combined.length === 0) throw new Error("Kokoro did not produce a valid WAV file.");
  progress("Generated " + text.length + " characters with Kokoro voice " + voice + ".");
  return { outputPath, voice, characters: text.length };
}
parentPort.on("message", async message => {
  const { id, action, payload } = message || {};
  try {
    const result = action === "transcribe" ? await transcribe(payload.samples) :
      action === "generate" ? await generate(payload) :
      action === "status" ? { kokoroReady: Boolean(kokoro), whisperReady: Boolean(whisper) } :
      (() => { throw new Error("Unknown inference action."); })();
    parentPort.postMessage({ type: "result", id, result });
  } catch (error) {
    parentPort.postMessage({ type: "error", id, error: error && error.message ? error.message : String(error) });
  }
});
