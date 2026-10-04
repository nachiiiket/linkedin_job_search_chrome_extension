importScripts("utils/storage.js", "utils/exporter.js", "utils/parser.js");

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

async function sendSingleJob(job, prefs, tabId, forceSend) {
  const to = job.email.split('\n')[0].trim();
  const subject = prefs.emailSubject || '';
  const body = prefs.emailBody || '';
  const speed = prefs.composeSpeed != null ? Number(prefs.composeSpeed) : 1000;
  const autoSend = forceSend === true || prefs.autoSendEnabled === true;
  const minDelay = Number(prefs.sendMinDelay) || 1000;
  const maxDelay = Number(prefs.sendMaxDelay) || 3000;
  broadcastComposeLog({ type: 'progress', message: `Sending to ${to}...` });
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'fillGmailCompose', data: { to, subject, body, speed, autoSend } });
    await Storage.markComposed(job.job_id);
    await Storage.addSentEmail(to);
    broadcastComposeLog({ type: 'success', message: `Sent to ${to}` });
  } catch (e) {
    broadcastComposeLog({ type: 'warn', message: `Failed to send to ${to}` });
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
  const sentEmails = await Storage.getSentEmails();
  const tabId = await getOrWaitGmailTab();
  if (!tabId) { _isComposing = false; return; }
  while (_composeQueue.length > 0) {
    if (composeAbort) { _composeQueue = []; break; }
    const job = _composeQueue.shift();
    if (isDomainExcluded(job, excluded)) continue;
    const to = (job.email || '').split('\n')[0].trim().toLowerCase();
    if (sentEmails.includes(to)) continue;
    const ok = await sendSingleJob(job, prefs, tabId, job._manual === true);
    if (ok) {
      sentEmails.push(to);
      if (job._manual) {
        await Storage.markManualEmailSent(job.job_id, new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));
        chrome.runtime.sendMessage({ action: "manualEmailsUpdated" }).catch(() => {});
      }
    }
    if (!ok) break;
  }
  _isComposing = false;
  if (_composeQueue.length > 0) processQueue();
}

async function processBatch() {
  if (_pendingBatch.length === 0) return;
  const jobs = _pendingBatch.splice(0);
  const prefs = await Storage.getPreferences();
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  const sentEmails = await Storage.getSentEmails();
  const tabId = await getOrWaitGmailTab();
  if (!tabId) return;
  for (const job of jobs) {
    if (composeAbort) break;
    if (isDomainExcluded(job, excluded)) continue;
    const to = (job.email || '').split('\n')[0].trim().toLowerCase();
    if (sentEmails.includes(to)) continue;
    const ok = await sendSingleJob(job, prefs, tabId, job._manual === true);
    if (ok) sentEmails.push(to);
    if (!ok) break;
  }
}

