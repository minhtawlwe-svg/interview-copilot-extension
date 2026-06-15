'use strict';
const $ = s => document.querySelector(s);
const RELAY = 'https://interview-relay.vercel.app/api/ask';
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash'];
// HANG_MS = silence after speech before a segment is sent (the main "feels slow"
// knob — lower = snappier, too low risks splitting one question into two).
const SR = 16000, SILENCE_RMS = 0.012, HANG_MS = 700, MIN_MS = 800, MAX_MS = 30000;

const state = { mode: 'live', lang: 'en', answering: false };

// ---- settings (stored ON THIS DEVICE only — never cloud-synced) ----
const store = {
  get: (k, d) => new Promise(r => chrome.storage.local.get([k], o => r(o[k] ?? d))),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
// One-time migration: older builds kept the key/profile in cloud-synced storage.
// Pull anything found there into device-only local storage, then wipe the synced
// copy so the API key + personal background stop leaving this machine.
async function migrateFromSync() {
  const ks = ['key', 'profile', 'mode', 'lang', 'access'];
  const synced = await new Promise(r => chrome.storage.sync.get(ks, o => r(o || {})));
  const present = ks.filter(k => synced[k] !== undefined);
  if (!present.length) return;
  const have = await new Promise(r => chrome.storage.local.get(ks, o => r(o || {})));
  for (const k of present) if (have[k] === undefined) await store.set(k, synced[k]);
  chrome.storage.sync.remove(present);
}
async function loadSettings() {
  await migrateFromSync();
  $('#key').value     = await store.get('key', '') || await store.get('access', '');
  $('#profile').value = await store.get('profile', '');
  state.mode = await store.get('mode', 'live');
  state.lang = await store.get('lang', 'en');
  syncSeg('#modeSeg', state.mode); syncSeg('#langSeg', state.lang);
  if (!$('#key').value) $('#setup').open = true;  // first run
  updateModeLine();
}
$('#key').addEventListener('input', e => store.set('key', e.target.value.trim()));
$('#profile').addEventListener('input', e => store.set('profile', e.target.value));

function syncSeg(sel, val) {
  $(sel).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === val));
}
function wireSeg(sel, key, onSet) {
  $(sel).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    syncSeg(sel, b.dataset.v); state[key] = b.dataset.v; store.set(key, b.dataset.v); onSet && onSet();
  }));
}
wireSeg('#modeSeg', 'mode', updateModeLine);
wireSeg('#langSeg', 'lang', updateModeLine);
function updateModeLine() {
  $('#modeLine').textContent = state.mode === 'live'
    ? 'Live: capture the interviewer or type a question → ready-to-speak answer.'
    : 'Practice: record your answer → score, better answer, and a tip.';
  $('#micBtn').querySelector('span').textContent =
    state.mode === 'live' ? 'Speak a question' : 'Record my answer';
}

// ---- status ----
function setStatus(t, c) { $('#statusText').textContent = t; $('#statusDot').style.background = c || 'var(--muted)'; }
function flash(msg) { const o = $('#answer'); o.classList.remove('empty'); o.textContent = msg; }

// ---- prompt ----
function systemPrompt() {
  const profile = ($('#profile').value || '').trim() ||
    'A job candidate. No background provided — answer generically and professionally.';
  const langDir = state.lang === 'my'
    ? "Write EVERY word of prose in MYANMAR (Burmese) — the answer, the Score reason, the Better answer, "
      + "the Tip and any explanation. Do NOT write any sentence, reason or label-text in English. The ONLY "
      + "English allowed is technical terms, product/tool names and common acronyms (e.g. API, SQL, KPI, ROI, "
      + "CRM, UX, HR, SDK), and only the term itself — the words around it stay Burmese. Keep the field labels "
      + "from the format above exactly as written, but everything after each label must be Burmese. Write "
      + "natural, professional spoken Burmese, not a stiff translation."
    : "Answer ENTIRELY in English — even if the question was asked in Myanmar or a mix of languages. "
      + "Every label and all prose must be in English.";
  const base = state.mode === 'practice'
    ? `You are an interview coach. The input is the CANDIDATE answering a question.\n`
      + `Respond exactly:\nHeard: <one-line transcription>\nScore: <0-10> - <short reason>\n`
      + `Better answer:\n<a fuller, well-developed model answer with concrete specifics and a brief example>\nTip: <one specific delivery/content tip>`
    : `You are an expert interview copilot. The input is a question from an INTERVIEWER `
      + `(spoken or typed, any language).\nDo TWO things in this format:\nQ: <one-line transcription>\nA:\n`
      + `<a detailed, confident answer the candidate can speak in ~60-90s, with enough depth to sound genuinely expert>\n`
      + `Rules: technical → 5-8 substantive bullets, each with a brief explanation; behavioral → full STAR with concrete specifics (5-8 sentences); no preamble; `
      + `ground every answer in the candidate background; if the input is not a question reply only "(no question)".`;
  return base + `\n\nLanguage: ${langDir}\n\nCANDIDATE BACKGROUND (speak first-person as them):\n` + profile;
}

