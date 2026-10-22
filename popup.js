const DEFAULT_PROMPT = "You are a natural, friendly voice assistant. Be concise when speaking, follow my instructions, ask clarifying questions when needed, and never pretend to have performed actions you have not performed.";
const CLONING_URL = "https://pocketweb.tools/voice-cloning";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

const $ = (id) => document.getElementById(id);
const els = {
  settingsToggle: $("settingsToggle"), settingsPanel: $("settingsPanel"),
  apiKey: $("apiKey"), model: $("model"), systemPrompt: $("systemPrompt"),
  autoSpeak: $("autoSpeak"), saveSettings: $("saveSettings"), settingsStatus: $("settingsStatus"),
  messages: $("messages"), status: $("status"), chatForm: $("chatForm"),
  userInput: $("userInput"), micButton: $("micButton"), clearButton: $("clearButton"),
  sendButton: $("sendButton"), cloneButton: $("cloneButton"), cloneStatus: $("cloneStatus")
};

let conversation = [];
let latestAssistantReply = "";
let busy = false;
let recognition = null;
let listening = false;

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}
function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}
function storageSet(values) {
  return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
    const err = chrome.runtime.lastError;
    if (err) reject(new Error(err.message)); else resolve();
  }));
}

async function loadSettings() {
  const values = await storageGet({
    apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT, autoSpeak: false
  });
  els.apiKey.value = values.apiKey || "";
  els.model.value = values.model || DEFAULT_MODEL;
  els.systemPrompt.value = values.systemPrompt || DEFAULT_PROMPT;
  els.autoSpeak.checked = values.autoSpeak === true;
  setStatus(els.status, values.apiKey ? "Ready. Cloned speech will be sent to PocketWebTools after replies." : "Add your OpenRouter key in settings to get started.");
}
async function saveSettings() {
  const values = {
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim() || DEFAULT_MODEL,
    systemPrompt: els.systemPrompt.value.trim() || DEFAULT_PROMPT,
    autoSpeak: els.autoSpeak.checked
  };
  try {
    await storageSet(values);
    setStatus(els.settingsStatus, "Settings saved on this browser.");
    setStatus(els.status, values.apiKey ? "Settings saved. Replies will use the cloning workflow." : "Add your OpenRouter key in settings to get started.");
  } catch (error) {
    setStatus(els.settingsStatus, error.message || "Could not save settings.", true);
  }
}

