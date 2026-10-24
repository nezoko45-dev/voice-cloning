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

  function findStopDictationButton() {
    const all = buttons();
    // ChatGPT has changed the dictation control's accessible name across UI versions.
    // Check accessible labels/test IDs first, then visible text and common stop controls.
    const exact = all.find(el => {
      const labels = [
        el.getAttribute("aria-label"), el.getAttribute("title"),
        el.getAttribute("data-testid"), el.getAttribute("data-state"),
        el.innerText, el.textContent
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
      return /stop\s*(dictation|recording|listening)|end\s*dictation|finish\s*dictation/.test(labels);
    });
    if (exact) return exact;

    // Some ChatGPT layouts expose the stop action only through an icon or tooltip.
    return all.find(el => {
      const labels = [
        el.getAttribute("aria-label"), el.getAttribute("title"),
        el.getAttribute("data-testid"), el.querySelector("svg")?.getAttribute("data-testid"),
        el.querySelector("svg")?.getAttribute("aria-label")
      ].filter(Boolean).join(" ").toLowerCase();
      return /stop.*dictat|dictat.*stop|stop-recording|stop_recording/.test(labels);
    }) || null;
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
    const began = Date.now();
    let silenceSince = 0;
    let stopPressed = false;

    while (enabled) {
      await sleep(120);
      const now = Date.now();
      const current = composerText();
      if (current !== prior) {
        prior = current;
        lastTextChange = now;
        if (current) sawText = true;
      }

      const audioQuiet = !speechActive && now - lastLoudAt >= silenceSeconds * 1000;
      if (!audioQuiet) silenceSince = 0;
      else if (!silenceSince) silenceSince = now;

      // Stop as soon as speech has ended and the transcript has had a moment to settle.
      // Do not require a non-empty transcript before attempting the Stop dictation click.
      const transcriptSettled = now - lastTextChange >= Math.min(900, silenceSeconds * 350);
      const silenceLongEnough = silenceSince && now - silenceSince >= 250;
      if (!stopPressed && silenceLongEnough && transcriptSettled && now - began > 700) {
        let stop = findStopDictationButton();
        // The stop control can be inserted a little after the audio becomes quiet.
        for (let attempt = 0; !stop && attempt < 12; attempt++) {
          await sleep(150);
          stop = findStopDictationButton();
        }

        if (stop) {
          stopPressed = clickButton(stop);
          if (stopPressed) {
            showStatus('Speech ended — clicked "Stop dictation".');
            await sleep(750);
          }
        } else if (now - began > 9000) {
          showStatus('Could not find the Stop dictation control. Check ChatGPT’s dictation UI.');
          return false;
        } else {
          // Keep waiting for ChatGPT to render its stop control; do not send while dictation is active.
          continue;
        }
      }

      // Only submit after Stop dictation was actually clicked. If ChatGPT has no visible stop
      // control, leave the transcript intact rather than accidentally submitting live dictation.
      if (stopPressed && (sawText || current)) {
        if (now - lastTextChange < 500) continue;
        await sleep(250);
        const send = findButton([/^send$/, /send message/]) ||
          document.querySelector('button[data-testid="send-button"]');
        if (send && clickButton(send)) {
          showStatus("Dictation stopped and message sent. Waiting for ChatGPT's reply…");
          return true;
        }
        showStatus('Dictation stopped, but Send was not found. Check the draft.');
        return false;
      }

      // Safety timeout if no words were transcribed; never leave dictation running indefinitely.
      if (now - began > 30000 && !stopPressed) {
        const stop = findStopDictationButton();
        if (stop && clickButton(stop)) {
          showStatus('Stopped dictation after timeout. Check the draft before sending.');
        } else {
          showStatus('Dictation timeout: Stop dictation control was not found.');
        }
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