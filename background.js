const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_PROMPT = "You are a natural, friendly voice assistant. Be concise when speaking, follow my instructions, ask clarifying questions when needed, and never pretend to have performed actions you have not performed.";
const CLONING_URL = "https://pocketweb.tools/voice-cloning";
let creatingOffscreen = null;
let requestBusy = false;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Keep the user's explicitly started microphone speech recognition active when the extension popup is closed."
  });
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function broadcast(message) {
  try { await chrome.runtime.sendMessage(message); } catch (_) {}
}
async function setListening(value) {
  await chrome.storage.local.set({ backgroundListening: value });
  await broadcast({ type: "VOICE_STATUS", listening: value, message: value ? "Background listening is on. You can close this popup." : "Background listening is off." });
}
async function sendToCloner(text) {
  const tabs = await chrome.tabs.query({ url: "https://pocketweb.tools/voice-cloning*" });
  let tab = tabs.find(t => Number.isInteger(t.id));
  if (!tab) {
    await chrome.storage.local.set({ pendingCloneText: text });
    await chrome.tabs.create({ url: CLONING_URL, active: false });
    await broadcast({ type: "POCKET_CLONE_STATUS", message: "Opened PocketWebTools in a background tab; choose a reference voice and confirm permission." });
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "POCKET_CLONE_TEXT", text });
    await broadcast({ type: "POCKET_CLONE_STATUS", message: result?.message || "Reply sent to PocketWebTools." });
  } catch (_) {
    await chrome.storage.local.set({ pendingCloneText: text });
    await chrome.tabs.update(tab.id, { url: CLONING_URL });
    await broadcast({ type: "POCKET_CLONE_STATUS", message: "Reconnecting PocketWebTools; reply queued." });
  }
}
async function handleTranscript(rawText) {
  const text = String(rawText || "").trim();
  if (!text || requestBusy) return;
  requestBusy = true;
  await broadcast({ type: "VOICE_TRANSCRIPT", text });
  try {
    const settings = await chrome.storage.local.get({ apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT, backgroundConversation: [] });
    if (!settings.apiKey) throw new Error("Add your OpenRouter API key in extension settings.");
    const history = Array.isArray(settings.backgroundConversation) ? settings.backgroundConversation.slice(-20) : [];
    history.push({ role: "user", content: text });
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + settings.apiKey, "Content-Type": "application/json", "X-OpenRouter-Title": "VoiceAgent Pocket" },
      body: JSON.stringify({ model: settings.model || DEFAULT_MODEL, messages: [{ role: "system", content: settings.systemPrompt || DEFAULT_PROMPT }, ...history], temperature: 0.7 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || ("HTTP " + response.status));
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("The model returned an empty reply.");
    history.push({ role: "assistant", content: reply.trim() });
    await chrome.storage.local.set({ backgroundConversation: history.slice(-20) });
    await broadcast({ type: "VOICE_REPLY", text: reply.trim() });
    await sendToCloner(reply.trim());
    await broadcast({ type: "VOICE_STATUS", listening: true, message: "Reply sent to cloned-voice workflow. Background listening is continuing." });
  } catch (error) {
    await broadcast({ type: "VOICE_STATUS", listening: true, error: true, message: "Assistant error: " + (error.message || "Unknown error") });
  } finally {
    requestBusy = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "VOICE_START") {
    (async () => {
      try {
        await ensureOffscreen();
        await chrome.runtime.sendMessage({ target: "offscreen", type: "START_LISTENING" });
        await setListening(true);
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
    })();
    return true;
  }
  if (message?.type === "VOICE_STOP") {
    (async () => {
      try {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
        if (contexts.length) await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_LISTENING" });
        await setListening(false);
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
    })();
    return true;
  }
  if (message?.type === "VOICE_TRANSCRIPT_FINAL") { handleTranscript(message.text); return false; }
  if (message?.type === "OFFSCREEN_STATUS") {
    if (message.listening === false) chrome.storage.local.set({ backgroundListening: false });
    broadcast({ type: "VOICE_STATUS", listening: message.listening === true, message: message.message || "", error: message.error === true });
  }
});
chrome.runtime.onStartup.addListener(async () => {
  const state = await chrome.storage.local.get({ backgroundListening: false });
  if (state.backgroundListening) {
    try { await ensureOffscreen(); await chrome.runtime.sendMessage({ target: "offscreen", type: "START_LISTENING" }); } catch (_) {}
  }
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ backgroundConversation: [] }).then(() => {});
});
