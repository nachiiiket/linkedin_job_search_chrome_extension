(function() {
  'use strict';

  const SELECTORS = {
    toField: 'input[aria-label="To recipients"], input.agP, input[name*="to"]',
    subjectField: 'input[name="subjectbox"], input.aoT, input[aria-label="Subject"]',
    bodyField: 'div[aria-label="Message Body"][role="textbox"], div.Am.editable[aria-label*="Message"], div.editable[role="textbox"]',
    sendBtn: 'div.T-I-atl[role="button"], div[aria-label*="Send"][role="button"]',
    composeBtn: '.aic .z0 div, div[gh="cm"], div[role="button"][act="9"]',
    minimizeBtn: 'div[aria-label*="Minimize"], div[aria-label*="minimize"], .T-I.J-J5-Ji.aGx.aoC, [aria-label*="minimise"]',
  };

  function getComposeDialog() {
    return document.querySelector('div[role="dialog"]') ||
           document.querySelector('.aDl[role="dialog"]');
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitForDialog(maxRetries = 30) {
    for (let i = 0; i < maxRetries; i++) {
      const d = getComposeDialog();
      if (d) return d;
      await wait(300);
    }
    return null;
  }

  function openCompose() {
    const btn = document.querySelector(SELECTORS.composeBtn);
    if (btn) { btn.click(); return true; }
    return false;
  }

  function unmaximizeDialog(dialog) {
    const btn = dialog.querySelector(SELECTORS.minimizeBtn) ||
                document.querySelector(SELECTORS.minimizeBtn);
    if (btn) btn.click();
  }

  async function attachResume(dialog) {
    try {
      const { resumeFile } = await chrome.storage.local.get('resumeFile');
      if (!resumeFile) return;

      const fileInput = dialog.querySelector('input[type="file"]') ||
                        document.querySelector('input[type="file"]');
      if (!fileInput) return;

      const raw = resumeFile.data.includes(',') ? resumeFile.data.split(',')[1] : resumeFile.data;
      const byteStr = atob(raw);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: resumeFile.type || 'application/octet-stream' });

      const file = new File([blob], resumeFile.name, { type: resumeFile.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(fileInput, 'files', { value: dt.files });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }

  async function fillCompose({ to, subject, body, speed }) {
    speed = speed || 150;

    const dialog = getComposeDialog();
    if (!dialog && !openCompose()) return;
    const d = await waitForDialog();
    if (!d) return;

    unmaximizeDialog(d);
    await wait(200);

    const toField = d.querySelector(SELECTORS.toField);
    if (toField && to) {
      toField.value = to;
      toField.dispatchEvent(new Event('input', { bubbles: true }));
      toField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(speed);

    const subjectField = d.querySelector(SELECTORS.subjectField);
    if (subjectField && subject) {
      subjectField.value = subject;
      subjectField.dispatchEvent(new Event('input', { bubbles: true }));
      subjectField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(speed);

    const bodyField = d.querySelector(SELECTORS.bodyField);
    if (bodyField && body) {
      bodyField.focus();
      bodyField.innerHTML = body.replace(/\n/g, '<br>');
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await wait(speed);

    await attachResume(d);
    await wait(speed);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fillGmailCompose') {
      fillCompose(msg.data || {}).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
  });

})();