async function handleAutoSendJob(job) {
  if (!job || !job.email) return;
  const prefs = await Storage.getPreferences();
  const composeActive = await Storage.getComposeState();
  if (prefs.autoSendEnabled !== true && !composeActive) return;
  if (prefs.autoSendMode === "realtime" || composeActive) {
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

function broadcastComposeLog(msg) {
  chrome.runtime.sendMessage({ action: "composeLog", ...msg }).catch(() => {});
}

async function composeInGmail(jobs, port) {
  composeAbort = false;
  const prefs = await Storage.getPreferences();
  let emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  const sentEmails = await Storage.getSentEmails();
  const filtered = [];
  for (const j of emailJobs) {
    if (isDomainExcluded(j, excluded)) {
      const m = `Skipped ${j.email} (excluded domain)`;
      safePost(port, { action: 'composeProgress', type: 'skip', message: m });
      broadcastComposeLog({ type: 'skip', message: m });
    } else {
      const to = (j.email || '').split('\n')[0].trim().toLowerCase();
      if (sentEmails.includes(to)) {
        const m = `Skipped ${to} (already sent)`;
        safePost(port, { action: 'composeProgress', type: 'skip', message: m });
        broadcastComposeLog({ type: 'skip', message: m });
      } else {
        filtered.push(j);
      }
    }
  }
  emailJobs = filtered;

  if (emailJobs.length === 0) {
    const m = 'No pending jobs with email to compose.';
    safePost(port, { action: 'composeProgress', type: 'info', message: m });
    broadcastComposeLog({ type: 'info', message: m });
    const active = await Storage.getComposeState();
    if (active) {
      const w = 'Compose mode active — waiting for new jobs...';
      safePost(port, { action: 'composeProgress', type: 'info', message: w });
      broadcastComposeLog({ type: 'info', message: w });
    }
    return;
  }

  let gmailTab = await getGmailTab();
  let tabId = gmailTab && await isContentScriptReady(gmailTab.id) ? gmailTab.id : null;

  if (!tabId) {
    const w = 'Open Gmail in a tab to start composing...';
    safePost(port, { action: 'composeProgress', type: 'wait', message: w });
    broadcastComposeLog({ type: 'wait', message: w });
    notify("Gmail Required", "Open Gmail in a tab for the extension to compose emails.");
    tabId = await getOrWaitGmailTab();
    if (!tabId) {
      const m = 'Timed out waiting for Gmail tab.';
      safePost(port, { action: 'composeProgress', type: 'warn', message: m });
      broadcastComposeLog({ type: 'warn', message: m });
      await Storage.setComposeState(false);
      return;
    }
  }

  let completed = 0;
  const total = emailJobs.length;
  const speed = prefs.composeSpeed != null ? Number(prefs.composeSpeed) : 1000;
  const autoSend = prefs.autoSendEnabled === true;
  const minDelay = Number(prefs.sendMinDelay) || 1000;
  const maxDelay = Number(prefs.sendMaxDelay) || 3000;
  const m = `Starting compose for ${total} job(s)...`;
  safePost(port, { action: 'composeProgress', type: 'start', total, message: m });
  broadcastComposeLog({ type: 'start', total, message: m });

  for (const job of emailJobs) {
    if (composeAbort) {
      await Storage.setComposeState(false);
      const m2 = 'Compose aborted by user.';
      safePost(port, { action: 'composeProgress', type: 'abort', completed, total, message: m2 });
      broadcastComposeLog({ type: 'abort', completed, total, message: m2 });
      return;
    }

    const to = job.email.split('\n')[0].trim();
    const subject = prefs.emailSubject || '';
    const body = prefs.emailBody || '';

    const pm = `Sending to ${to}...`;
    safePost(port, { action: 'composeProgress', type: 'progress', completed, total, current: to, subject });
    broadcastComposeLog({ type: 'progress', completed, total, current: to, subject, message: pm });

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'fillGmailCompose', data: { to, subject, body, speed, autoSend } });
    } catch (e) {
      await Storage.setComposeState(false);
      const m2 = 'Gmail tab lost. Stopping compose.';
      safePost(port, { action: 'composeProgress', type: 'warn', message: m2 });
      broadcastComposeLog({ type: 'warn', message: m2 });
      break;
    }

    await Storage.markComposed(job.job_id);
    await Storage.addSentEmail(to);
    completed++;

    const dm = `Sent to ${to}`;
    broadcastComposeLog({ type: 'success', message: dm });

    if (completed < total && minDelay > 0 && maxDelay > 0) {
      const waitMs = rand(minDelay, maxDelay);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  const dm = `Composed ${completed} email(s) in Gmail. Compose mode still active — waiting for new jobs...`;
  safePost(port, { action: 'composeProgress', type: 'done', completed, total, message: dm });
  broadcastComposeLog({ type: 'done', completed, total, message: dm });
  notify("Compose Complete", `Created ${completed} Gmail compose(s).`);
}

function notify(title, msg) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon_new.png", title, message: msg });
}

/***** RIGHT-CLICK MANUAL EMAIL COMPOSE *****/

const CONTEXT_MENU_ID = "compose-selected-email";

function manualJobId(email, url) {
  let hash = 0;
  const src = url + "|" + email;
  for (let i = 0; i < src.length; i++) { hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0; }
  return "manual_" + Math.abs(hash);
}

// Record the human's manual right-click send in its own store (NOT the jobs table,
// whose dedupe would drop empty-poster records). Holds email + post link + recruiter
// context and gets flagged "sent" once the Gmail compose actually goes through.
async function saveManualRecord(email, postUrl, poster) {
  const emailLower = email.toLowerCase().trim();
  const id = manualJobId(emailLower, postUrl);
  const entry = {
    id,
    email: emailLower,
    postUrl,
    poster_name: poster.poster_name || "",
    poster_title: poster.poster_title || "",
    poster_profile_url: poster.poster_profile_url || "",
    position: poster.position || "",
    company: poster.company || "",
    status: "queued",
    createdAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  };
  await Storage.saveManualEmail(entry);
  chrome.runtime.sendMessage({ action: "manualEmailsUpdated" }).catch(() => {});
  return id;
}

