# VoiceAgent Pocket

A lightweight Manifest V3 Chrome extension that combines a configurable AI assistant with microphone input, browser speech playback, and a manual PocketWebTools voice-cloning handoff.

## Features

- Chat with an OpenRouter model using the Chat Completions API.
- Configure your API key, model slug, and system behavior prompt.
- Dictate messages with the browser's Web Speech API where supported.
- Read assistant replies aloud with built-in browser speech synthesis.
- Keep the current conversation in the popup and clear it when you want.
- Copy the latest assistant response and open the PocketWebTools voice-cloning page.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository folder containing `manifest.json`.
5. Open the extension and select the settings gear.
6. Add your OpenRouter API key and save settings.
7. Type a message or select **Talk** to dictate one.

## OpenRouter setup

Create an API key in your OpenRouter account, then paste it into the extension settings. The default model is `openai/gpt-4o-mini`; replace it with any model slug available to your account.

Requests are sent to `https://openrouter.ai/api/v1/chat/completions`. See the [OpenRouter Chat Completions documentation](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request).

## PocketWebTools handoff

Select **Copy reply & open** after the assistant has answered. The extension copies the latest assistant text and opens [PocketWebTools voice cloning](https://pocketweb.tools/voice-cloning), where you can paste the text into the site's workflow.

**Important:** this is a manual handoff, not direct voice cloning. This project does not assume PocketWebTools offers a public API or automate its interface. The extension uses the browser's built-in speech synthesis for spoken replies; that voice is separate from any voice you may create on PocketWebTools.

## Privacy and security

- The API key is stored using `chrome.storage.local` in your browser profile. This is convenient local storage, **not** a secure secrets vault. Anyone with access to your browser profile may be able to access it.
- Do not commit API keys, passwords, or private voice samples to this repository.
- Chat messages are sent to the OpenRouter service and selected model provider when you submit them. Review the applicable provider privacy policies.
- Speech recognition depends on browser support and may use browser/vendor services. Review your browser's privacy settings.
- The extension requests storage and clipboard-write permissions and declares OpenRouter as a host permission.

## Current limitations

- The popup conversation is session-only; it is not saved as chat history after the popup is closed.
- Microphone recognition requires browser support and may require permission.
- The PocketWebTools integration opens the site and copies text; it does not upload audio, create a voice model, or perform cloning automatically.
- Assistant answers can be incorrect. Verify important information.

## Project files

- `manifest.json` — extension manifest and permissions
- `popup.html` — popup interface
- `popup.css` — visual styles
- `popup.js` — settings, chat requests, speech input/output, and cloning handoff

## License

MIT — see [LICENSE](LICENSE).