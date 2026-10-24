(() => {
  if (window.__chatgptVoiceLoopInstalled) return;
  window.__chatgptVoiceLoopInstalled = true;

  const DEFAULTS = { enabled: false, silenceSeconds: 2.5 };
  let enabled = false;
  let silenceSeconds = DEFAULTS.silenceSeconds;
  let running = false;
  let responseBaseline = 0;
  let statusNode;
  let audioContext;
  let audioStream;
  let analyser;
  let audioData;
  let micReady = false;
  let micStarting = false;
  let speechActive = false;
  let speechStartedAt = 0;
  let lastLoudAt = 0;
  let lastCycleStartedAt = 0;

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
      statusNode.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#171717;color:#fff;border:1px solid #444;border-radius:10px;padding:9px 12px;font:13px system-ui;box-shadow:0 4px 18px #0008;max-width:320px";
      document.documentElement.appendChild(statusNode);
    }
    statusNode.textContent = "Voice Loop: " + message;
    statusNode.style.display = "block";
  }
  function clickButton(el) {
    if (!el || !visible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    el.click();
    return true;
  }

  async function startMicMonitor() {
    if (micReady || micStarting || !enabled) return micReady;
    micStarting = true;
    try {
      // The user must grant microphone permission. This stream is used only to detect
      // speech start/end; the actual transcription remains ChatGPT Dictate's job.
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true
      }});
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(audioStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioData = new Uint8Array(analyser.fftSize);
      micReady = true;
      showStatus("Microphone monitor ready. Speak whenever you're ready.");
      monitorAudio();
      return true;
    } catch (error) {
      console.warn("[ChatGPT Voice Loop] Microphone monitor permission failed", error);
      showStatus("Allow microphone access on ChatGPT to detect when you start speaking.");
      return false;
    } finally {
      micStarting = false;
    }
  }

  function monitorAudio() {
    if (!enabled || !micReady || !analyser) return;
    analyser.getByteTimeDomainData(audioData);
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      const v = (audioData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / audioData.length);
    const now = Date.now();
    // Threshold tuned for ordinary speech; ambient noise may require a quieter room.
    if (rms > 0.035) {
      lastLoudAt = now;
      if (!speechActive && now - lastCycleStartedAt > 1200) {
        speechActive = true;
        speechStartedAt = now;
        showStatus("Speech detected. Starting Dictate…");
        if (!running) runCycle();
      }
    } else if (speechActive && now - lastLoudAt > silenceSeconds * 1000 &&
               now - speechStartedAt > 700) {
      speechActive = false;
    }
    requestAnimationFrame(monitorAudio);
  }

  async function startDictation() {
    const dictate = findButton([/^dictate( message)?$/, /start dictation/, /dictation.*start/]);
    if (!dictate) { showStatus("Dictate button not found. Waiting…"); return false; }
    responseBaseline = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    if (!clickButton(dictate)) return false;
    showStatus("Listening to your speech…");
    return true;
  }

  async function waitForSpeechEndAndSend() {
    let sawText = false;
    let prior = composerText();
    let lastTextChange = Date.now();
    let began = Date.now();
    while (enabled) {
      await sleep(150);
      const current = composerText();
      if (current !== prior) {
        prior = current;
        lastTextChange = Date.now();
        if (current) sawText = true;
      }
      const stop = findButton([/stop dictation/, /stop recording/, /stop listening/]);
      const audioQuiet = !speechActive && Date.now() - lastLoudAt >= silenceSeconds * 1000;
      const transcriptSettled = Date.now() - lastTextChange >= Math.min(700, silenceSeconds * 500);
      // Wait until actual mic silence is detected, then explicitly press Stop dictation.
      if (sawText && audioQuiet && transcriptSettled && Date.now() - began > 900) {
        if (stop) {
          clickButton(stop);
          showStatus('Speech ended. Pressed "Stop dictation".');
          await sleep(650);
        } else if (Date.now() - began < 8000) {
          // Give ChatGPT a moment to show its Stop dictation control.
          continue;
        }
        const send = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (send && clickButton(send)) {
          showStatus("Sent. Waiting for ChatGPT's reply…");
          return true;
        }
        await sleep(700);
        const retrySend = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (retrySend && clickButton(retrySend)) {
          showStatus("Sent. Waiting for ChatGPT's reply…");
          return true;
        }
        showStatus("Stopped dictation, but Send was not found. Check the draft.");
        return false;
      }
      // Fail-safe if the microphone meter is unavailable but text transcription settles.
      if (sawText && Date.now() - lastTextChange > Math.max(5000, silenceSeconds * 2500) &&
          Date.now() - began > 12000) {
        const stopNow = findButton([/stop dictation/, /stop recording/, /stop listening/]);
        if (stopNow) clickButton(stopNow);
        await sleep(500);
        const send = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (send && clickButton(send)) return true;
        showStatus("Dictation may still be active. Please check the draft.");
        return false;
      }
    }
    return false;
  }

  async function waitForReplyAndReadAloud() {
    let previousText = "";
    let stableSince = Date.now();
    const deadline = Date.now() + 180000;
    while (enabled && Date.now() < deadline) {
      await sleep(600);
      const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const latest = messages[messages.length - 1];
      const text = (latest?.innerText || "").trim();
      if (messages.length > responseBaseline && text) {
        if (text !== previousText) {
          previousText = text;
          stableSince = Date.now();
        }
        const stopGenerating = findButton([/stop generating/]);
        if (!stopGenerating && Date.now() - stableSince > 1300) {
          const readButton = [...(latest || document).querySelectorAll("button,[role=button]")].find(el =>
            visible(el) && /read aloud|read response aloud|play audio/i.test(labelOf(el)));
          if (readButton && clickButton(readButton)) showStatus("Reading reply aloud. Speak again when ready.");
          else showStatus("Reply finished. Read aloud button wasn't found; listening for your next speech.");
          return true;
        }
      }
    }
    showStatus("Waiting for a reply timed out. Listening for your next speech.");
    return false;
  }

  async function runCycle() {
    if (running || !enabled || !location.hostname.endsWith("chatgpt.com") && !location.hostname.endsWith("chat.openai.com")) return;
    running = true;
    lastCycleStartedAt = Date.now();
    try {
      // Start the site dictation after voice activity is detected.
      const started = await startDictation();
      if (!started) { speechActive = false; return; }
      const sent = await waitForSpeechEndAndSend();
      if (sent) await waitForReplyAndReadAloud();
    } catch (error) {
      console.error("[ChatGPT Voice Loop]", error);
      showStatus("Something went wrong. Check microphone permission and the ChatGPT tab.");
    } finally {
      running = false;
      speechActive = false;
      lastLoudAt = Date.now();
      if (enabled) showStatus("Listening for your next speech…");
    }
  }

  async function applySettings(settings) {
    enabled = !!settings.enabled;
    silenceSeconds = Math.min(10, Math.max(1, Number(settings.silenceSeconds) || DEFAULTS.silenceSeconds));
    if (enabled) {
      await startMicMonitor();
      showStatus("Enabled. Speak to start Dictate automatically.");
    } else {
      speechActive = false;
      if (audioStream) audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
      micReady = false;
      if (audioContext) audioContext.close().catch(() => {});
      audioContext = null;
      showStatus("Paused.");
    }
  }

  chrome.storage.sync.get(DEFAULTS, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") chrome.storage.sync.get(DEFAULTS, applySettings);
  });

  // ChatGPT is a single-page app; keep the detector alive across navigation changes.
  const observer = new MutationObserver(() => {
    if (enabled && !micReady && !micStarting) startMicMonitor();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();