async function createContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Compose and send",
    contexts: ["selection", "link"],
    documentUrlPatterns: ["https://*.linkedin.com/*", "http://*.linkedin.com/*"]
  }, () => { if (chrome.runtime.lastError) console.error("context menu:", chrome.runtime.lastError.message); });
}

chrome.runtime.onInstalled.addListener(() => createContextMenus());
chrome.runtime.onStartup.addListener(() => createContextMenus());

async function extractEmailFromContext(info) {
  if (info.linkUrl && /^mailto:/i.test(info.linkUrl)) {
    const m = info.linkUrl.match(/^mailto:([^?]+)/i);
    if (m && m[1].trim() && /@/.test(m[1])) return m[1].trim();
    return null;
  }
  const sel = (info.selectionText || "").trim();
  if (!sel) return null;
  const found = LinkedinParser.regexExtract(sel);
  if (found.emails && found.emails.length) return found.emails[0];
  return "NO_EMAIL_IN_SELECTION";
}

async function composeManualEmail(email, tab) {
  const prefs = await Storage.getPreferences();
  const excluded = (prefs.excludedEmailDomains || []).map(d => d.toLowerCase());
  const to = email.toLowerCase().trim();

  if (isDomainExcluded({ email: to }, excluded)) {
    const m = "Blocked " + to + " - domain is on the excluded list";
    broadcastComposeLog({ type: "skip", message: m });
    notify("Email Blocked", m);
    return;
  }
  const sentEmails = await Storage.getSentEmails();
  if (sentEmails.includes(to)) {
    const m = "Blocked " + to + " - already emailed";
    broadcastComposeLog({ type: "skip", message: m });
    notify("Email Blocked", m);
    return;
  }

  let postUrl = (tab && tab.url) ? tab.url.split("?")[0] : "https://www.linkedin.com/";
  const poster = { poster_name: "", poster_title: "", poster_profile_url: "", position: "", company: "" };
  if (tab && tab.id) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "getContextMenuInfo" });
      const c = res && res.context ? res.context : {};
      if (c.url) postUrl = c.url;
      poster.poster_name = c.poster_name || "";
      poster.poster_title = c.poster_title || "";
      poster.poster_profile_url = c.poster_profile_url || "";
      poster.position = c.position || "";
      poster.company = c.company || "";
    } catch (e) { /* content script not ready - fall back to tab url only */ }
  }

  const manualId = await saveManualRecord(to, postUrl, poster);
  const manualJob = {
    job_id: manualId, email: to, job_url: postUrl, _manual: true
  };
  _composeQueue.push(manualJob);

  // send now if Gmail is open and ready, otherwise keep it queued and flush when Gmail loads.
  // processQueue() blocks on getOrWaitGmailTab (up to 2min), so only call it when Gmail is ready.
  const gmail = await getGmailTab();
  const readyNow = !!(gmail && (await isContentScriptReady(gmail.id)));
  if (readyNow) processQueue();
  broadcastComposeLog({ type: "progress", message: "Manual email to " + to + (readyNow ? " composing..." : " queued until Gmail opens.") });
  notify(readyNow ? "Sending Email" : "Email Queued",
    readyNow ? "Composing to " + to : "Will send to " + to + " as soon as Gmail is open");
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const email = await extractEmailFromContext(info);
  if (!email) return;
  if (email === "NO_EMAIL_IN_SELECTION") {
    notify("No Email Found", "The selected text does not contain an email address.");
    return;
  }
  composeManualEmail(email, tab).catch(e => console.error("manual compose:", e));
});

// flush queued manual composes the moment a Gmail tab finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab && tab.url && tab.url.includes("mail.google.com")) {
    processQueue();
  }
});

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
  await chrome.storage.local.set({ scrapePaused: false });
  await Storage.setState({ status: "idle", mode: "jobs", totalFound: 0, stopRequested: false });
  notify("Scraping Stopped", "The scraper was stopped.");
}

