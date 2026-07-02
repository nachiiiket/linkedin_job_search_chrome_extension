importScripts("utils/storage.js", "utils/exporter.js");

let emailSendingStop = false;

let activeTabId = null;

async function getLinkedInTab() {
  const tabs = await chrome.tabs.query({ url: "https://*.linkedin.com/*" });
  if (tabs.length) return tabs[0];
  const all = await chrome.tabs.query({});
  return all.find(t => t.url && t.url.includes("linkedin.com")) || null;
}

async function isContentScriptReady(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { action: "ping" }); return !!(r && r.ok); } catch { return false; }
}

function notify(title, msg) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon48.png", title, message: msg });
}

async function updateBadge() {
  const stats = await Storage.getStats();
  chrome.action.setBadgeText({ text: String(stats.total || "") });
  chrome.action.setBadgeBackgroundColor({ color: "#0a66c2" });
  chrome.runtime.sendMessage({ action: "statsUpdate", stats }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "jobFound") {
    updateBadge();
    return false;
  }
  if (msg.action === "scrapingComplete") {
    notify("Scraping Complete", "All searches finished.");
    Storage.setState({ status: "idle", mode: "jobs", totalFound: 0 });
    chrome.runtime.sendMessage({ action: "scrapingComplete" }).catch(() => {});
    updateBadge();
    return false;
  }
});

chrome.action.onClicked.addListener(() => { chrome.runtime.openOptionsPage(); });

async function startScraping(config) {
  const tab = await getLinkedInTab();
  if (!tab) { notify("LinkedIn Required", "Open a LinkedIn tab first."); return; }
  activeTabId = tab.id;

  const ready = await isContentScriptReady(tab.id);
  if (!ready) { notify("Reload LinkedIn", "Please refresh the LinkedIn page for the extension to load."); return; }

  await Storage.setState({ status: "scraping", mode: config.searchMode || "jobs", totalFound: 0 });
  const modeLabel = config.searchMode === "posts" ? "posts" : "jobs";
  notify("Scraping Started", "Searching " + (config.jobRoles || []).length + " roles in " + modeLabel);

  chrome.tabs.sendMessage(tab.id, { action: "startScraping", config }).catch(() => {});
}

async function stopScraping() {
  if (activeTabId) { chrome.tabs.sendMessage(activeTabId, { action: "stopScraping" }).catch(() => {}); }
  await Storage.setState({ status: "idle", mode: "jobs", totalFound: 0, stopRequested: false });
  notify("Scraping Stopped", "The scraper was stopped.");
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name === "popup") {
    port.onMessage.addListener(async msg => {
      if (msg.action === "startScraping") { await startScraping(msg.config); port.postMessage({ action: "started" }); }
      if (msg.action === "stopScraping") { await stopScraping(); port.postMessage({ action: "stopped" }); }
      if (msg.action === "getState") { const s = await Storage.getState(); const st = await Storage.getStats(); port.postMessage({ action: "state", state: s, stats: st }); }
    });
  }

  if (port.name === "dashboard") {
    port.onMessage.addListener(async msg => {
      if (msg.action === "startScraping") { await startScraping(msg.config); }
      if (msg.action === "stopScraping") { await stopScraping(); }
      if (msg.action === "getState") { const s = await Storage.getState(); const st = await Storage.getStats(); port.postMessage({ action: "state", state: s, stats: st }); }
      if (msg.action === "getJobs") { const j = await Storage.getJobs(); port.postMessage({ action: "jobs", jobs: j }); }
      if (msg.action === "exportCSV") { Exporter.downloadCSV(await Storage.getJobs()); }
      if (msg.action === "exportXLS") { Exporter.downloadXLS(await Storage.getJobs()); }
      if (msg.action === "clearJobs") { await Storage.clearJobs(); port.postMessage({ action: "cleared" }); updateBadge(); }
      if (msg.action === "getPreferences") { port.postMessage({ action: "preferences", prefs: await Storage.getPreferences() }); }
      if (msg.action === "savePreferences") { await Storage.savePreferences(msg.prefs); port.postMessage({ action: "preferencesSaved" }); }
      if (msg.action === "startEmailSending") { emailSendingStop = false; sendEmailsGmail(port); }
      if (msg.action === "stopEmailSending") { emailSendingStop = true; }
    });
  }
});

