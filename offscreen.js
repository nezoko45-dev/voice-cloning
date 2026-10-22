(() => {
  let recognition = null;
  let shouldListen = false;
  let isListening = false;
  let restartTimer = null;
  let lastSentAt = 0;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});
  function status(message, error = false) {
    send({ type: "OFFSCREEN_STATUS", listening: shouldListen, message, error });
  }
  function startRecognition() {
    const SpeechRecognition = self.SpeechRecognition || self.webkitSpeechRecognition;
    if (!shouldListen || isListening) return;
    if (!SpeechRecognition) {
      shouldListen = false;
      status("This Chrome build does not expose SpeechRecognition in the background document. Background voice input is unavailable.", true);
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { isListening = true; status("Listening in the background. Close the popup whenever you like."); };
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const text = (event.results[i][0]?.transcript || "").trim();
        const now = Date.now();
        if (text && now - lastSentAt > 800) {
          lastSentAt = now;
          send({ type: "VOICE_TRANSCRIPT_FINAL", text });
        }
      }
    };
    recognition.onerror = (event) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        shouldListen = false;
        status("Microphone permission or audio capture failed: " + event.error, true);
      } else {
        status("Speech recognition interrupted (" + event.error + "); attempting to reconnect.");
      }
    };
    recognition.onend = () => {
      isListening = false;
      if (shouldListen) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(startRecognition, 700);
      } else {
        status("Background listening stopped.");
      }
    };
    try { recognition.start(); }
    catch (error) {
      isListening = false;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (shouldListen) startRecognition();
      }, 1200);
      status("Restarting speech recognition after interruption.");
    }
  }
  function stopRecognition() {
    shouldListen = false;
    clearTimeout(restartTimer);
    try { if (recognition && isListening) recognition.stop(); } catch (_) {}
    isListening = false;
    status("Background listening stopped.");
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.target !== "offscreen") return;
    if (message.type === "START_LISTENING") {
      shouldListen = true;
      startRecognition();
    } else if (message.type === "STOP_LISTENING") stopRecognition();
  });
  chrome.storage.local.get({ backgroundListening: false }, (state) => {
    if (state.backgroundListening) { shouldListen = true; startRecognition(); }
  });
})();