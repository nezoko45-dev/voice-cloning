(() => {
  const MAX_TEXT = 2000;
  let queuedText = "";
  let busy = false;
  let observer = null;

  const visible = (el) => !!(el && el.getClientRects().length);
  const normalized = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();

  function findTextField() {
    const fields = [...document.querySelectorAll("textarea, [contenteditable='true'], input[type='text']")].filter(visible);
    // Prefer a multi-line text editor; ignore newsletter/email fields.
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

  function attemptGenerate() {
    if (!queuedText || busy) return;
    const field = findTextField();
    if (!field) return;
    setFieldValue(field, queuedText);
    const consent = findConsentCheckbox();
    if (!isChecked(consent)) {
      setStatus("Reply is ready in PocketWebTools. Select the voice-permission checkbox to allow automatic generation.");
      return;
    }
    const button = findGenerateButton();
    if (!button || button.disabled) {
      setStatus("Reply inserted. Choose a reference voice on PocketWebTools, then generation can continue.");
      return;
    }
    busy = true;
    setStatus("Generating speech with your selected reference voice…");
    button.click();
    // Watch for the generated player and try to play it. Browser autoplay policy may still require a click.
    const startedAt = Date.now();
    const playWhenReady = () => {
      const audio = [...document.querySelectorAll("audio")].find(visible);
      if (audio && audio.readyState >= 2) {
        audio.play().then(() => setStatus("Cloned speech generated and playing."))
          .catch(() => setStatus("Cloned speech generated. Press Play on the audio player if it did not start."));
        if (observer) observer.disconnect();
        observer = null;
        busy = false;
        queuedText = "";
        return;
      }
      if (Date.now() - startedAt > 120000) {
        if (observer) observer.disconnect();
        observer = null;
        busy = false;
        setStatus("Generation may need attention in the PocketWebTools tab.");
      }
    };
    observer = new MutationObserver(playWhenReady);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.setTimeout(playWhenReady, 1000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "POCKET_CLONE_TEXT" || typeof message.text !== "string") return;
    queuedText = message.text.trim().slice(0, MAX_TEXT);
    if (!queuedText) {
      sendResponse({ ok: false, message: "No assistant text to generate." });
      return;
    }
    attemptGenerate();
    sendResponse({ ok: true, message: "Assistant reply sent to PocketWebTools." });
  });

  // If the extension opened this page with a queued response, wait for the UI to hydrate.
  chrome.storage.local.get(["pendingCloneText"], (values) => {
    if (values.pendingCloneText) {
      queuedText = String(values.pendingCloneText).trim().slice(0, MAX_TEXT);
      chrome.storage.local.remove("pendingCloneText");
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts++;
        attemptGenerate();
        if (!queuedText || attempts >= 40) window.clearInterval(timer);
      }, 500);
    }
  });

  // If the user checks the consent box after the reply was queued, continue automatically.
  document.addEventListener("change", (event) => {
    if (event.target && (event.target.matches("input[type='checkbox'], [role='checkbox']"))) {
      window.setTimeout(attemptGenerate, 100);
    }
  }, true);
  const pageObserver = new MutationObserver(() => { if (queuedText && !busy) attemptGenerate(); });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
})();