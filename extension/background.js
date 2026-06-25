importScripts("utils/storage.js", "utils/exporter.js");

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
    });
  }
});
