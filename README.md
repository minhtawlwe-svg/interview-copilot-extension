# Interview Copilot — Chrome/Edge extension

A compact **side-panel** version of Interview Copilot. Everything the web app does,
but docked beside your call and able to capture the meeting tab in **one click**.

- 🖥️ **Capture this tab** — grabs the active tab's audio via `chrome.tabCapture`
  (no screen-share picker). You still hear the call normally. Questions are
  detected and answered automatically (Live mode). Falls back to the screen-share
  picker if tab capture isn't available.
- 🎤 **Record my answer** — mic with a live level meter + timer (Practice scores it).
- 💬 **Type** a question for an instant answer.
- EN / မြန်မာ, Live / Practice, streaming answers. Works for **any field/role** —
  the answers are grounded in the background you type in Setup.
- **Bring-your-own-key**: paste your free Gemini key once; it's saved **only on
  this device** (`chrome.storage.local`, never cloud-synced). Requests go through
  the same stateless relay (`interview-relay.vercel.app`) so it works even where
  Gemini is geo-blocked. The relay stores nothing.
- **Invite-only**: the relay rejects anyone without a valid **access code** the
  owner issued. See *Owner / access control* below.

## Install (unpacked)

1. Open **chrome://extensions** (or **edge://extensions**).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`C:\Users\lenovo\interview-copilot-extension`).
4. Pin the 🎤 icon. Click it (or press **Ctrl+Shift+U**) to open the side panel.
5. In **Setup**, enter the **access code** the owner gave you, paste your Gemini
   key (get one free at https://aistudio.google.com/apikey), and write your
   background.

## Owner / access control

You own this copilot — others can only use it with a code you issue. Codes are
checked **server-side at your relay**, so a code can be revoked any time.

1. In Vercel → your `interview-relay` project → **Settings → Environment
   Variables**, add **`ACCESS_CODES`** = a comma/space-separated list of codes,
   e.g. `alice-7Kq2, bob-9Zr5, demo-temp1`.
2. **Redeploy** the project (env changes need a new deployment).
3. Give each person one code. They paste it into **Setup → Access code**.
4. **Revoke** anyone by deleting their code from `ACCESS_CODES` and redeploying —
   they get *"Access denied"* on the next request.
5. Without any `ACCESS_CODES` set, the relay is **locked** (503) for everyone
   except the owner's desktop app (which authenticates with `RELAY_SECRET`).

Each invited user spends **their own** free Gemini quota — codes never expose
your keys, and the relay can't be used as an open proxy by other websites.

## Using it in an interview

- Join the interview in a **browser tab** (Google Meet / Zoom web / Teams web).
- Open the side panel, make sure **Live** is selected, click **Capture this tab**.
- As the interviewer speaks, answers appear. Glance, speak, done.
- For a phone/desktop-app interview, use **Record my answer** or the typed box.

## Notes

- Tab capture works on normal web pages, not on `chrome://` pages or the
  extension's own pages.
- First mic use will ask for microphone permission.
- Change the keyboard shortcut at **chrome://extensions/shortcuts**.
- To publish on the Chrome Web Store later: zip this folder and submit it in the
  developer dashboard (one-time $5 fee). It runs fine unpacked in the meantime.
