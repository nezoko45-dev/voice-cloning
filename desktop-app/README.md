# Voice Studio — Windows desktop

A local-first Electron desktop app for Kokoro text-to-speech. The existing Chrome extension and its localhost text bridge are preserved.

## Engine

Uses Kokoro 82M through Hugging Face Transformers.js and ONNX Runtime. No Python, PyTorch, or separate runtime installer is required. The first generation downloads the quantized model to the app's user-data cache; later generations run locally.

Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
Runtime: https://github.com/huggingface/transformers.js

Kokoro provides preset voices and does **not** clone a speaker from a WAV reference recording. Voice Studio offers selectable English voices including US and British English options.

## Current functionality

- Type text or send it from the existing Chrome extension into the editor for review.
- Select a built-in Kokoro voice.
- Synthesize text locally in chunks to handle longer passages.
- Write standard mono, 16-bit PCM WAV output to `Documents\\Voice Studio\\voice-studio-output.wav`, replacing the previous output on each generation.
- Preview the output WAV and open its location.
- First generation downloads the ONNX model files; subsequent generations use the local cache.
- No Python setup for end users. Text synthesis runs on the PC; the first model download requires internet access.

## Build

Development requires Node.js (not Python):

```powershell
cd desktop-app
npm install
npm start
```

Build the Windows installer on a Windows x64 machine:

```powershell
npm install
npm run dist:win
```

The installer is written to `release/Voice-Studio-Setup-0.2.0.exe`. Rebuild the Windows installer after source or dependency changes.


## Chrome extension bridge

The existing Chrome extension's current chat, microphone, and local TTS behavior is preserved. The popup adds a **To Studio** button that sends the text currently in its message box to the open Electron app. The desktop app fills the text editor so you can review it; the bridge never starts speech generation automatically.

### One-time setup

1. Start Voice Studio and keep its window open. The bridge listens only on `127.0.0.1:47831`; it is not exposed to your LAN and shuts down when the app exits.
2. In Voice Studio, find **Chrome extension bridge** and click **Copy token**.
3. Open the Chrome extension popup, click Settings, paste the token into **Voice Studio bridge token**, and click **Save settings**.
4. Click **Test connection**. Keep Voice Studio open when sending text.
5. Type text in the extension message box and click **To Studio**. The text should appear in Voice Studio's editor. Review it and click **Generate speech** when ready.

The bridge token is saved in the app's user-data directory and persists across launches. Store it like a password; anyone who has it and can make requests from a Chrome extension context on this PC can submit text to the open app. You can clear/regenerate it by closing Voice Studio and deleting `bridge-token.txt` from the app's user-data directory before restarting.

### Bridge security and behavior

- The HTTP server binds explicitly to `127.0.0.1`, never `0.0.0.0`.
- Requests must use a Chrome extension origin, include the per-install bearer token, and contain JSON with a non-empty `text` string of at most 12,000 characters.
- Request bodies are size-limited; unsupported methods/content types and invalid payloads are rejected.
- The extension uses a fixed localhost URL, not a user-configurable remote host.
- No text is sent to a cloud service by this bridge. It only transfers text between the extension and Voice Studio on the same computer.
- Voice Studio must be running and its window open. If it is closed, the extension cannot deliver text.
- The bridge is an additional feature; the extension's existing OpenRouter chat behavior remains unchanged.

### Troubleshooting: model download or generation fails

The first generation needs internet access to download the Kokoro ONNX model. If it fails, copy the complete error shown in the status area. Confirm the PC can reach Hugging Face and that the app has write access to its user-data cache. Restarting an older installer does not include new code; rebuild and reinstall after updating the branch.

### Bridge smoke tests

1. With Voice Studio open, save the token in extension settings and use **Test connection**.
2. Send a short text with **To Studio**; confirm it fills the editor and does not trigger generation.
3. Send empty text and more than 12,000 characters; confirm the extension reports a useful validation error.
4. Enter an incorrect token; confirm the request is rejected.
5. Close Voice Studio and retry; confirm the extension reports that the bridge is unavailable.
6. Confirm the desktop server binds only to loopback (127.0.0.1) and cannot be reached from another device on the LAN.

## First launch

The first generation requires internet access to download the Kokoro model from Hugging Face. After the model files have been cached, synthesis can run offline. The output is saved locally.

## Known limitations / before release

- Kokoro uses preset voices and does not clone from reference audio.
- The first model download can take time; progress messages appear in the status area.
- This source has not yet been built or end-to-end tested on Windows in this environment. Run the smoke tests below before distributing.

## Smoke test checklist

1. Build and launch on Windows 10/11 x64.
2. Select a Kokoro voice and generate a short sentence; verify the model downloads.
3. Generate a longer paragraph, listen, and confirm a valid PCM WAV is created.
4. Try several voices and confirm the selected voice is reflected in the result status.
5. Disconnect the network after the first successful generation and verify another generation succeeds.
6. Confirm cached generation does not need network access.
7. Review upstream model license and prohibited-use rules before redistribution.

## Privacy and consent

Text is synthesized locally. Network is used to download model files on first run. Do not use generated audio to impersonate someone or deceive others.