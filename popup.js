const DEFAULT_PROMPT = "You are a natural, friendly voice assistant. Be concise when speaking, follow my instructions, ask clarifying questions when needed, and never pretend to have performed actions you have not performed.";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TTS_ENDPOINT = "http://127.0.0.1:8080/v1/tts";
const $ = (id) => document.getElementById(id);
const els = {
  settingsToggle: $("settingsToggle"), settingsPanel: $("settingsPanel"),
  apiKey: $("apiKey"), model: $("model"), systemPrompt: $("systemPrompt"),
  ttsEndpoint: $("ttsEndpoint"), ttsReferenceId: $("ttsReferenceId"), ttsApiKey: $("ttsApiKey"),
  saveSettings: $("saveSettings"), settingsStatus: $("settingsStatus"),
  messages: $("messages"), status: $("status"), chatForm: $("chatForm"),
  userInput: $("userInput"), micButton: $("micButton"), clearButton: $("clearButton"), sendButton: $("sendButton")
};
let conversation = [];
let busy = false;
let continuousListening = false;
function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}
function storageGet(defaults) { return new Promise(resolve => chrome.storage.local.get(defaults, resolve)); }
function storageSet(values) { return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
  const err = chrome.runtime.lastError; if (err) reject(new Error(err.message)); else resolve();
})); }
async function loadSettings() {
  const values = await storageGet({ apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT, ttsEndpoint: DEFAULT_TTS_ENDPOINT, ttsReferenceId: "", ttsApiKey: "" });
  els.apiKey.value = values.apiKey || ""; els.model.value = values.model || DEFAULT_MODEL;
  els.systemPrompt.value = values.systemPrompt || DEFAULT_PROMPT;
  els.ttsEndpoint.value = values.ttsEndpoint || DEFAULT_TTS_ENDPOINT;
  els.ttsReferenceId.value = values.ttsReferenceId || ""; els.ttsApiKey.value = values.ttsApiKey || "";
  setStatus(els.status, values.apiKey ? "Ready. Replies use your local speech server." : "Add your OpenRouter API key in settings to get started.");
}
async function saveSettings() {
  const values = { apiKey: els.apiKey.value.trim(), model: els.model.value.trim() || DEFAULT_MODEL,
    systemPrompt: els.systemPrompt.value.trim() || DEFAULT_PROMPT, ttsEndpoint: els.ttsEndpoint.value.trim() || DEFAULT_TTS_ENDPOINT,
    ttsReferenceId: els.ttsReferenceId.value.trim(), ttsApiKey: els.ttsApiKey.value.trim() };
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(values.ttsEndpoint)) {
    setStatus(els.settingsStatus, "For privacy, use a local endpoint such as http://127.0.0.1:8080/v1/tts.", true); return;
  }
  try { await storageSet(values); setStatus(els.settingsStatus, "Settings saved in this browser profile."); setStatus(els.status, values.apiKey ? "Settings saved. Chat stays on OpenRouter; speech is generated locally." : "Add your OpenRouter API key in settings."); }
  catch (error) { setStatus(els.settingsStatus, error.message || "Could not save settings.", true); }
}
function renderMessages() {
  els.messages.replaceChildren();
  if (!conversation.length) {
    const welcome = document.createElement("div"); welcome.className = "welcome";
    const wave = document.createElement("div"); wave.className = "wave"; wave.textContent = "〰";
    const title = document.createElement("h2"); title.textContent = "Ready when you are.";
    const text = document.createElement("p"); text.textContent = "Type a message or use the microphone to talk.";
    welcome.append(wave, title, text); els.messages.append(welcome); return;
  }
  for (const item of conversation) {
    const bubble = document.createElement("div"); bubble.className = "message " + (item.role === "user" ? "user" : "assistant");
    const label = document.createElement("span"); label.className = "message-label"; label.textContent = item.role === "user" ? "You" : "Assistant";
    const content = document.createElement("div"); content.textContent = item.content; bubble.append(label, content); els.messages.append(bubble);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}
async function speakLocally(text) {
  const result = await chrome.runtime.sendMessage({ type: "TTS_SPEAK", text });
  if (!result?.ok) throw new Error(result?.error || "Local speech generation failed.");
}
async function sendMessage(rawText) {
  const text = rawText.trim(); if (!text || busy) return;
  const settings = await storageGet({ apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT });
  if (!settings.apiKey) { els.settingsPanel.hidden = false; setStatus(els.status, "Add your OpenRouter API key in settings first.", true); return; }
  conversation.push({ role: "user", content: text }); renderMessages(); els.userInput.value = "";
  busy = true; els.sendButton.disabled = true; els.micButton.disabled = true; setStatus(els.status, "Thinking…");
  try {
    const messages = [{ role: "system", content: settings.systemPrompt || DEFAULT_PROMPT }, ...conversation.map(({ role, content }) => ({ role, content }))];
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Authorization": "Bearer " + settings.apiKey, "Content-Type": "application/json", "X-OpenRouter-Title": "VoiceAgent Pocket" },
      body: JSON.stringify({ model: settings.model || DEFAULT_MODEL, messages, temperature: 0.7 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || ("HTTP " + response.status));
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("The model returned an empty reply.");
    conversation.push({ role: "assistant", content: reply.trim() }); renderMessages(); setStatus(els.status, "Reply received. Generating speech locally…");
    try { await speakLocally(reply.trim()); setStatus(els.status, "Reply spoken using your local speech server."); }
    catch (error) { setStatus(els.status, "Reply received, but local speech failed: " + error.message, true); }
  } catch (error) { setStatus(els.status, "Request failed: " + (error.message || "Unknown error"), true); }
  finally { busy = false; els.sendButton.disabled = false; els.micButton.disabled = false; }
}
async function startListening() {
  const current = await storageGet({ backgroundListening: false });
  if (current.backgroundListening) { chrome.runtime.sendMessage({ type: "VOICE_STOP" }); continuousListening = false; els.micButton.textContent = "🎙 Talk"; setStatus(els.status, "Background listening stopped."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop());
    const result = await chrome.runtime.sendMessage({ type: "VOICE_START" });
    if (!result?.ok) throw new Error(result?.error || "Could not start background listening.");
    continuousListening = true; els.micButton.textContent = "■ Stop listening"; setStatus(els.status, "Listening in the background. Replies are spoken locally.");
  } catch (error) { setStatus(els.status, "Could not enable background listening: " + (error.message || error), true); }
}
els.settingsToggle.addEventListener("click", () => { els.settingsPanel.hidden = !els.settingsPanel.hidden; });
els.saveSettings.addEventListener("click", saveSettings);
els.chatForm.addEventListener("submit", event => { event.preventDefault(); sendMessage(els.userInput.value); });
els.micButton.addEventListener("click", startListening);
els.clearButton.addEventListener("click", () => { conversation = []; renderMessages(); setStatus(els.status, "Conversation cleared."); });
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "TTS_STATUS") setStatus(els.status, message.message || "Local speech status updated.", message.error === true);
  if (message?.type === "VOICE_STATUS") { continuousListening = message.listening === true; els.micButton.textContent = continuousListening ? "■ Stop listening" : "🎙 Talk"; setStatus(els.status, message.message || (continuousListening ? "Listening in the background." : "Background listening stopped."), message.error === true); }
  if (message?.type === "VOICE_TRANSCRIPT") { conversation.push({ role: "user", content: message.text }); renderMessages(); }
  if (message?.type === "VOICE_REPLY") { conversation.push({ role: "assistant", content: message.text }); renderMessages(); }
});
loadSettings().catch(error => setStatus(els.status, "Could not load settings: " + error.message, true)); renderMessages();
