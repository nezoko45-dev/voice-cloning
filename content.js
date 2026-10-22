(() => {
  const MAX_TEXT = 2000;
  let sentenceQueue = [];
  let currentSentence = "";
  let busy = false;
  let generationObserver = null;
  let pageObserver = null;
  let generationStartedAt = 0;
  let oldAudioSources = new Set();

  const visible = (el) => !!(el && el.getClientRects().length);
  const normalized = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  function splitSentences(text) {
    // Split on sentence-ending punctuation while preserving punctuation and avoiding empty items.
    return (text.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*|[^.!?。！？]+$/g) || [text])
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function findTextField() {
    const fields = [...document.querySelectorAll("textarea, [contenteditable='true'], input[type='text']")].filter(visible);
    return fields.find((el) => el.tagName === "TEXTAREA" || el.isContentEditable) ||
      fields.find((el) => !/email|subscribe/i.test((el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "")));
  }

  function findConsentCheckbox() {
    const boxes = [...document.querySelectorAll("input[type='checkbox'], [role='checkbox']")].filter(visible);
    return boxes.find((el) => {
      const context = normalized((el.closest("label") || el.parentElement || el).innerText);
      return context.includes("permission to clone") || context.includes("own this voice");
    }) || null;
  }

  function isChecked(box) {
    return !!(box && (box.checked === true || box.getAttribute("aria-checked") === "true"));
  }

  function findGenerateButton() {
    return [...document.querySelectorAll("button, input[type='submit']")]
      .filter(visible)
      .find((el) => /generate speech/i.test(normalized(el.innerText || el.value)));
  }

  function setFieldValue(field, value) {
    const text = value.slice(0, MAX_TEXT);
    // Programmatically fill the page's text box, equivalent to pasting the sentence into it.
    // Direct field updates are more reliable than synthetic OS clipboard shortcuts in Chrome.
    if (field.isContentEditable) {
      field.focus();
      field.textContent = text;
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      )?.set;
      if (setter) setter.call(field, text);
      else field.value = text;
    }
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setStatus(message) {
    chrome.runtime.sendMessage({ type: "POCKET_CLONE_STATUS", message }).catch(() => {});
  }

  function audioSources() {
    return new Set([...document.querySelectorAll("audio")].map((a) => a.currentSrc || a.src).filter(Boolean));
  }

  function findNewAudio() {
    const audios = [...document.querySelectorAll("audio")].filter(visible);
    return audios.reverse().find((audio) => {
      const src = audio.currentSrc || audio.src;
      return src && (!oldAudioSources.has(src) || audio.readyState >= 2);
    }) || audios[audios.length - 1] || null;
  }

  function clickResultPlay(audio) {
    // Prefer the result player's own Play button when present.
    const scope = audio?.closest("section, article, [class*='result'], [class*='audio'], [class*='player']") || audio?.parentElement?.parentElement;
    const buttons = [...(scope || document).querySelectorAll("button, [role='button']")].filter(visible);
    const playButton = buttons.find((button) => /^(play|play audio|▶|▶ play)$/i.test(normalized(button.innerText || button.getAttribute("aria-label") || button.title)));
    if (playButton && !playButton.disabled) {
      playButton.click();
      return true;
    }
    if (audio) {
      audio.play().catch(() => setStatus("Sentence generated. Click Play on the result player if Chrome blocks automatic playback."));
      return true;
    }
    return false;
  }

  function cleanupObserver() {
    if (generationObserver) generationObserver.disconnect();
    generationObserver = null;
  }

  function finishCurrentSentence(message) {
    cleanupObserver();
    busy = false;
    currentSentence = "";
    if (message) setStatus(message);
    if (sentenceQueue.length) {
      window.setTimeout(generateNextSentence, 500);
    } else {
      setStatus("All sentences in this reply have been generated and played.");
    }
  }

  function waitForGeneratedAudio() {
    if (!busy) return;
    const audio = findNewAudio();
    if (audio && audio.readyState >= 2) {
      cleanupObserver();
      setStatus("Playing sentence " + (sentenceQueue.length ? "before the next one" : "(final sentence)") + "…");
      const onEnded = () => {
        audio.removeEventListener("ended", onEnded);
        finishCurrentSentence();
      };
      audio.addEventListener("ended", onEnded, { once: true });
      if (!clickResultPlay(audio)) {
        audio.removeEventListener("ended", onEnded);
        finishCurrentSentence("Sentence generated. Press Play on the result player to continue.");
      } else {
        // If the site button starts playback, the audio element's ended event advances the queue.
        window.setTimeout(() => {
          if (busy && audio.paused && audio.readyState >= 2) {
            setStatus("Sentence is ready. If it did not play, click Play on the result player; the next sentence will wait.");
          }
        }, 1200);
      }
      return;
    }
    if (Date.now() - generationStartedAt > 120000) {
      cleanupObserver();
      busy = false;
      setStatus("Timed out waiting for generated audio. Check PocketWebTools, then click Play or try the next reply.");
    }
  }

  function generateNextSentence() {
    if (busy || !sentenceQueue.length) return;
    const field = findTextField();
    if (!field) {
      setStatus("Waiting for the PocketWebTools text box to appear…");
      return;
    }
    const consent = findConsentCheckbox();
    if (!isChecked(consent)) {
      setStatus("Reply queued sentence by sentence. Check the voice-permission checkbox to continue.");
      return;
    }
    const button = findGenerateButton();
    if (!button || button.disabled) {
      setStatus("Choose a reference voice and make sure PocketWebTools is ready to generate speech.");
      return;
    }
    currentSentence = sentenceQueue.shift();
    setFieldValue(field, currentSentence);
    oldAudioSources = audioSources();
    generationStartedAt = Date.now();
    busy = true;
    setStatus("Pasting sentence and generating cloned speech (" + (sentenceQueue.length + 1) + " sentence(s) remaining)…");
    button.click();
    generationObserver = new MutationObserver(waitForGeneratedAudio);
    generationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.setTimeout(waitForGeneratedAudio, 700);
  }

  function queueReply(text) {
    const sentences = splitSentences(String(text || "").trim()).join(" ").length
      ? splitSentences(String(text || "").trim())
      : [String(text || "").trim()];
    if (!sentences.filter(Boolean).length) {
      setStatus("No assistant text to generate.");
      return;
    }
    sentenceQueue = sentences.map((sentence) => sentence.slice(0, MAX_TEXT)).filter(Boolean);
    currentSentence = "";
    setStatus("Queued " + sentenceQueue.length + " sentence(s) for sequential cloned speech.");
    generateNextSentence();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "POCKET_CLONE_TEXT" || typeof message.text !== "string") return;
    if (busy) {
      sendResponse({ ok: false, message: "A sentence is currently generating; please wait for the current reply to finish." });
      return;
    }
    queueReply(message.text.slice(0, MAX_TEXT));
    sendResponse({ ok: true, message: "Reply queued sentence by sentence for cloned speech." });
  });

  chrome.storage.local.get(["pendingCloneText"], (values) => {
    if (values.pendingCloneText) {
      const pending = String(values.pendingCloneText).trim().slice(0, MAX_TEXT);
      chrome.storage.local.remove("pendingCloneText");
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts++;
        if (!busy && findTextField()) {
          queueReply(pending);
          window.clearInterval(timer);
        } else if (attempts >= 40) {
          window.clearInterval(timer);
          setStatus("A reply is queued, but the PocketWebTools text box did not become ready. Reload the page and try again.");
        }
      }, 500);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target && event.target.matches("input[type='checkbox'], [role='checkbox']")) {
      window.setTimeout(generateNextSentence, 150);
    }
  }, true);

  pageObserver = new MutationObserver(() => {
    if (sentenceQueue.length && !busy) generateNextSentence();
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
})();