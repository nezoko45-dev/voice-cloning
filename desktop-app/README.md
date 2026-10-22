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