// ---- relay call (streams the answer) ----
async function ask(type, payload) {
  // One or more keys (one per line / comma / space). HTTP headers can't contain
  // newlines, so normalize to a comma-separated list; the relay rotates across them.
  const key = ($('#key').value || '').split(/[\s,]+/).filter(Boolean).join(',');
  if (!key) { $('#setup').open = true; flash('Add your free Gemini API key in Setup first — get one at aistudio.google.com/apikey'); return; }
  // Free for all: each user brings their own Gemini key(s); the relay only forwards them.
  if (state.answering) return;
  state.answering = true; setStatus('Thinking…', 'var(--accent)');
  $('#statusDot').classList.add('working');
  // Pause the offscreen capturer's VAD while we stream an answer (no effect in picker mode).
  chrome.runtime.sendMessage({ cmd: 'answering', value: true }).catch(() => {});
  const out = $('#answer'); out.classList.remove('empty');
  out.textContent += (out.textContent && !out.textContent.endsWith('\n') ? '\n' : '') + '──────────\n';
  // Instant feedback: blink a typing caret where the answer will appear, so the
  // gap between "send" and the first token never feels dead. Cleared the moment
  // real text arrives (or on error).
  const anchor = out.textContent;
  let blink = true, thinking = setInterval(() => {
    out.textContent = anchor + (blink ? '▌' : ' '); blink = !blink; out.scrollTop = out.scrollHeight;
  }, 450);
  const stopThinking = () => { if (thinking) { clearInterval(thinking); thinking = null; out.textContent = anchor; } };
  try {
    const resp = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': key },
      body: JSON.stringify({ system: systemPrompt(), type, payload, mode: state.mode, models: MODELS, max_output_tokens: 2600 }),
    });
    if (!resp.ok) {
      stopThinking();
      const t = await resp.text();
      out.textContent += resp.status === 401 ? (t.includes('NO_KEY')
          ? '\n[!] Add your free Gemini API key in Setup — get one at aistudio.google.com/apikey\n'
          : '\n[!] Your Gemini key was rejected. Check it, or make a new free one at aistudio.google.com/apikey\n')
        : resp.status === 503 ? '\n[!] Service temporarily unavailable — please try again in a moment.\n'
        : resp.status === 429 ? '\n[!] Your key\'s free quota is used up right now — wait a bit, or add a different free key in Setup.\n'
        : `\n[relay error ${resp.status}] ${t.slice(0, 160)}\n`;
      setStatus('Error', 'var(--red)'); return;
    }
    const reader = resp.body.getReader(), dec = new TextDecoder(); let got = false;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (chunk) {
        if (!got) { stopThinking(); setStatus('Answering…', 'var(--green)'); }  // first token landed
        got = true; out.textContent += chunk; out.scrollTop = out.scrollHeight;
      }
    }
    stopThinking();
    out.textContent += got ? '\n' : '(no answer)\n';
    setStatus('Ready', 'var(--green)');
  } catch (e) {
    stopThinking(); out.textContent += `\n[connection error] ${e}\n`; setStatus('Error', 'var(--red)');
  } finally {
    stopThinking();
    state.answering = false;
    $('#statusDot').classList.remove('working');
    chrome.runtime.sendMessage({ cmd: 'answering', value: false }).catch(() => {});
  }
}

// ---- typed ----
$('#askBtn').addEventListener('click', () => {
  const q = $('#qbox').value.trim(); if (!q) return;
  $('#qbox').value = ''; const o = $('#answer'); o.classList.remove('empty'); o.textContent += `\n🗨 ${q}\n`;
  ask('text', 'The candidate TYPED this and wants an answer now. Always answer directly in the format; '
    + 'never reply "(no question)". If it is a get-to-know question, answer as the candidate would.\nQuestion: ' + q);
});
$('#qbox').addEventListener('keydown', e => { if (e.key === 'Enter') $('#askBtn').click(); });
$('#copyBtn').addEventListener('click', () => navigator.clipboard.writeText($('#answer').textContent.trim()).then(() => setStatus('Copied', 'var(--green)')));
$('#clearBtn').addEventListener('click', () => { const o = $('#answer'); o.textContent = ''; o.classList.add('empty'); });

