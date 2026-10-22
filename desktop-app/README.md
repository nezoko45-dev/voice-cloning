# Voice Studio — Windows desktop

A local-first Electron desktop app for reference-audio voice cloning and text-to-speech. The existing Chrome extension is unchanged.

## Engine

Uses the native Windows Pocket TTS command-line release from Kyutai's official repository, pinned to `v4.0.1`. The engine is downloaded from the official GitHub Releases API on first generation; no Python or PyTorch is installed. The engine uses CPU inference. WebGPU is not needed or claimed.

Official project: https://github.com/kyutai-labs/pocket-tts
CLI reference: https://github.com/kyutai-labs/pocket-tts/blob/main/docs/CLI%20Commands/generate.md

## Current functionality

- Select a reference recording in common audio/video formats.
- FFmpeg normalizes the chosen file to mono 24 kHz PCM WAV before voice conditioning.
- Enter text and generate speech with Pocket TTS.
- Preview the output WAV and open its location.
- First run downloads the native engine; first synthesis downloads the model weights.
- Engine and model cache live in the app's user-data directory. Subsequent generation is local; the app does not send text or reference audio to a cloud service.
- No Python setup for end users.

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

The installer is written to `release/Voice-Studio-Setup-0.2.0.exe`.


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

### Bridge smoke tests

1. With Voice Studio open, save the token in extension settings and use **Test connection**.
2. Send a short text with **To Studio**; confirm it fills the editor and does not trigger generation.
3. Send empty text and more than 12,000 characters; confirm the extension reports a useful validation error.
4. Enter an incorrect token; confirm the request is rejected.
5. Close Voice Studio and retry; confirm the extension reports that the bridge is unavailable.
6. Confirm the desktop server binds only to loopback (127.0.0.1) and cannot be reached from another device on the LAN.

## First launch

The first generation requires an internet connection to download the official native runtime and Pocket TTS model. After the model has been cached, speech generation can run offline. If the model is not already cached and the computer is offline, generation will fail with a download error.

## Known limitations / before release

- Pocket TTS is CPU-only in its native standalone runtime; it does not use WebGPU.
- The first run's model download progress is shown as engine log messages, not a byte-accurate progress bar.
- The current model preset is English. Pocket TTS supports additional languages with their respective model configurations.
- Import filters list common media formats; FFmpeg must be able to decode the actual codec/container.
- This source has not been built or end-to-end tested on Windows in this environment. Verify the official release archive's Windows asset naming and run the smoke tests below before distributing.
- The app downloads and runs a native executable. It is pinned to an official release and verifies GitHub's SHA-256 asset digest when the release API provides one.

## Smoke test checklist

1. Build and launch on Windows 10/11 x64.
2. Click Generate with a clean WAV reference; verify engine install and model download.
3. Generate output, listen, and confirm a valid PCM WAV is created.
4. Repeat with M4A, FLAC and MP3 references.
5. Disconnect the network after the first successful generation and verify another generation succeeds.
6. Confirm the app makes no network requests during cached generation.
7. Review upstream model license and prohibited-use rules before redistribution.

## Privacy and consent

Text, reference audio and generated speech are passed only to the local executable. Network is used to download the pinned runtime and model files. Only clone voices you own or have explicit, lawful permission to use; do not use generated audio to impersonate someone or deceive others.