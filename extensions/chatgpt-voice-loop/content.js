(() => {
  if (window.__chatgptVoiceLoopInstalled) return;
  window.__chatgptVoiceLoopInstalled = true;

  const DEFAULTS = { enabled: false, silenceSeconds: 2.5 };
  let enabled = false;
  let silenceSeconds = DEFAULTS.silenceSeconds;
  let running = false;
  let observer;
  let lastTranscript = "";
  let lastChangeAt = 0;
  let responseBaseline = 0;
  let statusNode;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!el && el.isConnected && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const labelOf = el => [
    el?.getAttribute?.("aria-label"), el?.getAttribute?.("data-testid"),
    el?.getAttribute?.("title"), el?.innerText, el?.textContent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();

  function buttons() { return [...document.querySelectorAll("button,[role=button]")].filter(visible); }
  function findButton(patterns) {
    return buttons().find(el => patterns.some(pattern => pattern.test(labelOf(el))));
  }
  function findComposer() {
    return document.querySelector("#prompt-textarea,[contenteditable='true'][data-testid*='prompt'],textarea");
  }
  function composerText() {
    const el = findComposer();
    return (el?.value || el?.innerText || el?.textContent || "").trim();
  }
  function showStatus(message) {
    if (!statusNode || !statusNode.isConnected) {
      statusNode = document.createElement("div");
      statusNode.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#171717;color:#fff;border:1px solid #444;border-radius:10px;padding:9px 12px;font:13px system-ui;box-shadow:0 4px 18px #0008;max-width:300px";
      document.documentElement.appendChild(statusNode);
    }
    statusNode.textContent = "Voice Loop: " + message;
    statusNode.style.display = "block";
    clearTimeout(statusNode._hideTimer);
    statusNode._hideTimer = setTimeout(() => { if (statusNode) statusNode.style.display = "none"; }, 4500);
  }
  function clickButton(el) {
    if (!el || !visible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    el.click();
    return true;
  }

  async function startDictation() {
    const dictate = findButton([/^dictate( message)?$/, /start dictation/, /dictation.*start/]);
    if (!dictate) { showStatus("Dictate button not found. Waiting…"); return false; }
    responseBaseline = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    lastTranscript = composerText();
    lastChangeAt = Date.now();
    if (!clickButton(dictate)) return false;
    showStatus("Listening…");
    return true;
  }

  async function waitForSpeechAndSend() {
    let sawText = !!composerText();
    let stableSince = Date.now();
    let prior = composerText();
    while (enabled) {
      await sleep(250);
      const current = composerText();
      if (current !== prior) {
        prior = current;
        lastTranscript = current;
        stableSince = Date.now();
        sawText = sawText || !!current;
      }
      // ChatGPT's dictation is stopped explicitly after the transcript has been quiet.
      // A minimum grace period avoids stopping on the first partial transcription.
      const quietLongEnough = Date.now() - stableSince >= silenceSeconds * 1000;
      const stop = findButton([/stop dictation/, /stop recording/, /stop listening/]);
      if (sawText && quietLongEnough && stop) {
        clickButton(stop);
        await sleep(500);
        const send = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (send && clickButton(send)) {
          showStatus("Sent. Waiting for ChatGPT…");
          return true;
        }
        // Some ChatGPT builds expose the send button only after the transcript settles.
        await sleep(500);
        const retrySend = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (retrySend && clickButton(retrySend)) {
          showStatus("Sent. Waiting for ChatGPT…");
          return true;
        }
        showStatus("Dictation stopped, but Send was not found. Please check the draft.");
        return false;
      }
      // If the site ends dictation itself, send once the transcript is stable.
      if (sawText && quietLongEnough && !stop) {
        const send = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (send && clickButton(send)) {
          showStatus("Sent. Waiting for ChatGPT…");
          return true;
        }
      }
    }
    return false;
  }

  async function waitForReplyAndReadAloud() {
    let sawNewReply = false;
    let previousText = "";
    let stableSince = Date.now();
    const deadline = Date.now() + 180000;
    while (enabled && Date.now() < deadline) {
      await sleep(700);
      const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const latest = messages[messages.length - 1];
      const text = (latest?.innerText || "").trim();
      if (messages.length > responseBaseline && text) {
        sawNewReply = true;
        if (text !== previousText) {
          previousText = text;
          stableSince = Date.now();
        }
        const stopGenerating = findButton([/stop generating/]);
        if (!stopGenerating && Date.now() - stableSince > 1400) {
          const scope = latest || document;
          const readButton = [...scope.querySelectorAll("button,[role=button]")].find(el =>
            visible(el) && /read aloud|read response aloud|play audio/i.test(labelOf(el)));
          if (readButton && clickButton(readButton)) {
            showStatus("Reading reply aloud.");
            return true;
          }
          showStatus("Reply ready; Read aloud button not found.");
          return false;
        }
      }
    }
    if (!sawNewReply) showStatus("Timed out waiting for a reply.");
    return false;
  }

  async function runCycle() {
    if (running || !enabled || !location.hostname.endsWith("chatgpt.com") && !location.hostname.endsWith("chat.openai.com")) return;
    running = true;
    try {
      const started = await startDictation();
      if (!started) { await sleep(1800); return; }
      const sent = await waitForSpeechAndSend();
      if (sent) await waitForReplyAndReadAloud();
    } catch (error) {
      console.error("[ChatGPT Voice Loop]", error);
      showStatus("Something went wrong. Check the ChatGPT tab.");
    } finally {
      running = false;
      if (enabled) setTimeout(runCycle, 1500);
    }
  }

  function applySettings(settings) {
    enabled = !!settings.enabled;
    silenceSeconds = Math.min(10, Math.max(1, Number(settings.silenceSeconds) || DEFAULTS.silenceSeconds));
    if (enabled) {
      showStatus("Enabled. Preparing dictation…");
      setTimeout(runCycle, 1200);
    } else {
      showStatus("Paused.");
    }
  }
  chrome.storage.sync.get(DEFAULTS, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    chrome.storage.sync.get(DEFAULTS, applySettings);
  });
  observer = new MutationObserver(() => {
    if (enabled && !running) {
      // SPA navigation can return to the ChatGPT composer without reloading the tab.
      clearTimeout(window.__chatgptVoiceLoopRestart);
      window.__chatgptVoiceLoopRestart = setTimeout(runCycle, 1800);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();