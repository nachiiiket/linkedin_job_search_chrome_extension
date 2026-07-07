importScripts("utils/storage.js", "utils/exporter.js");

let composeAbort = false;
let _composeQueue = [];
let _isComposing = false;
let _pendingBatch = [];

let activeTabId = null;

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function getOrWaitGmailTab() {
  let gmailTab = await getGmailTab();
  let tabId = gmailTab && await isContentScriptReady(gmailTab.id) ? gmailTab.id : null;
  if (tabId) return tabId;
  for (let i = 0; i < 60; i++) {
    if (composeAbort) return null;
    await new Promise(r => setTimeout(r, 2000));
    gmailTab = await getGmailTab();
    if (gmailTab && await isContentScriptReady(gmailTab.id)) return gmailTab.id;
  }
  return null;
}

async function sendSingleJob(job, prefs, tabId) {
  const to = job.email.split('\n')[0].trim();
  const subject = prefs.emailSubject || '';
  const body = prefs.emailBody || '';
  const speed = prefs.composeSpeed != null ? Number(prefs.composeSpeed) : 1000;
  const autoSend = prefs.autoSendEnabled === true;
  const minDelay = Number(prefs.sendMinDelay) || 1000;
  const maxDelay = Number(prefs.sendMaxDelay) || 3000;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'fillGmailCompose', data: { to, subject, body, speed, autoSend } });
    await Storage.markComposed(job.job_id);
  } catch (e) {
    return false;
  }
  if (minDelay > 0 && maxDelay > 0) {
    await new Promise(r => setTimeout(r, rand(minDelay, maxDelay)));
  }
  return true;
}

function isDomainExcluded(job, excluded) {
  if (!excluded || !excluded.length) return false;
  const domain = ((job.email || '').toLowerCase().split('@')[1] || '');
  return excluded.some(d => domain.includes(d));
}

async function processQueue() {
  if (_isComposing || _composeQueue.length === 0) return;
  _isComposing = true;
  const prefs = await Storage.getPreferences();
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  const tabId = await getOrWaitGmailTab();
  if (!tabId) { _isComposing = false; return; }
  while (_composeQueue.length > 0) {
    if (composeAbort) { _composeQueue = []; break; }
    const job = _composeQueue.shift();
    if (isDomainExcluded(job, excluded)) continue;
    const ok = await sendSingleJob(job, prefs, tabId);
    if (!ok) break;
  }
  _isComposing = false;
}

async function processBatch() {
  if (_pendingBatch.length === 0) return;
  const jobs = _pendingBatch.splice(0);
  const prefs = await Storage.getPreferences();
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  const tabId = await getOrWaitGmailTab();
  if (!tabId) return;
  for (const job of jobs) {
    if (composeAbort) break;
    if (isDomainExcluded(job, excluded)) continue;
    const ok = await sendSingleJob(job, prefs, tabId);
    if (!ok) break;
  }
}

async function handleAutoSendJob(job) {
  if (!job || !job.email) return;
  const prefs = await Storage.getPreferences();
  if (prefs.autoSendEnabled !== true) return;
  if (prefs.autoSendMode === "realtime") {
    _composeQueue.push(job);
    processQueue();
  } else if (prefs.autoSendMode === "batch") {
    _pendingBatch.push(job);
    const size = Number(prefs.batchSize) || 10;
    if (_pendingBatch.length >= size) processBatch();
  }
}

async function handleAutoSendFlush() {
  const prefs = await Storage.getPreferences();
  if (prefs.autoSendEnabled !== true) return;
  if (prefs.autoSendMode === "batch" && _pendingBatch.length > 0) processBatch();
}

async function getLinkedInTab() {
  const tabs = await chrome.tabs.query({ url: "https://*.linkedin.com/*" });
  if (tabs.length) return tabs[0];
  const all = await chrome.tabs.query({});
  return all.find(t => t.url && t.url.includes("linkedin.com")) || null;
}

