# VoiceAgent Pocket

A Manifest V3 Chrome extension that pairs an OpenRouter chat assistant with automatic text handoff to PocketWebTools' browser-based voice-cloning page.

## Features

- Chat with an OpenRouter model; configure the API key, model slug, and system prompt.
- Attempt to keep microphone speech recognition running in an extension offscreen document after the popup is closed. Web Speech recognition is not exposed in every Chrome/offscreen environment; the extension now reports this as a status error instead of crashing.
- Automatically send each assistant reply to an open PocketWebTools voice-cloning tab.
- Fill the voice-cloning text field, then trigger generation when the page's permission checkbox is checked.
- Attempt to play generated audio automatically; browser autoplay policies may require pressing Play.
- Optional browser-native speech as a fallback.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open VoiceAgent Pocket, open settings, enter your OpenRouter API key, and save.
5. Click **Open voice setup**. On PocketWebTools, record or upload a clean 6–10 second reference sample of your own voice (or a voice you have explicit permission to clone).
6. Confirm the site's permission checkbox. Keep the PocketWebTools voice-cloning tab open.
7. Open the extension and click **Talk** to grant microphone permission and try background listening. If Chrome does not support Web Speech recognition in the offscreen document, the extension will show a clear status message and stop rather than repeatedly failing. When supported, recognized speech is sent to the assistant and replies are sent to PocketWebTools automatically. Click **Stop listening** from the popup to stop it.

The first model load may download a large local model and take a while. PocketWebTools reports that it processes the reference voice, text, and generated audio locally in the browser.

## How the integration works

There is no documented public API assumed by this project. Instead, the extension's content script communicates with the PocketWebTools page, fills its text field, and clicks **Generate speech** after the site's voice-permission checkbox is checked. The extension tries to play the resulting audio element, but browser autoplay policy or future changes to the site's UI may require manual interaction.

Keep the PocketWebTools tab open while chatting. If the page layout changes, automatic field detection may need updating. The voice sample is selected on PocketWebTools itself; the extension does not upload or store it.

## OpenRouter

The default model is `openai/gpt-4o-mini`. Use a model slug available to your OpenRouter account. Requests are sent to `https://openrouter.ai/api/v1/chat/completions`.

## Privacy and safety

- The OpenRouter API key is stored in `chrome.storage.local`, not a secure secrets vault.
- Chat prompts and replies are sent to OpenRouter and the selected model provider.
- PocketWebTools says its voice sample, input text, and generated audio stay in the browser and are not uploaded.
- The extension only uses the cloning page after the user opens it and provides their reference recording. Consent must be explicitly confirmed on the site.
- Only clone your own voice or a voice you have explicit permission to use.

## Files

- `manifest.json` — permissions and extension configuration
- `popup.html`, `popup.css`, `popup.js` — assistant interface and listening controls
- `background.js` — offscreen document lifecycle, OpenRouter requests, and background conversation routing
- `offscreen.html`, `offscreen.js` — guarded background speech recognition and reconnect handling
- `content.js` — integration with the open PocketWebTools voice-cloning page

## License

MIT — see [LICENSE](LICENSE).
