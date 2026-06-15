'use strict';
// Offscreen capturer. Receives a tabCapture streamId from the background, opens
// the tab-audio stream with getUserMedia, replays it (so the user still hears the
// call), runs the same energy-VAD as the mic path, and posts each detected
// speech segment back to the side panel as a base64 WAV. Levels stream back too.

// Keep these in lockstep with sidepanel.js. HANG_MS = silence before a segment is
// sent; lowered for snappier turn-around in live capture.
const SR = 16000, SILENCE_RMS = 0.012, HANG_MS = 700, MIN_MS = 800, MAX_MS = 30000;

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
function sendSegment(float32, rate) {
  chrome.runtime.sendMessage({ cmd: 'cap-audio', payload: b64(encodeWAV(downsample(float32, rate))) });
}

class Recorder {
  constructor(stream, opts) {
    this.stream = stream; this.onLevel = opts.onLevel || null;
    this.ctx = null; this.node = null;
    this.chunks = []; this.inSpeech = false; this.silent = 0; this.spoke = 0; this.active = false;
  }
  start() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.rate = this.ctx.sampleRate; this.active = true;
    this.node.onaudioprocess = e => this._proc(e.inputBuffer.getChannelData(0));
    src.connect(this.node); this.node.connect(this.ctx.destination);
    src.connect(this.ctx.destination); // tabCapture mutes the tab → replay so the user still hears it
  }
  _proc(input) {
    if (!this.active) return;
    let s = 0; for (let i = 0; i < input.length; i++) s += input[i] * input[i];
    const rms = Math.sqrt(s / input.length);
    if (this.onLevel) this.onLevel(rms);
    if (state.answering) { this._reset(); return; }   // pause while an answer streams
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
  _emit() { const f = this._flat(); this._reset(); if (f.length > SR * 0.3) sendSegment(f, this.rate); }
  _reset() { this.chunks = []; this.inSpeech = false; this.silent = 0; this.spoke = 0; }
  stop() { this.active = false;
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
}

// `state.answering` mirrors the side panel so VAD pauses while an answer streams.
const state = { answering: false };
let rec = null;

async function startCapture(streamId) {
  stopCapture();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false,
    });
    rec = new Recorder(stream, { onLevel: rms => chrome.runtime.sendMessage({ cmd: 'cap-level', rms }) });
    rec.start();
  } catch (e) {
    chrome.runtime.sendMessage({ cmd: 'cap-error', error: (e && e.name) || String(e) });
  }
}
function stopCapture() { if (rec) { rec.stop(); rec = null; } }

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.cmd === 'offscreen-start') startCapture(msg.streamId);
  else if (msg.cmd === 'offscreen-stop') stopCapture();
  else if (msg.cmd === 'answering') state.answering = !!msg.value;  // pause/resume VAD
});