async function isContentScriptReady(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { action: "ping" }); return !!(r && r.ok); } catch { return false; }
}

async function getGmailTab() {
  const tabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  if (tabs.length) return tabs[0];
  const all = await chrome.tabs.query({});
  return all.find(t => t.url && t.url.includes("mail.google.com")) || null;
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch (e) { /* port disconnected */ }
}

async function composeInGmail(jobs, port) {
  composeAbort = false;
  const prefs = await Storage.getPreferences();
  let emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  if (excluded.length) {
    const filtered = [];
    for (const j of emailJobs) {
      if (isDomainExcluded(j, excluded)) {
        safePost(port, { action: 'composeProgress', type: 'skip', message: `Skipped ${j.email} (excluded domain)` });
      } else {
        filtered.push(j);
      }
    }
    emailJobs = filtered;
  }

  if (emailJobs.length === 0) {
    safePost(port, { action: 'composeProgress', type: 'done', message: 'No new jobs with email to compose.' });
    return;
  }

  let gmailTab = await getGmailTab();
  let tabId = gmailTab && await isContentScriptReady(gmailTab.id) ? gmailTab.id : null;

  if (!tabId) {
    safePost(port, { action: 'composeProgress', type: 'wait', message: 'Open Gmail in a tab to start composing...' });
    notify("Gmail Required", "Open Gmail in a tab for the extension to compose emails.");
    tabId = await getOrWaitGmailTab();
    if (!tabId) {
      safePost(port, { action: 'composeProgress', type: 'done', message: 'Timed out waiting for Gmail tab.' });
      return;
    }
  }

  let completed = 0;
  const total = emailJobs.length;
  const speed = prefs.composeSpeed != null ? Number(prefs.composeSpeed) : 1000;
  const autoSend = prefs.autoSendEnabled === true;
  const minDelay = Number(prefs.sendMinDelay) || 1000;
  const maxDelay = Number(prefs.sendMaxDelay) || 3000;
  safePost(port, { action: 'composeProgress', type: 'start', total, message: `Starting compose for ${total} job(s)...` });

  for (const job of emailJobs) {
    if (composeAbort) {
      safePost(port, { action: 'composeProgress', type: 'abort', completed, total, message: 'Compose aborted by user.' });
      return;
    }

    const to = job.email.split('\n')[0].trim();
    const subject = prefs.emailSubject || '';
    const body = prefs.emailBody || '';

    safePost(port, { action: 'composeProgress', type: 'progress', completed, total, current: to, subject });

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'fillGmailCompose', data: { to, subject, body, speed, autoSend } });
    } catch (e) {
      safePost(port, { action: 'composeProgress', type: 'warn', message: 'Gmail tab lost. Skipping remaining emails.' });
      break;
    }

    await Storage.markComposed(job.job_id);
    completed++;

    if (completed < total && minDelay > 0 && maxDelay > 0) {
      const waitMs = rand(minDelay, maxDelay);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  safePost(port, { action: 'composeProgress', type: 'done', completed, total, message: `Composed ${completed} email(s) in Gmail.` });
  notify("Compose Complete", `Created ${completed} Gmail compose(s).`);
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
    handleAutoSendJob(msg.job);
    return false;
  }
  if (msg.action === "scrapingComplete") {
    notify("Scraping Complete", "All searches finished.");
    Storage.setState({ status: "idle", mode: "jobs", totalFound: 0 });
    chrome.runtime.sendMessage({ action: "scrapingComplete" }).catch(() => {});
    updateBadge();
    handleAutoSendFlush();
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
      if (msg.action === "composeInGmail") { composeInGmail(msg.jobs, port); }
      if (msg.action === "abortCompose") { composeAbort = true; }
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
      if (msg.action === "composeInGmail") { composeInGmail(msg.jobs, port); }
      if (msg.action === "abortCompose") { composeAbort = true; }
    });
  }
});