function renderMessages() {
  els.messages.replaceChildren();
  if (!conversation.length) {
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    const wave = document.createElement("div"); wave.className = "wave"; wave.textContent = "〰";
    const title = document.createElement("h2"); title.textContent = "Ready when you are.";
    const text = document.createElement("p"); text.textContent = "Type a message or use the microphone to talk.";
    welcome.append(wave, title, text); els.messages.append(welcome); return;
  }
  for (const item of conversation) {
    const bubble = document.createElement("div");
    bubble.className = "message " + (item.role === "user" ? "user" : "assistant");
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = item.role === "user" ? "You" : "Assistant";
    const content = document.createElement("div"); content.textContent = item.content;
    bubble.append(label, content); els.messages.append(bubble);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    setStatus(els.status, "Browser speech is not available."); return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.onstart = () => setStatus(els.status, "Speaking with browser voice…");
  utterance.onend = () => setStatus(els.status, "Ready.");
  utterance.onerror = () => setStatus(els.status, "Could not play browser speech.");
  window.speechSynthesis.speak(utterance);
}

async function sendReplyToCloner(text) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://pocketweb.tools/voice-cloning*" });
    let tab = tabs.find((item) => Number.isInteger(item.id));
    if (!tab) {
      await storageSet({ pendingCloneText: text });
      tab = await chrome.tabs.create({ url: CLONING_URL, active: true });
      setStatus(els.cloneStatus, "Opened PocketWebTools. Set your reference voice and confirm permission once; the reply is queued.");
      return;
    }
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "POCKET_CLONE_TEXT", text });
      setStatus(els.cloneStatus, result?.message || "Reply sent to PocketWebTools.");
      if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
    } catch {
      await storageSet({ pendingCloneText: text });
      await chrome.tabs.update(tab.id, { url: CLONING_URL, active: true });
      setStatus(els.cloneStatus, "Refreshing PocketWebTools to connect the extension. Your reply is queued.");
    }
  } catch (error) {
    setStatus(els.cloneStatus, "Could not connect to PocketWebTools: " + (error.message || "Unknown error"), true);
  }
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || busy) return;
  const settings = await storageGet({ apiKey: "", model: DEFAULT_MODEL, systemPrompt: DEFAULT_PROMPT, autoSpeak: false });
  if (!settings.apiKey) {
    els.settingsPanel.hidden = false;
    setStatus(els.status, "Add your OpenRouter API key in settings first.", true); return;
  }
  conversation.push({ role: "user", content: text }); renderMessages(); els.userInput.value = "";
  busy = true; els.sendButton.disabled = true; els.micButton.disabled = true;
  setStatus(els.status, "Thinking…");
  try {
    const messages = [
      { role: "system", content: settings.systemPrompt || DEFAULT_PROMPT },
      ...conversation.map(({ role, content }) => ({ role, content }))
    ];
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + settings.apiKey, "Content-Type": "application/json", "X-OpenRouter-Title": "VoiceAgent Pocket" },
      body: JSON.stringify({ model: settings.model || DEFAULT_MODEL, messages, temperature: 0.7 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || ("HTTP " + response.status));
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("The model returned an empty reply.");
    latestAssistantReply = reply.trim();
    conversation.push({ role: "assistant", content: latestAssistantReply });
    renderMessages();
    setStatus(els.status, "Reply received. Sending it to your cloned-voice workflow…");
    await sendReplyToCloner(latestAssistantReply);
    if (settings.autoSpeak) speak(latestAssistantReply);
  } catch (error) {
    setStatus(els.status, "Request failed: " + (error.message || "Unknown error"), true);
  } finally {
    busy = false; els.sendButton.disabled = false; els.micButton.disabled = false;
  }
}

function startListening() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus(els.status, "Speech recognition is not supported here. Try Chrome or type your message.", true); return;
  }
  if (listening && recognition) { recognition.stop(); return; }
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true; recognition.continuous = false;
  let finalTranscript = "";
  recognition.onstart = () => { listening = true; els.micButton.textContent = "■ Stop"; setStatus(els.status, "Listening…"); };
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const part = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += part; else interim += part;
    }
    els.userInput.value = (finalTranscript + " " + interim).trim();
  };
  recognition.onerror = (event) => setStatus(els.status, "Microphone error: " + event.error, true);
  recognition.onend = () => {
    listening = false; els.micButton.textContent = "🎙 Talk";
    const text = finalTranscript.trim();
    if (text) sendMessage(text); else if (!busy) setStatus(els.status, "Ready.");
  };
  try { recognition.start(); } catch (error) { setStatus(els.status, "Could not start microphone: " + error.message, true); }
}

async function openCloningSetup() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://pocketweb.tools/voice-cloning*" });
    if (tabs.length && Number.isInteger(tabs[0].id)) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      setStatus(els.cloneStatus, "PocketWebTools opened. Keep this tab open for automatic cloned speech.");
    } else {
      await chrome.tabs.create({ url: CLONING_URL, active: true });
      setStatus(els.cloneStatus, "PocketWebTools opened. Choose a reference recording and confirm the permission checkbox.");
    }
  } catch (error) {
    setStatus(els.cloneStatus, "Could not open PocketWebTools: " + error.message, true);
  }
}

els.settingsToggle.addEventListener("click", () => { els.settingsPanel.hidden = !els.settingsPanel.hidden; });
els.saveSettings.addEventListener("click", saveSettings);
els.chatForm.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(els.userInput.value); });
els.micButton.addEventListener("click", startListening);
els.clearButton.addEventListener("click", () => {
  conversation = []; latestAssistantReply = "";
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  renderMessages(); setStatus(els.status, "Conversation cleared."); setStatus(els.cloneStatus, "");
});
els.cloneButton.addEventListener("click", openCloningSetup);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "POCKET_CLONE_STATUS") setStatus(els.cloneStatus, message.message || "PocketWebTools status updated.");
});
loadSettings().catch((error) => setStatus(els.status, "Could not load settings: " + error.message, true));
renderMessages();