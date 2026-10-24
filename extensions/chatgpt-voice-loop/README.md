# ChatGPT Dictate → Send → Read Aloud

A small Chrome Manifest V3 extension for ChatGPT in the browser. When enabled, it:
1. Monitors microphone audio for speech activity.
2. Clicks ChatGPT's **Dictate** button when you start speaking.
3. Detects a pause in your speech and explicitly clicks **Stop dictation**.
4. Clicks **Send**.
5. Waits for the assistant response to finish and attempts to click **Read aloud**.
6. Returns to listening for your next spoken message.

## Install in Chrome (Windows)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `chatgpt-voice-loop` folder.
5. Open ChatGPT, click the extension icon, enable **automatic voice loop**, and save.
6. Grant microphone permission when prompted. The monitor needs microphone access to detect when speech starts and ends.
7. Reload the ChatGPT tab once after installing or updating the extension.

## Important notes
- The extension uses a microphone stream only for local speech-activity detection; ChatGPT's own Dictate control performs transcription. The extension itself does not send or store microphone audio.
- Chrome must allow microphone access for the ChatGPT site. Keep the ChatGPT tab open and in a state where the Dictate control is available.
- The silence duration is configurable. A longer pause reduces the chance of cutting you off between phrases; a shorter pause feels faster.
- Speech detection is based on audio volume, not perfect speech recognition. Loud background noise can trigger it, and very quiet speech may not trigger it.
- Review transcripts before sending anything important. Speech recognition can mishear words.
- This is a browser extension, not a background voice service. Browser permissions, page state, and ChatGPT UI changes can affect it.
- ChatGPT may change button labels or page structure, so selectors may need updating. The extension has not been validated against every ChatGPT UI version.
- If **Read aloud** is unavailable for a response, the extension reports that and returns to listening.
