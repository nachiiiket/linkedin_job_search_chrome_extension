let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener(m => {
    if (m.action === "state") updateUI(m.state, m.stats);
    if (m.action === "started") setStatus("scraping");
    if (m.action === "stopped") setStatus("idle");
    if (m.action === "composeProgress") handleComposeProgress(m);
  });
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 1000); });
}

function updateUI(state, stats) {
  document.getElementById("statusText").textContent = state.status === "scraping" ? "Scraping..." : "Idle";
  document.getElementById("statusText").className = state.status === "scraping" ? "status-scraping" : "status-idle";
  document.getElementById("statTotal").textContent = (stats || {}).total || 0;
  document.getElementById("statEmail").textContent = (stats || {}).withEmail || 0;
  document.getElementById("statComposed").textContent = (stats || {}).composed || 0;
  document.getElementById("btnStart").style.display = state.status === "scraping" ? "none" : "block";
  document.getElementById("btnStop").style.display = state.status === "scraping" ? "block" : "none";
  document.getElementById("searchMode").disabled = state.status === "scraping";
  if (state.mode === "posts") document.getElementById("searchMode").value = "posts";
  else if (state.mode === "both") document.getElementById("searchMode").value = "both";
  else document.getElementById("searchMode").value = "jobs";
}

function setStatus(s) {
  document.getElementById("statusText").textContent = s === "scraping" ? "Scraping..." : "Idle";
  document.getElementById("statusText").className = s === "scraping" ? "status-scraping" : "status-idle";
  document.getElementById("btnStart").style.display = s === "scraping" ? "none" : "block";
  document.getElementById("btnStop").style.display = s === "scraping" ? "block" : "none";
  document.getElementById("searchMode").disabled = s === "scraping";
}

function setComposeUI(active) {
  document.getElementById("btnComposePopup").style.display = active ? "none" : "flex";
  document.getElementById("btnAbortComposePopup").style.display = active ? "flex" : "none";
}

function addLogEntry(containerId, msg) {
  const log = document.getElementById(containerId);
  if (!log) return;
  const entry = document.createElement("div");
  entry.className = "log-entry";
  if (msg.type === "info" || msg.type === "start" || msg.type === "wait" || msg.type === "skip") entry.classList.add("log-info");
  else if (msg.type === "progress" || msg.type === "active") entry.classList.add("log-active");
  else if (msg.type === "warn" || msg.type === "abort") entry.classList.add("log-warn");
  else if (msg.type === "done" || msg.type === "success") entry.classList.add("log-success");
  entry.textContent = msg.text || msg.message || '';
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function handleComposeProgress(msg) {
  addLogEntry("composeLog", msg);
  if (msg.type === "abort") {
    setComposeUI(false);
    Storage.setComposeState(false);
  }
  if (msg.type === "start") {
    setComposeUI(true);
  }
  if (msg.type === "done") {
    Storage.getStats().then(st => document.getElementById("statComposed").textContent = st.composed || 0);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  connect();
  const state = await Storage.getState();
  const stats = await Storage.getStats();
  updateUI(state, stats);

  const composeActive = await Storage.getComposeState();
  setComposeUI(composeActive);

  const prefs = await Storage.getPreferences();
  document.getElementById("onlyWithEmail").checked = prefs.onlyWithEmail === true;
  document.getElementById("jobsFirstPageOnly").checked = prefs.jobsFirstPageOnly !== false;
  document.getElementById("searchMode").value = prefs.searchMode || "jobs";
  document.getElementById("scrapeSpeed").value = prefs.scrapeSpeed || "normal";
  document.getElementById("popupCompanies").value = (prefs.targetCompanies || []).join(", ");
  document.getElementById("popupPostDateFilter").value = prefs.postDateFilter || "";
  document.getElementById("popupSpeed").value = prefs.composeSpeed != null ? prefs.composeSpeed : 1000;
  document.getElementById("popupExcludedDomains").value = (prefs.excludedEmailDomains || []).join(", ");
  document.getElementById("popupAutoSend").checked = prefs.autoSendEnabled === true;
  document.getElementById("popupAutoSendMode").value = prefs.autoSendMode || "realtime";
  document.getElementById("popupBatchSize").value = prefs.batchSize || 10;
  if (prefs.autoSendEnabled) document.getElementById("popupAutoSendOptions").style.display = "flex";

  const r = await Storage.getResume();
  document.getElementById("popupResumeStatus").textContent = r ? "Resume: " + r.name : "Resume: none";

  document.getElementById("popupAutoSend").addEventListener("change", () => {
    document.getElementById("popupAutoSendOptions").style.display = document.getElementById("popupAutoSend").checked ? "flex" : "none";
  });

  document.getElementById("btnStart").addEventListener("click", async () => {
    prefs.searchMode = document.getElementById("searchMode").value;
    prefs.onlyWithEmail = document.getElementById("onlyWithEmail").checked;
    prefs.jobsFirstPageOnly = document.getElementById("jobsFirstPageOnly").checked;
    prefs.scrapeSpeed = document.getElementById("scrapeSpeed").value;
    prefs.targetCompanies = document.getElementById("popupCompanies").value.split(",").map(s => s.trim()).filter(Boolean);
    prefs.postDateFilter = document.getElementById("popupPostDateFilter").value;
    prefs.scrapeSpeed = document.getElementById("scrapeSpeed").value;
    await Storage.savePreferences(prefs);
    await Storage.setState({ stopRequested: false });
    document.getElementById("scrapeLog").innerHTML = '';
    if (port) port.postMessage({ action: "startScraping", config: prefs });
  });
  document.getElementById("btnStop").addEventListener("click", () => {
    if (port) port.postMessage({ action: "stopScraping" });
  });
  document.getElementById("btnDashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: "dashboard.html" });
  });

  document.getElementById("btnComposePopup").addEventListener("click", async () => {
    const prefs2 = await Storage.getPreferences();
    prefs2.composeSpeed = parseInt(document.getElementById("popupSpeed").value) || 0;
    prefs2.excludedEmailDomains = document.getElementById("popupExcludedDomains").value.split(",").map(s => s.trim()).filter(Boolean);
    prefs2.autoSendEnabled = document.getElementById("popupAutoSend").checked;
    prefs2.autoSendMode = document.getElementById("popupAutoSendMode").value;
    prefs2.batchSize = parseInt(document.getElementById("popupBatchSize").value) || 10;
    await Storage.savePreferences(prefs2);
    setComposeUI(true);
    document.getElementById("composeLog").innerHTML = '';
    if (port) port.postMessage({ action: "enableComposeMode" });
  });

  document.getElementById("btnAbortComposePopup").addEventListener("click", () => {
    if (port) port.postMessage({ action: "disableComposeMode" });
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "statsUpdate") {
    document.getElementById("statTotal").textContent = msg.stats.total;
    document.getElementById("statEmail").textContent = msg.stats.withEmail;
    document.getElementById("statComposed").textContent = msg.stats.composed;
    chrome.action.setBadgeText({ text: String(msg.stats.total) });
  }
  if (msg.action === "scrapingComplete") setStatus("idle");
  if (msg.action === "log") {
    addLogEntry("scrapeLog", { type: "info", text: msg.text });
  }
  if (msg.action === "composeLog") {
    addLogEntry("composeLog", msg);
  }
});
