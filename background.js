// Service worker: (1) open the side panel, (2) ZERO-CLICK capture via the
// Ctrl+Shift+U shortcut, and (3) orchestrate the offscreen tab-audio capturer.
//
// Why the shortcut gives zero-click capture: chrome.tabCapture.getMediaStreamId
// is only allowed once the extension has been "invoked" on the target tab by a
// user gesture. A button inside the side panel does NOT count, but pressing the
// command shortcut (or clicking the toolbar icon) DOES — so the shortcut path can
// start capture with no picker dialog at all. A side-panel button click still
// works too, falling back to the share picker when one-click isn't permitted.
//
// Message flow:
//   side panel  --cap-start{tabId}-->  here   (manual button path)
//   shortcut    --(internal)------->   here   (zero-click path)
//   here: ensure OFFSCREEN doc + mint a tabCapture streamId
//   here  --offscreen-start{streamId}-->  offscreen.js (getUserMedia + VAD)
//   offscreen  --cap-level / cap-audio / cap-error-->  side panel
//   here  --cap-state{on}-->  side panel  (so its UI reflects shortcut captures)

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// tabCapture can't grab chrome:// / Web Store pages — detect that early.
function isCapturableUrl(url) {
  return !!url && /^https?:|^file:/i.test(url) && !/^https:\/\/chrome\.google\.com\/webstore/i.test(url);
}

let capturing = false;   // is a tab capture currently live?

function broadcastCapState() {
  chrome.runtime.sendMessage({ cmd: 'cap-state', on: capturing }).catch(() => {});
}

// Ctrl+Shift+U (or the configured shortcut): open the panel AND, because this
// gesture invokes the extension on the active tab, start capture with no dialog.
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'open-copilot') return;
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) { return; }  // no active window
  if (!tab) return;
  if (!isCapturableUrl(tab.url)) {
    chrome.runtime.sendMessage({ cmd: 'cap-note',
      text: 'This page can’t be captured (chrome:// or store page). Open the meeting in a normal tab.' }).catch(() => {});
    return;
  }
  try {
    await startTabCapture(tab.id);
    capturing = true;
    broadcastCapState();
  } catch (e) {
    // Rare: Chrome refused the one-click grant. The panel is open — the button's
    // picker fallback still works, so just nudge the user there.
    chrome.runtime.sendMessage({ cmd: 'cap-note',
      text: 'Couldn’t auto-capture (' + ((e && e.message) || e) + '). Click “Capture this tab” to share manually.' }).catch(() => {});
  }
});

// ---- offscreen document lifecycle ----
const OFFSCREEN_PATH = 'offscreen.html';
let creating = null;   // de-dupes concurrent createDocument calls

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return ctx.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creating) { await creating; return; }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Capture the meeting tab audio for live interview transcription.',
  }).catch(e => {
    // Swallow the "only a single offscreen document" race; rethrow anything else.
    if (!/single offscreen|already/i.test((e && e.message) || '')) throw e;
  });
  try { await creating; } finally { creating = null; }
}

async function closeOffscreen() {
  try { if (await hasOffscreen()) await chrome.offscreen.closeDocument(); } catch (e) {}
}

// Mint a tabCapture stream id for the target tab and start the offscreen capturer.
async function startTabCapture(tabId) {
  await ensureOffscreen();
  const streamId = await new Promise((res, rej) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
      const e = chrome.runtime.lastError;
      e ? rej(new Error(e.message)) : res(id);
    }));
  // offscreen.js registers its listener synchronously on load, so it's ready now.
  await chrome.runtime.sendMessage({ cmd: 'offscreen-start', streamId });
}

async function stopTabCapture() {
  chrome.runtime.sendMessage({ cmd: 'offscreen-stop' }).catch(() => {});
  await closeOffscreen();
  capturing = false;
  broadcastCapState();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.cmd === 'cap-start') {                      // manual button path
    startTabCapture(msg.tabId)
      .then(() => { capturing = true; sendResponse({ ok: true }); })
      .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
    return true;  // async sendResponse
  }
  if (msg.cmd === 'cap-stop') {
    stopTabCapture().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.cmd === 'cap-query') {                      // panel sync on open
    sendResponse({ on: capturing });
    return true;
  }
  if (msg.cmd === 'cap-error') {                      // offscreen capture died
    capturing = false; broadcastCapState();
    return;
  }
  // 'cap-level', 'cap-audio', 'cap-state', 'cap-note', 'answering' are handled by
  // the offscreen doc / side panel directly — nothing to do here.
});