// ---- audio helpers ----
function downsample(buf, inRate) {
  if (inRate === SR) return buf;
  const ratio = inRate / SR, n = Math.round(buf.length / ratio), out = new Float32Array(n);
  let oi = 0, bi = 0;
  while (oi < n) { const next = Math.round((oi + 1) * ratio); let a = 0, c = 0;
    for (let i = bi; i < next && i < buf.length; i++) { a += buf[i]; c++; }
    out[oi++] = a / (c || 1); bi = next; }
  return out;
}
function encodeWAV(s) {
  const b = new ArrayBuffer(44 + s.length * 2), v = new DataView(b);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + s.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, s.length * 2, true);
  let o = 44; for (let i = 0; i < s.length; i++) { const x = Math.max(-1, Math.min(1, s[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true); o += 2; }
  return new Uint8Array(b);
}
function b64(bytes) { let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function sendAudio(float32, rate) { ask('audio', b64(encodeWAV(downsample(float32, rate)))); }

// ---- recorder (manual one-shot OR VAD auto-segments) ----
class Recorder {
  constructor(stream, opts) { this.stream = stream; this.vad = !!opts.vad; this.passthrough = !!opts.passthrough;
    this.onLevel = opts.onLevel || null; this.onEmit = opts.onEmit || null; this.ctx = null; this.node = null;
    this.chunks = []; this.inSpeech = false; this.silent = 0; this.spoke = 0; this.active = false; }
  start() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.rate = this.ctx.sampleRate; this.active = true;
    this.node.onaudioprocess = e => this._proc(e.inputBuffer.getChannelData(0));
    src.connect(this.node); this.node.connect(this.ctx.destination);
    if (this.passthrough) src.connect(this.ctx.destination); // keep captured tab audible
  }
  _proc(input) {
    if (!this.active) return;
    let s = 0; for (let i = 0; i < input.length; i++) s += input[i] * input[i];
    const rms = Math.sqrt(s / input.length);
    if (this.onLevel) this.onLevel(rms);
    if (!this.vad) { this.chunks.push(new Float32Array(input)); return; }
    if (state.answering) { this._reset(); return; }
    const ms = input.length / this.rate * 1000;
    if (rms > SILENCE_RMS) {
      this.inSpeech = true; this.silent = 0; this.spoke += ms; this.chunks.push(new Float32Array(input));
      if (this._ms() >= MAX_MS) this._emit();
    } else if (this.inSpeech) {
      this.silent += ms; this.chunks.push(new Float32Array(input));
      if (this.silent >= HANG_MS) { if (this.spoke >= MIN_MS) this._emit(); else this._reset(); }
    }
  }
  _ms() { let n = 0; for (const c of this.chunks) n += c.length; return n / this.rate * 1000; }
  _flat() { let n = 0; for (const c of this.chunks) n += c.length; const o = new Float32Array(n); let k = 0;
    for (const c of this.chunks) { o.set(c, k); k += c.length; } return o; }
  _emit() { const f = this._flat(); this._reset(); if (f.length > SR * 0.3) { if (this.onEmit) this.onEmit(); sendAudio(f, this.rate); } }
  _reset() { this.chunks = []; this.inSpeech = false; this.silent = 0; this.spoke = 0; }
  stop() { this.active = false;
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
}

// ---- mic: friendly recording panel ----
let micRec = null, micRate = SR, micTimer = null, micStart = 0;
const fmtTime = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function micUI(on) { $('#recbar').classList.toggle('show', on); $('#micBtn').disabled = on; $('#tabBtn').disabled = on; if (!on) $('#meterFill').style.width = '0'; }
async function startMic() {
  if (micRec) return;
  try {
    setStatus('Allow the mic…', 'var(--accent)');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    micRec = new Recorder(stream, { vad: false, onLevel: rms => $('#meterFill').style.width = Math.min(100, rms * 450) + '%' });
    micRec.start(); micRate = micRec.rate; micStart = Date.now();
    $('#recTime').textContent = '0:00'; micUI(true); setStatus('Recording…', 'var(--red)');
    micTimer = setInterval(() => { const el = Date.now() - micStart; $('#recTime').textContent = fmtTime(el); if (el > 60000) stopMic(true); }, 200);
  } catch (e) {
    micRec = null; micUI(false);
    // A side panel can't show the mic permission prompt, so getUserMedia fails
    // instantly with NotAllowedError. Open a normal extension tab where Chrome
    // CAN prompt; once granted there, the side panel can use the mic.
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      setStatus('Mic blocked', 'var(--red)');
      flash('Microphone permission is needed. A new tab is opening — click “Allow” there, then come back and press “Record my answer” again.');
      try { chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') }); } catch (_) {}
    } else if (e && e.name === 'NotFoundError') {
      setStatus('No mic', 'var(--red)');
      flash('No microphone was found. Connect a mic / headset and try again.');
    } else {
      setStatus('Idle', 'var(--muted)');
      flash('Could not start the mic (' + (e ? e.name : 'error') + '). Check your microphone and try again.');
    }
  }
}
function stopMic(send) {
  if (!micRec) return;
  clearInterval(micTimer); micTimer = null;
  const f = micRec._flat(); micRec.stop(); micRec = null; micUI(false);
  if (!send) { setStatus('Cancelled', 'var(--muted)'); return; }
  if (f.length > SR * 0.4) { setStatus('Thinking…', 'var(--accent)'); sendAudio(f, micRate); }
  else { flash('That was too short — hold while you speak, then Stop & send.'); setStatus('Idle'); }
}
$('#micBtn').addEventListener('click', startMic);
$('#recStop').addEventListener('click', () => stopMic(true));
$('#recCancel').addEventListener('click', () => stopMic(false));

// ---- tab capture ----
// AUTOMATIC (one-click): the background grabs the active tab's audio via an
// OFFSCREEN document (the only context a side panel can use for tab audio) and
// streams level/audio messages back here. If that yields no audio on this Chrome,
// we remember it and fall back to the manual share picker (always works).
// tabCapture can't grab chrome:// / Web Store pages — detect that early.
function isCapturableUrl(url) {
  return !!url && /^https?:|^file:/i.test(url) && !/^https:\/\/chrome\.google\.com\/webstore/i.test(url);
}
function isCancel(e) {
  return e && (e.name === 'NotAllowedError' || /denied|dismiss|cancel|abort/i.test(e.name + ' ' + (e.message || '')));
}

let tabRec = null;            // local Recorder, used only by the picker fallback
let capMode = null;           // null | 'offscreen' | 'local'
let capHeard = 0, capPeak = 0;
let oneClickBroken = false;   // set once one-click proves it delivers no audio here

function liveUI(on) {
  const btn = $('#tabBtn'), hint = $('#captureHint');
  if (on) {
    btn.classList.add('on'); btn.querySelector('span').textContent = '■ Stop capture'; $('#micBtn').disabled = true;
    capHeard = 0; capPeak = 0; $('#liveHeard').textContent = 'heard 0'; $('#liveBar').classList.add('show');
    setStatus('Listening…', 'var(--green)');
    hint.style.display = 'block';
    hint.textContent = 'Live: bar moves = it hears the tab. A question is sent after a pause. Flat bar = the tab is paused/muted or tab-audio wasn’t shared.';
  } else {
    btn.classList.remove('on'); btn.querySelector('span').textContent = 'Capture this tab'; $('#micBtn').disabled = false;
    $('#liveBar').classList.remove('show'); $('#liveMeterFill').style.width = '0'; hint.style.display = 'none';
  }
}
function capLevel(rms) { if (rms > capPeak) capPeak = rms; $('#liveMeterFill').style.width = Math.min(100, rms * 450) + '%'; }

// Reflect a capture that the BACKGROUND started/stopped (the Ctrl+Shift+U shortcut
// path). Drives the panel UI into/out of live mode without the user touching the
// button. Safe to call when already in that state — it no-ops.
function syncCapState(on) {
  if (on && capMode !== 'offscreen') {
    capMode = 'offscreen'; liveUI(true); setStatus('Listening…', 'var(--green)');
    // Watchdog: if no sound arrives, the tab is silent/muted (no fallback possible
    // for a shortcut-started capture — just tell the user).
    setTimeout(() => {
      if (capMode === 'offscreen' && capPeak < 0.003) {
        flash('Capturing this tab, but no audio yet — make sure it’s playing and not muted.');
        setStatus('No tab audio', 'var(--red)');
      }
    }, 4500);
  } else if (!on && capMode === 'offscreen') {
    if (tabRec) { tabRec.stop(); tabRec = null; }
    capMode = null; liveUI(false); setStatus('Stopped', 'var(--muted)');
  }
}

// Audio + level + state messages from the background / offscreen capturer.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.cmd === 'cap-state') { syncCapState(!!msg.on); return; }   // handle regardless of capMode
  if (msg.cmd === 'cap-note') { flash(msg.text || ''); return; }
  if (capMode !== 'offscreen') return;
  if (msg.cmd === 'cap-level') capLevel(msg.rms);
  else if (msg.cmd === 'cap-audio') { $('#liveHeard').textContent = 'heard ' + (++capHeard); ask('audio', msg.payload); }
  else if (msg.cmd === 'cap-error') {
    oneClickBroken = true; stopCapture();
    flash('One-click capture isn’t available here (' + (msg.error || 'error') + '). Click “Capture this tab” again to share manually.');
  }
});