function broadcastScrapeControl(type) {
  chrome.runtime.sendMessage({ action: "scrapeControl", type }).catch(() => {});
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name === "popup") {
    port.onMessage.addListener(async msg => {
      if (msg.action === "startScraping") { await startScraping(msg.config); port.postMessage({ action: "started" }); }
      if (msg.action === "stopScraping") { await stopScraping(); port.postMessage({ action: "stopped" }); }
      if (msg.action === "skipQuery") { if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "skipQuery" }).catch(() => {}); broadcastScrapeControl("skipped"); }
      if (msg.action === "pauseScraping") { await chrome.storage.local.set({ scrapePaused: true }); if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "pauseScraping" }).catch(() => {}); broadcastScrapeControl("paused"); }
      if (msg.action === "resumeScraping") { await chrome.storage.local.set({ scrapePaused: false }); if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "resumeScraping" }).catch(() => {}); broadcastScrapeControl("resumed"); }
      if (msg.action === "getState") { const s = await Storage.getState(); const st = await Storage.getStats(); port.postMessage({ action: "state", state: s, stats: st }); }
      if (msg.action === "enableComposeMode") {
        composeAbort = false;
        await Storage.setComposeState(true);
        const jobs = await Storage.getJobs();
        const emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");
        if (emailJobs.length > 0) {
          composeInGmail(emailJobs, port);
        } else {
          const m = 'Compose mode active — waiting for new jobs...';
          safePost(port, { action: 'composeProgress', type: 'info', message: m });
          broadcastComposeLog({ type: 'info', message: m });
        }
      }
      if (msg.action === "disableComposeMode") { composeAbort = true; await Storage.setComposeState(false); port.postMessage({ action: 'composeProgress', type: 'info', message: 'Compose mode stopped.' }); }
      if (msg.action === "composeInGmail") { composeInGmail(msg.jobs, port); }
      if (msg.action === "abortCompose") { composeAbort = true; }
    });
  }

  if (port.name === "dashboard") {
    port.onMessage.addListener(async msg => {
      if (msg.action === "startScraping") { await startScraping(msg.config); }
      if (msg.action === "stopScraping") { await stopScraping(); }
      if (msg.action === "skipQuery") { if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "skipQuery" }).catch(() => {}); broadcastScrapeControl("skipped"); }
      if (msg.action === "pauseScraping") { await chrome.storage.local.set({ scrapePaused: true }); if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "pauseScraping" }).catch(() => {}); broadcastScrapeControl("paused"); }
      if (msg.action === "resumeScraping") { await chrome.storage.local.set({ scrapePaused: false }); if (activeTabId) chrome.tabs.sendMessage(activeTabId, { action: "resumeScraping" }).catch(() => {}); broadcastScrapeControl("resumed"); }
      if (msg.action === "getState") { const s = await Storage.getState(); const st = await Storage.getStats(); port.postMessage({ action: "state", state: s, stats: st }); }
      if (msg.action === "getJobs") { const j = await Storage.getJobs(); port.postMessage({ action: "jobs", jobs: j }); }
      if (msg.action === "exportCSV") { Exporter.downloadCSV(await Storage.getJobs()); }
      if (msg.action === "exportXLS") { Exporter.downloadXLS(await Storage.getJobs()); }
      if (msg.action === "clearJobs") { await Storage.clearJobs(); port.postMessage({ action: "cleared" }); updateBadge(); }
      if (msg.action === "getPreferences") { port.postMessage({ action: "preferences", prefs: await Storage.getPreferences() }); }
      if (msg.action === "savePreferences") { await Storage.savePreferences(msg.prefs); port.postMessage({ action: "preferencesSaved" }); }
      if (msg.action === "enableComposeMode") {
        composeAbort = false;
        await Storage.setComposeState(true);
        const jobs = await Storage.getJobs();
        const emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");
        if (emailJobs.length > 0) {
          composeInGmail(emailJobs, port);
        } else {
          broadcastComposeLog({ type: 'info', message: 'Compose mode active — waiting for new jobs...' });
        }
      }
      if (msg.action === "disableComposeMode") { composeAbort = true; await Storage.setComposeState(false); }
      if (msg.action === "composeInGmail") { composeInGmail(msg.jobs, port); }
      if (msg.action === "abortCompose") { composeAbort = true; }
    });
  }
});
