(function() {
  'use strict';

  function waitForDialog(callback, retries = 0) {
    const dialog = document.querySelector('div[role="dialog"]') ||
                   document.querySelector('.aDl[role="dialog"]') ||
                   document.querySelector('.nH.ha');
    if (dialog) return callback(dialog);
    if (retries > 30) return;
    setTimeout(() => waitForDialog(callback, retries + 1), 500);
  }

  function openCompose() {
    const btn = document.querySelector('.aic .z0 div, div[gh="cm"], div[role="button"][act="9"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  function fillCompose({ to, subject, body }) {
    if (!document.querySelector('div[role="dialog"]') && !openCompose()) return;

    waitForDialog((dialog) => {
      const toField = dialog.querySelector('input[type="text"][name*="to"], textarea[name*="to"]');
      if (toField && to) {
        toField.value = to;
        toField.dispatchEvent(new Event('input', { bubbles: true }));
        toField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const subjectField = dialog.querySelector('input[name*="subject"], input[name*="subj"], input.aoT');
      if (subjectField && subject) {
        subjectField.value = subject;
        subjectField.dispatchEvent(new Event('input', { bubbles: true }));
        subjectField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const bodyField = dialog.querySelector('div[aria-label*="Message Body"], div[aria-label*="body"], div.editable, div[role="textbox"]');
      if (bodyField && body) {
        bodyField.focus();
        bodyField.innerHTML = body.replace(/\n/g, '<br>');
        bodyField.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'fillGmailCompose') {
      fillCompose(msg.data);
      sendResponse({ ok: true });
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
    }
  });

})();
