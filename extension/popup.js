let port = null;

function connect() {
  port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener(m => {
    if (m.action === "state") updateUI(m.state, m.stats);
    if (m.action === "started") setStatus("searching");
    if (m.action === "stopped") setStatus("idle");
    if (m.action === "composeProgress") handleComposeProgress(m);
  });
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 1000); });
}

function updateUI(state, stats) {
  document.getElementById("statusText").textContent = state.status === "searching" ? "Searching..." : "Idle";
  document.getElementById("statusText").className = state.status === "searching" ? "status-searching" : "status-idle";
  document.getElementById("statTotal").textContent = (stats || {}).total || 0;
  document.getElementById("statEmail").textContent = (stats || {}).withEmail || 0;
  document.getElementById("statComposed").textContent = (stats || {}).composed || 0;
  document.getElementById("btnStart").style.display = state.status === "searching" ? "none" : "block";
  document.getElementById("btnStop").style.display = state.status === "searching" ? "block" : "none";
  document.getElementById("searchMode").disabled = state.status === "searching";
  setSearchControls(state.status === "searching");
  const pauseBtn = document.getElementById("btnPause");
  pauseBtn.textContent = "Pause";
  pauseBtn.classList.remove("btn-primary");
  if (state.mode === "posts") document.getElementById("searchMode").value = "posts";
  else if (state.mode === "both") document.getElementById("searchMode").value = "both";
  else document.getElementById("searchMode").value = "jobs";
}

function handleSearchProgress(p) {
  const row = document.getElementById("searchProgressRow");
  const bar = document.getElementById("searchProgressBar");
  const text = document.getElementById("searchProgressText");
  if (!row || !bar) return;
  const total = p.total || 0;
  row.style.display = total > 0 ? "flex" : "none";
  const pct = total > 0 ? Math.round((p.completed / total) * 100) : 0;
  bar.style.width = pct + "%";
  text.textContent = p.completed + "/" + total;
}

function setSearchControls(searching) {
  const d = searching ? "block" : "none";
  document.getElementById("btnSkip").style.display = d;
  document.getElementById("btnPause").style.display = d;
}

function handleSearchControl(type) {
  const btn = document.getElementById("btnPause");
  if (type === "paused") {
    btn.textContent = "Resume";
    btn.classList.add("btn-primary");
    addLogEntry("searchLog", { type: "warn", text: "Searching paused" });
  } else if (type === "resumed") {
    btn.textContent = "Pause";
    btn.classList.remove("btn-primary");
    addLogEntry("searchLog", { type: "info", text: "Searching resumed" });
  } else if (type === "skipped") {
    addLogEntry("searchLog", { type: "warn", text: "Skip requested - moving to next query" });
  }
}

function setStatus(s) {
  document.getElementById("statusText").textContent = s === "searching" ? "Searching..." : "Idle";
  document.getElementById("statusText").className = s === "searching" ? "status-searching" : "status-idle";
  document.getElementById("btnStart").style.display = s === "searching" ? "none" : "block";
  document.getElementById("btnStop").style.display = s === "searching" ? "block" : "none";
  document.getElementById("searchMode").disabled = s === "searching";
  setSearchControls(s === "searching");
  if (s !== "searching") {
    const btn = document.getElementById("btnPause");
    btn.textContent = "Pause";
    btn.classList.remove("btn-primary");
  }
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
  document.getElementById("searchSpeed").value = prefs.searchSpeed || "normal";
  document.getElementById("popupCompanies").value = (prefs.targetCompanies || []).join(", ");
  document.getElementById("popupPostDateFilter").value = prefs.postDateFilter || "";
  document.getElementById("popupSpeed").value = prefs.composeSpeed != null ? prefs.composeSpeed : 1000;
  document.getElementById("popupExcludedDomains").value = (prefs.excludedEmailDomains || []).join(", ");
  document.getElementById("popupAutoSend").checked = prefs.autoSendEnabled === true;
  document.getElementById("popupAutoSendMode").value = prefs.autoSendMode || "realtime";
  document.getElementById("popupBatchSize").value = prefs.batchSize || 10;
  if (prefs.autoSendEnabled) document.getElementById("popupAutoSendOptions").style.display = "flex";
  document.getElementById("popupInPagePanel").checked = prefs.showInPagePanel === true;
  document.getElementById("popupDebugLogs").checked = prefs.showDebugLogs === true;

  const r = await Storage.getResume();
  document.getElementById("popupResumeStatus").textContent = r ? "Resume: " + r.name : "Resume: none";

  document.getElementById("popupAutoSend").addEventListener("change", () => {
    document.getElementById("popupAutoSendOptions").style.display = document.getElementById("popupAutoSend").checked ? "flex" : "none";
  });

  ["popupInPagePanel", "popupDebugLogs"].forEach(id => {
    document.getElementById(id).addEventListener("change", async () => {
      const p = await Storage.getPreferences();
      p.showInPagePanel = document.getElementById("popupInPagePanel").checked;
      p.showDebugLogs = document.getElementById("popupDebugLogs").checked;
      await Storage.savePreferences(p);
    });
  });

  document.getElementById("btnStart").addEventListener("click", async () => {
    prefs.searchMode = document.getElementById("searchMode").value;
    prefs.onlyWithEmail = document.getElementById("onlyWithEmail").checked;
    prefs.jobsFirstPageOnly = document.getElementById("jobsFirstPageOnly").checked;
    prefs.searchSpeed = document.getElementById("searchSpeed").value;
    prefs.targetCompanies = document.getElementById("popupCompanies").value.split(",").map(s => s.trim()).filter(Boolean);
    prefs.postDateFilter = document.getElementById("popupPostDateFilter").value;
    prefs.searchSpeed = document.getElementById("searchSpeed").value;
    await Storage.savePreferences(prefs);
    await Storage.setState({ stopRequested: false });
    document.getElementById("searchLog").innerHTML = '';
    handleSearchProgress({ completed: 0, total: 0 });
    if (port) port.postMessage({ action: "startSearching", config: prefs });
  });
  document.getElementById("btnStop").addEventListener("click", () => {
    if (port) port.postMessage({ action: "stopSearching" });
  });
  document.getElementById("btnSkip").addEventListener("click", () => {
    if (port) port.postMessage({ action: "skipQuery" });
  });
  document.getElementById("btnPause").addEventListener("click", () => {
    const paused = document.getElementById("btnPause").textContent === "Resume";
    if (port) port.postMessage({ action: paused ? "resumeSearching" : "pauseSearching" });
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
  if (msg.action === "searchingComplete") { setStatus("idle"); handleSearchProgress({ completed: 0, total: 0 }); }
  if (msg.action === "progress") handleSearchProgress(msg);
  if (msg.action === "searchControl") handleSearchControl(msg.type);
  if (msg.action === "log") {
    addLogEntry("searchLog", { type: "info", text: msg.text });
  }
  if (msg.action === "composeLog") {
    addLogEntry("composeLog", msg);
  }
});