async function startTab() {
  if (capMode) { stopCapture(); setStatus('Stopped', 'var(--muted)'); return; }
  setStatus('Starting capture…', 'var(--accent)');

  // 1) AUTOMATIC one-click via the background/offscreen document
  if (!oneClickBroken) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && isCapturableUrl(tab.url)) {
        const r = await chrome.runtime.sendMessage({ cmd: 'cap-start', tabId: tab.id });
        if (r && r.ok) {
          capMode = 'offscreen'; liveUI(true);
          // If no sound arrives, one-click didn't work on this Chrome → switch to the picker next click.
          setTimeout(() => {
            if (capMode === 'offscreen' && capPeak < 0.003) {
              oneClickBroken = true; stopCapture();
              flash('Couldn’t auto-capture this tab’s audio. Click “Capture this tab” again → pick the CHROME TAB → enable “Also share tab audio”.');
              setStatus('Click to share', 'var(--red)');
            }
          }, 4000);
          return;
        }
        console.warn('[copilot] one-click capture declined:', r && r.error);
        oneClickBroken = true;
      }
    } catch (e) { console.warn('[copilot] one-click capture failed → picker:', e && e.message); oneClickBroken = true; }
  }

  // 2) FALLBACK: manual share picker (reliable everywhere)
  await startTabPicker();
}

