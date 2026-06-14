'use strict';
const msg = document.getElementById('msg');
const retry = document.getElementById('retry');

async function request() {
  msg.textContent = 'Requesting microphone access…';
  retry.style.display = 'none';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());   // we only needed the grant
    msg.innerHTML = '✅ <b>Microphone allowed.</b> Close this tab and press '
      + '“Record my answer” in the Interview Copilot side panel.';
  } catch (e) {
    msg.innerHTML = '❌ <b>' + e.name + '</b>: ' + (e.message || 'permission not granted')
      + '<br>Use the steps below, then press <b>Request again</b>.';
    retry.style.display = 'inline-block';
  }
}

retry.addEventListener('click', request);
request();
