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

function handleComposeProgress(msg) {
  const log = document.getElementById("composeLogPopup");
  const entry = document.createElement("div");
  entry.className = "log-entry";
  if (msg.type === "start") {
    entry.classList.add("log-info");
    entry.textContent = msg.message;
    log.appendChild(entry);
  } else if (msg.type === "progress") {
    entry.classList.add("log-active");
    entry.textContent = `[${msg.completed + 1}/${msg.total}] ${msg.current}`;
    log.appendChild(entry);
  } else {
    document.getElementById("btnComposePopup").style.display = "flex";
    document.getElementById("btnAbortComposePopup").style.display = "none";
    entry.classList.add(msg.type === "done" ? "log-success" : "log-warn");
    entry.textContent = msg.message;
    log.appendChild(entry);
    Storage.getStats().then(st => document.getElementById("statComposed").textContent = st.composed || 0);
  }
  log.scrollTop = log.scrollHeight;
}

document.addEventListener("DOMContentLoaded", async () => {
  connect();
  const state = await Storage.getState();
  const stats = await Storage.getStats();
  updateUI(state, stats);

  const prefs = await Storage.getPreferences();
  document.getElementById("onlyWithEmail").checked = prefs.onlyWithEmail === true;
  document.getElementById("jobsFirstPageOnly").checked = prefs.jobsFirstPageOnly !== false;
  document.getElementById("searchMode").value = prefs.searchMode || "jobs";
  document.getElementById("popupCompanies").value = (prefs.targetCompanies || []).join(", ");
  document.getElementById("popupSpeed").value = prefs.composeSpeed || 150;

  document.getElementById("btnStart").addEventListener("click", async () => {
    prefs.searchMode = document.getElementById("searchMode").value;
    prefs.onlyWithEmail = document.getElementById("onlyWithEmail").checked;
    prefs.jobsFirstPageOnly = document.getElementById("jobsFirstPageOnly").checked;
    prefs.targetCompanies = document.getElementById("popupCompanies").value.split(",").map(s => s.trim()).filter(Boolean);
    await Storage.savePreferences(prefs);
    await Storage.setState({ stopRequested: false });
    if (port) port.postMessage({ action: "startScraping", config: prefs });
  });
  document.getElementById("btnStop").addEventListener("click", () => {
    if (port) port.postMessage({ action: "stopScraping" });
  });
  document.getElementById("btnDashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: "dashboard.html" });
  });

  document.getElementById("btnDummyEmails").addEventListener("click", async () => {
    const email = document.getElementById("popupDummyEmail").value.trim() || "test@example.com";
    const jobs = await Storage.getJobs();
    for (const j of jobs) j.email = email;
    await chrome.storage.local.set({ jobs });
    const st = await Storage.getStats();
    document.getElementById("statEmail").textContent = st.withEmail;
  });

  document.getElementById("btnComposePopup").addEventListener("click", async () => {
    const prefs2 = await Storage.getPreferences();
    prefs2.composeSpeed = parseInt(document.getElementById("popupSpeed").value) || 150;
    await Storage.savePreferences(prefs2);
    const jobs = await Storage.getJobs();
    const emailJobs = jobs.filter(j => j.email && j.email.trim() && j.composed !== "Yes");
    if (emailJobs.length === 0) {
      document.getElementById("composeLogPopup").innerHTML = '<div class="log-entry log-info">No new jobs with email to compose.</div>';
      return;
    }
    document.getElementById("btnComposePopup").style.display = "none";
    document.getElementById("btnAbortComposePopup").style.display = "flex";
    document.getElementById("composeLogPopup").innerHTML = '';
    if (port) port.postMessage({ action: "composeInGmail", jobs });
  });

  document.getElementById("popupResumeFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await Storage.saveResume({ name: file.name, type: file.type, data: reader.result });
      document.getElementById("btnPopupClearResume").style.display = "inline-block";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btnPopupClearResume").addEventListener("click", async () => {
    await Storage.clearResume();
    document.getElementById("popupResumeFile").value = "";
    document.getElementById("btnPopupClearResume").style.display = "none";
  });

  (async () => {
    const r = await Storage.getResume();
    if (r) document.getElementById("btnPopupClearResume").style.display = "inline-block";
  })();

  document.getElementById("btnAbortComposePopup").addEventListener("click", () => {
    if (port) port.postMessage({ action: "abortCompose" });
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
    const el = document.getElementById("logList");
    const d = document.createElement("div"); d.className = "log-entry"; d.textContent = msg.text;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
  }
});