async function startTabPicker() {
  let stream;
  try {
    // selfBrowserSurface:'exclude' stops Chrome from offering (and a side panel from
    // auto-grabbing) the extension's OWN page — that bug shared chrome-extension://…
    // with no audio and forced a "Share this tab instead" click. Now the picker lands
    // on real tabs only. (Can't combine with preferCurrentTab — the spec forbids it.)
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true, selfBrowserSurface: 'exclude', systemAudio: 'include',
    });
    // Do NOT stop the video tracks — on some Chrome builds ending them tears down
    // the whole capture and the audio goes silent. We just ignore video.
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(t => t.stop());
      flash('No audio was shared. Click “Capture this tab” → pick the CHROME TAB option (not Window/Screen) → choose this tab → turn ON “Also share tab audio”.');
      setStatus('No audio', 'var(--red)'); return;
    }
  } catch (e) {
    if (isCancel(e)) { flash('Capture cancelled. Click “Capture this tab” → CHROME TAB → this tab → enable “Also share tab audio”.'); setStatus('Cancelled', 'var(--muted)'); }
    else { flash('Could not capture this tab. Open the call in a normal browser tab (Meet/Zoom-web/Teams-web — not a chrome:// page), then try again.'); setStatus('Error', 'var(--red)'); }
    return;
  }
  let peak = 0;
  tabRec = new Recorder(stream, { vad: true, passthrough: false,
    onLevel: rms => { if (rms > peak) peak = rms; capLevel(rms); },
    onEmit: () => { $('#liveHeard').textContent = 'heard ' + (++capHeard); } });
  stream.getAudioTracks()[0].addEventListener('ended', () => { if (capMode === 'local') { stopCapture(); setStatus('Stopped', 'var(--muted)'); } });
  tabRec.start(); capMode = 'local'; liveUI(true);
  setTimeout(() => {
    if (capMode === 'local' && peak < 0.003) {
      flash('No tab audio is coming through. Re-share and make sure “Also share tab audio” is ON and the tab is playing/unmuted.');
      setStatus('No tab audio', 'var(--red)');
    }
  }, 3500);
}

function stopCapture() {
  if (capMode === 'offscreen') chrome.runtime.sendMessage({ cmd: 'cap-stop' }).catch(() => {});
  if (tabRec) { tabRec.stop(); tabRec = null; }
  capMode = null; liveUI(false);
}
$('#tabBtn').addEventListener('click', startTab);

loadSettings();

// The shortcut may have started capture in the background BEFORE this panel opened.
// Ask for the current state and sync the UI if a capture is already live.
chrome.runtime.sendMessage({ cmd: 'cap-query' }, (r) => {
  if (chrome.runtime.lastError) return;     // background asleep / no reply — ignore
  if (r && r.on) syncCapState(true);
});
