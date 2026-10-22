(() => {
  "use strict";

  let recognition = null;
  let shouldListen = false;
  let isListening = false;
  let restartTimer = null;
  let restartDelay = 800;
  let lastSentAt = 0;
  let stoppedByUser = false;

  function send(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_) {
      // The extension service worker can be restarting; never let messaging crash this document.
    }
  }

  function status(message, error = false, listening = shouldListen) {
    send({ type: "OFFSCREEN_STATUS", listening, message, error });
  }

  function clearRestart() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function scheduleRestart() {
    clearRestart();
    if (!shouldListen || stoppedByUser) return;
    const delay = restartDelay;
    restartDelay = Math.min(Math.round(restartDelay * 1.6), 8000);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startRecognition();
    }, delay);
  }

  function stopRecognition() {
    shouldListen = false;
    stoppedByUser = true;
    clearRestart();
    const active = recognition;
    recognition = null;
    isListening = false;
    if (active) {
      active.onstart = null;
      active.onresult = null;
      active.onerror = null;
      active.onend = null;
      try { active.abort(); } catch (_) {
        try { active.stop(); } catch (_) {}
      }
    }
    status("Background listening stopped.", false, false);
  }

  function startRecognition() {
    if (!shouldListen || isListening) return;

    const Recognition = self.SpeechRecognition || self.webkitSpeechRecognition;
    if (typeof Recognition !== "function") {
      shouldListen = false;
      status(
        "This Chrome environment does not provide SpeechRecognition in the extension background document. Open VoiceAgent Pocket and use a supported voice-input context.",
        true,
        false
      );
      chrome.storage.local.set({ backgroundListening: false }).catch(() => {});
      return;
    }

    let instance;
    try {
      instance = new Recognition();
      instance.lang = navigator.language || "en-US";
      instance.interimResults = false;
      instance.continuous = true;
      instance.maxAlternatives = 1;
    } catch (error) {
      shouldListen = false;
      status("Could not initialize speech recognition: " + (error?.message || String(error)), true, false);
      chrome.storage.local.set({ backgroundListening: false }).catch(() => {});
      return;
    }

    recognition = instance;
    instance.onstart = () => {
      if (recognition !== instance) return;
      isListening = true;
      restartDelay = 800;
      status("Listening in the background. You can close the popup.");
    };

    instance.onresult = (event) => {
      if (recognition !== instance || !shouldListen) return;
      try {
        const results = event.results;
        for (let i = event.resultIndex || 0; i < results.length; i++) {
          if (!results[i] || !results[i].isFinal) continue;
          const transcript = String(results[i][0]?.transcript || "").trim();
          const now = Date.now();
          if (transcript && now - lastSentAt > 800) {
            lastSentAt = now;
            send({ type: "VOICE_TRANSCRIPT_FINAL", text: transcript });
          }
        }
      } catch (error) {
        status("Could not read the speech result: " + (error?.message || String(error)), true);
      }
    };

    instance.onerror = (event) => {
      if (recognition !== instance) return;
      const code = String(event?.error || "unknown");
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(code)) {
        shouldListen = false;
        isListening = false;
        clearRestart();
        status("Speech input stopped (" + code + "). Check microphone permission and Chrome's speech service.", true, false);
        chrome.storage.local.set({ backgroundListening: false }).catch(() => {});
      } else if (shouldListen) {
        status("Speech recognition interrupted (" + code + "); reconnecting.");
      }
    };

    instance.onend = () => {
      if (recognition !== instance) return;
      recognition = null;
      isListening = false;
      if (shouldListen && !stoppedByUser) {
        status("Reconnecting speech recognition…");
        scheduleRestart();
      } else {
        status("Background listening stopped.", false, false);
      }
    };

    try {
      instance.start();
    } catch (error) {
      recognition = null;
      isListening = false;
      if (shouldListen) {
        status("Speech recognition could not start yet; retrying. " + (error?.message || ""), false);
        scheduleRestart();
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== "offscreen") return;
    if (message.type === "START_LISTENING") {
      stoppedByUser = false;
      shouldListen = true;
      startRecognition();
    } else if (message.type === "STOP_LISTENING") {
      stopRecognition();
    }
  });

  async function initialize() {
    try {
      const state = await chrome.storage.local.get({ backgroundListening: false });
      if (state.backgroundListening === true) {
        stoppedByUser = false;
        shouldListen = true;
        startRecognition();
      }
    } catch (error) {
      status("Could not restore listening state: " + (error?.message || String(error)), true, false);
    }
  }

  initialize();
})();