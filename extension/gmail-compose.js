(function() {
  'use strict';

  const SELECTORS = {
    toField: 'input[aria-label="To recipients"], input.agP, input[name*="to"]',
    subjectField: 'input[name="subjectbox"], input.aoT, input[aria-label="Subject"]',
    bodyField: 'div[aria-label="Message Body"][role="textbox"], div.Am.editable[aria-label*="Message"], div.editable[role="textbox"]',
    sendBtn: 'div.T-I-atl[role="button"], div[aria-label*="Send"][role="button"]',
    composeBtn: '.aic .z0 div, div[gh="cm"], div[role="button"][act="9"]',
  };

  function getComposeDialog() {
    return document.querySelector('div[role="dialog"]') ||
           document.querySelector('.aDl[role="dialog"]');
  }

  function waitForDialog(callback, retries = 0) {
    const dialog = getComposeDialog();
    if (dialog) return callback(dialog);
    if (retries > 30) return;
    setTimeout(() => waitForDialog(callback, retries + 1), 500);
  }

  function openCompose() {
    const btn = document.querySelector(SELECTORS.composeBtn);
    if (btn) { btn.click(); return true; }
    return false;
  }

  function fillCompose({ to, subject, body, send }) {
    if (!getComposeDialog() && !openCompose()) return;

    waitForDialog((dialog) => {
      const toField = dialog.querySelector(SELECTORS.toField);
      if (toField && to) {
        toField.value = to;
        toField.dispatchEvent(new Event('input', { bubbles: true }));
        toField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const subjectField = dialog.querySelector(SELECTORS.subjectField);
      if (subjectField && subject) {
        subjectField.value = subject;
        subjectField.dispatchEvent(new Event('input', { bubbles: true }));
        subjectField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const bodyField = dialog.querySelector(SELECTORS.bodyField);
      if (bodyField && body) {
        bodyField.focus();
        bodyField.innerHTML = body.replace(/\n/g, '<br>');
        bodyField.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (send) {
        setTimeout(() => {
          const btn = document.querySelector(SELECTORS.sendBtn);
          if (btn) btn.click();
        }, 500);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fillGmailCompose') {
      fillCompose(msg.data || {});
      sendResponse({ ok: true });
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
  });

})();
