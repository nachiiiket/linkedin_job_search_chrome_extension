importScripts("utils/storage.js", "utils/exporter.js");

let composeAbort = false;

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

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
}

async function composeInGmail(jobs, port) {
  composeAbort = false;
  const prefs = await Storage.getPreferences();
  const emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");

  if (emailJobs.length === 0) {
    port.postMessage({ action: 'composeProgress', type: 'done', message: 'No new jobs with email to compose.' });
    return;
  }

  let completed = 0;
  const total = emailJobs.length;
  port.postMessage({ action: 'composeProgress', type: 'start', total, message: `Starting compose for ${total} job(s)...` });

  for (const job of emailJobs) {
    if (composeAbort) {
      port.postMessage({ action: 'composeProgress', type: 'abort', completed, total, message: 'Compose aborted by user.' });
      return;
    }

    const to = job.email.split('\n')[0].trim();
    const vars = {
      name: job.poster_name || 'there',
      position: job.position || 'the position',
      company: job.company || 'your company',
      your_name: prefs.yourName || 'there',
    };

    const subject = fillTemplate(prefs.emailSubject || "Excited about the {position} opportunity at {company}", vars);
    const body = fillTemplate(prefs.emailBody || "Hi {name},\n\nI'm interested in {position} at {company}.\n\nBest,\n{your_name}", vars);

    const composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    port.postMessage({ action: 'composeProgress', type: 'progress', completed, total, current: job.poster_name || to, subject });

    const tab = await chrome.tabs.create({ url: composeUrl, active: true });

    await new Promise(resolve => {
      const listener = (tabId) => {
        if (tabId === tab.id) {
          chrome.tabs.onRemoved.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onRemoved.addListener(listener);
    });

    await Storage.markComposed(job.job_id);
    completed++;

    if (completed < total) {
      const delay = 5000 + Math.random() * 10000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  port.postMessage({ action: 'composeProgress', type: 'done', completed, total, message: `Composed ${completed} email(s) in Gmail.` });
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
      if (msg.action === "composeInGmail") { composeInGmail(msg.jobs, port); }
      if (msg.action === "abortCompose") { composeAbort = true; }
    });
  }
});
