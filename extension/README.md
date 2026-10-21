# CordiaClassroom Chrome Extension

A Chrome side panel that turns the page you are studying into a CordiaClassroom study guide, with Cordia Tutor beside it.

## Install (Developer Mode)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `extension` folder.

## Open the panel

- Click the CordiaClassroom toolbar icon, or
- Press **Ctrl+Shift+Y** (**Command+Shift+Y** on Mac). You can change it at `chrome://extensions/shortcuts`.
- Or select text on a page, right-click, and choose **Make study guide from selection**. The panel opens and starts a guide from that text.

Sign in once at **classroom.cordiaai.io**. The panel picks up that sign-in and shows "Connected as …". Until then it shows a **Connect** link and the buttons stay off.

## Make a study guide

Click **Make study guide**. Four steps light up as it works:

1. **Capture** – takes a picture of the visible page (skipped if Chrome can't).
2. **Read** – reads the page or its document.
3. **Focus** – keeps the material worth studying.
4. **Create** – writes the study guide.

The guide shows in the panel. Click **Save to Classroom** to keep it; the tab then opens the saved guide. If Chrome can't switch tabs, an **Open guide** link appears instead.

### What gets read, in order

1. Text you selected on the page
2. A document embedded in the page (PDF, PowerPoint, Word, Google Docs/Slides/Sheets, text, images)
3. The page's own text
4. A document the page links to (when the page itself has little text)
5. The screenshot, if the page can't be read at all

Documents are downloaded with your browser sign-in and read by the CordiaClassroom server.

## Cordia Tutor

Under the guide button, ask Cordia about the current page. It reads the page first if you haven't made a guide yet, and remembers the conversation.

- **New chat** clears the conversation.
- **Full screen** gives the tutor the whole panel (**Exit full screen** shrinks it back).
- If a chat gets too long, Cordia asks you to start a new one.

## Free plan limits

When you run out of free guides or tutor questions, an upgrade sheet explains the limit and links to CordiaClassroom Pro. Close it with **×**.

## Files

- `manifest.json` – extension settings (Manifest V3), shortcut, permissions
- `popup.html`, `popup.js`, `styles.css` – the side panel (old "popup" names kept on purpose)
- `tutor-chat.js` – Cordia Tutor chat in the panel
- `background.js` – talks to the CordiaClassroom server, downloads documents, adds the right-click item
- `content.js` – finds the selection, document, or page text to read
- `asai-bridge.js` – shares your sign-in from classroom.cordiaai.io

The server address is set in `background.js` (`const API = 'https://autostudy-ai.fly.dev'`).

See the main [README](../README.md) for the rest of the project.
