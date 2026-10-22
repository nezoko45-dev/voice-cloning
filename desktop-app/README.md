# Voice Studio (Windows desktop app)

A separate Electron app under development; it does not replace the existing Chrome extension.

## Current status

**UI scaffold only — not yet a working TTS build.** The Electron shell, isolated IPC bridge, audio file picker, text field, and generation workflow are in place. A compatible Windows voice-cloning inference runtime still needs to be built and bundled, and model download/verification needs to be implemented. Until then, Generate reports that the engine is missing rather than pretending to produce audio.

The runtime contract expects `runtime/voice-engine.exe` with this command-line interface:

```text
voice-engine.exe --text "Text to speak" --reference "C:\path\voice.wav" --output "C:\path\output.wav"
```

That executable is a placeholder contract, not a binary included in this commit.

## Intended behavior

- Windows 10/11 desktop app with no Python installation required for end users.
- Import common audio types: WAV, MP3, M4A, FLAC, OGG, OPUS, AAC, AIFF, WMA, MP4 and WebM.
- Normalize supported inputs with FFmpeg before inference (not wired up yet).
- Download the selected model once, verify its integrity, then run offline.
- Keep reference audio, text, model files and generated speech on-device.
- Use WebGPU only if the selected inference runtime and model genuinely support it; otherwise provide a compatible fallback.

## Development

Install Node.js for development, then run:

```powershell
cd desktop-app
npm install
npm start
```

Build a Windows installer:

```powershell
npm run dist:win
```

Do not distribute this scaffold as a functional voice-cloning app until the Windows runtime, model setup, audio normalization and end-to-end tests are completed.

## Responsible use

Only clone voices you own or have explicit permission to use. Review runtime and model licenses before redistribution or commercial use. Network access in the finished app should be limited to explicit first-run model downloads and optional updates.