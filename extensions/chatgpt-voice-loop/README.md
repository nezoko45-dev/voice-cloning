# ChatGPT Dictate → Send → Read Aloud

A small Chrome Manifest V3 extension for ChatGPT in the browser. It can:
1. Click ChatGPT's **Dictate** button.
2. Stop dictation after the configured transcript-quiet period.
3. Click **Send**.
4. Wait for the assistant response to finish and click **Read aloud**.

## Install in Chrome (Windows)
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `chatgpt-voice-loop` folder.
5. Open ChatGPT, click the extension icon, enable **automatic voice loop**, and save.
6. Reload the ChatGPT tab once after installing or updating the extension.

## Important notes
- This automates ChatGPT's visible page controls; ChatGPT may change button labels or page structure, so selectors may need updating.
- Keep the ChatGPT tab open and in a state where the Dictate control is available.
- The pause duration is configurable. Longer pauses reduce the chance of cutting off between phrases; shorter pauses feel faster.
- Review transcripts before sending anything important. Speech recognition can mishear words.
- This is a browser extension, not a background voice service. Browser permissions, page state, and ChatGPT UI changes can affect it.
- If **Read aloud** is unavailable for the current response, the extension reports that and waits for the next cycle.
- No speech audio is uploaded by this extension itself; it uses ChatGPT's own Dictate feature.