function b64UrlSafe(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMime(from, to, subject, body, resumeData) {
  const boundary = "boundary_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  const lines = [
    "From: " + from,
    "To: " + to,
    "Subject: =?UTF-8?B?" + btoa(unescape(encodeURIComponent(subject))) + "?=",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"",
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(body))),
    ""
  ];
  if (resumeData) {
    lines.push("--" + boundary);
    lines.push("Content-Type: application/pdf");
    lines.push("Content-Disposition: attachment; filename=\"" + resumeData.name + "\"");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(resumeData.data);
    lines.push("");
  }
  lines.push("--" + boundary + "--");
  return b64UrlSafe(lines.join("\r\n"));
}

async function sendViaGmailApi(accessToken, raw) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ raw })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Gmail API error " + r.status + ": " + err.slice(0, 200));
  }
}

function fillTemplate(text, recipient, yourName) {
  return text
    .replace(/{name}/g, recipient.poster_name || "")
    .replace(/{position}/g, recipient.position || "")
    .replace(/{company}/g, recipient.company || "")
    .replace(/{your_name}/g, yourName);
}

async function sendEmailsGmail(port) {
  try {
    const prefs = await Storage.getEmailPrefs();
    const resumeData = await Storage.getResumeData();
    const recipients = await Storage.getRecipientsToSend();
    const total = recipients.length;
    let sent = 0, failed = 0;

    port.postMessage({ action: "emailLog", text: "Requesting Gmail authorization..." });
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    port.postMessage({ action: "emailLog", text: "Authorization granted. Starting sends..." });

    for (let i = 0; i < total; i++) {
      if (emailSendingStop) {
        port.postMessage({ action: "emailLog", text: "Stopped by user." });
        port.postMessage({ action: "emailComplete", sent, failed, total });
        return;
      }

      const r = recipients[i];
      await Storage.markEmailSending(r.job_id);
      port.postMessage({ action: "emailProgress", sent, failed, current: i + 1, total, status: "Sending to " + r.email });

      const subject = fillTemplate(prefs.emailSubject, r, prefs.yourName);
      const body = fillTemplate(prefs.emailBody, r, prefs.yourName);
      const raw = buildMime(prefs.senderEmail, r.email, subject, body, resumeData);

      port.postMessage({ action: "emailLog", text: "[" + (i + 1) + "/" + total + "] Sending to " + r.email + " - " + subject });

      try {
        await sendViaGmailApi(authResult.token, raw);
        await Storage.markEmailSent(r.job_id);
        sent++;
        port.postMessage({ action: "emailLog", text: "  -> Sent" });
      } catch (e) {
        if (e.message.includes("401") || e.message.includes("403")) {
          port.postMessage({ action: "emailLog", text: "  -> Token expired, re-authenticating..." });
          await chrome.identity.removeCachedAuthToken({ token: authResult.token });
          const newAuth = await chrome.identity.getAuthToken({ interactive: true });
          try {
            await sendViaGmailApi(newAuth.token, raw);
            await Storage.markEmailSent(r.job_id);
            sent++;
            port.postMessage({ action: "emailLog", text: "  -> Sent" });
          } catch (e2) {
            await Storage.markEmailFailed(r.job_id);
            failed++;
            port.postMessage({ action: "emailLog", text: "  -> FAILED: " + e2.message });
          }
        } else {
          await Storage.markEmailFailed(r.job_id);
          failed++;
          port.postMessage({ action: "emailLog", text: "  -> FAILED: " + e.message });
        }
      }

      if (i < total - 1) {
        const delay = prefs.randomDelayMin + Math.floor(Math.random() * (prefs.randomDelayMax - prefs.randomDelayMin + 1));
        port.postMessage({ action: "emailLog", text: "  -> Waiting " + delay + "s..." });
        port.postMessage({ action: "emailProgress", sent, failed, current: i + 1, total, status: "Waiting " + delay + "s..." });
        await new Promise(r => setTimeout(r, delay * 1000));
      }
    }

    port.postMessage({ action: "emailLog", text: "Campaign complete." });
    port.postMessage({ action: "emailComplete", sent, failed, total });
    notify("Email Campaign Complete", "Sent: " + sent + ", Failed: " + failed + ", Total: " + total);
  } catch (e) {
    port.postMessage({ action: "emailLog", text: "ERROR: " + e.message });
    port.postMessage({ action: "emailComplete", sent: 0, failed: 1, total: 1 });
  }
}
