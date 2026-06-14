# Interview Copilot — Chrome/Edge extension

A compact **side-panel** version of Interview Copilot. Everything the web app does,
but docked beside your call and able to capture the meeting tab in **one click**.

**🛒 Buy / pricing:** https://interview-relay.vercel.app/buy
**🌐 App:** https://interview-relay.vercel.app
**📥 Install guide:** https://interview-relay.vercel.app/install
**⬇ Download (.zip):** https://github.com/minhtawlwe-svg/interview-copilot-extension/releases/latest

- 🖥️ **Capture this tab** — grabs the active tab's audio via `chrome.tabCapture`
  (no screen-share picker). You still hear the call normally. Questions are
  detected and answered automatically (Live mode). Falls back to the screen-share
  picker if tab capture isn't available.
- 🎤 **Record my answer** — mic with a live level meter + timer (Practice scores it).
- 💬 **Type** a question for an instant answer.
- EN / မြန်မာ, Live / Practice, streaming answers. Works for **any field/role** —
  answers are grounded in the background you type in Setup.
- 🪟 Frosted-glass UI.

## Access — code only, **no key needed**

Users enter **just an access code** the owner gave them — **no Gemini key**. The AI
is included: requests go to the relay (`interview-relay.vercel.app`), which uses the
owner's shared key pool on the user's behalf. Settings are stored **only on this
device** (`chrome.storage.local`, never cloud-synced). The relay stores nothing.

There are two tiers of code:

- **Practice (free)** — `prep`-tier code. Works in **Practice mode only** (record
  your answer → score + a better answer + a tip). The owner's free public code is
  fine to share publicly.
- **Live (paid)** — `live`-tier code. Unlocks **Live / real-time answering** (tab
  capture + typed questions) as well as Practice.

A `prep` code used in Live mode is rejected with a clear "needs a Live code" message.
Each code has a per-day usage limit and can be revoked or expired by the owner.

## Install (unpacked)

1. Open **chrome://extensions** (or **edge://extensions**).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`C:\Users\lenovo\interview-copilot-extension`).
4. Pin the icon. Click it (or press **Ctrl+Shift+U**) to open the side panel.
5. In **Setup**, paste the **access code** the owner gave you and write your
   background. That's it — no key to enter.

## Owner / access control

You own this copilot; others use it only with a code you issue. Codes are checked
**server-side at your relay**, so they can be revoked or expired any time.

Manage everything from the local admin app (in the `interview-relay` folder):
double-click **`relay-ui.bat`** → `http://127.0.0.1:8787`:

- **Access codes** tab — issue a code, pick **tier** (prep = free practice, live =
  paid) and **plan** (1m / 3m / 6m), copy it, or revoke it. Changes push to the
  relay and go live in ~30–60s.
- **Gemini keys** tab — add free Gemini keys to the shared pool that serves all
  users (no per-user keys anymore).

Without any codes issued the relay is **locked** (`503`) for everyone except the
owner's desktop app (which authenticates with `RELAY_SECRET`).

## Using it in an interview

- Join the interview in a **browser tab** (Google Meet / Zoom web / Teams web).
- Open the side panel, make sure **Live** is selected (needs a Live code), click
  **Capture this tab**.
- As the interviewer speaks, answers appear. Glance, speak, done.
- For a phone / desktop-app interview, use **Record my answer** or the typed box.

## Notes

- Tab capture works on normal web pages, not on `chrome://` pages or the
  extension's own pages.
- First mic use will ask for microphone permission.
- Change the keyboard shortcut at **chrome://extensions/shortcuts**.
- To publish on the Chrome Web Store later: zip this folder and submit it in the
  developer dashboard (one-time $5 fee). It runs fine unpacked in the meantime.
