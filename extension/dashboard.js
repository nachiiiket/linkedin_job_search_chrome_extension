let port = null, allJobs = [], currentFilter = "all";
function connect() { port = chrome.runtime.connect({ name: "dashboard" }); port.onMessage.addListener(handle); }

function handle(msg) {
  if (msg.action === "state") updateState(msg.state, msg.stats);
  if (msg.action === "jobs") { allJobs = msg.jobs; renderJobs(allJobs); }
  if (msg.action === "preferences") populateForm(msg.prefs);
  if (msg.action === "preferencesSaved") { 
    document.getElementById("saveStatus").textContent = "Saved!"; 
    setTimeout(() => document.getElementById("saveStatus").textContent = "", 2000);
    document.getElementById("emailSaveStatus").textContent = "Saved!"; 
    setTimeout(() => document.getElementById("emailSaveStatus").textContent = "", 2000);
    if (port) port.postMessage({ action: "getPreferences" });
  }
  if (msg.action === "cleared") { allJobs = []; renderJobs([]); updateState({ status: "idle" }, { total: 0, applied: 0, connected: 0 }); }
  if (msg.action === "composeProgress") handleComposeProgress(msg);
}

function updateState(state, stats) {
  const s = state.status === "scraping";
  document.getElementById("btnStart").style.display = s ? "none" : "inline-block";
  document.getElementById("btnStop").style.display = s ? "inline-block" : "none";
  document.getElementById("dashSearchMode").disabled = s;
  if (state.mode === "posts") document.getElementById("dashSearchMode").value = "posts";
  else if (state.mode === "both") document.getElementById("dashSearchMode").value = "both";
  else document.getElementById("dashSearchMode").value = "jobs";
  if (stats) {
    document.getElementById("dashTotal").textContent = stats.total;
    document.getElementById("dashWithEmail").textContent = stats.withEmail || 0;
    document.getElementById("dashApplied").textContent = stats.applied;
    document.getElementById("dashConnected").textContent = stats.connected;
    document.getElementById("dashComposed").textContent = stats.composed || 0;
    chrome.action.setBadgeText({ text: String(stats.total) });
  }
}

function populateForm(p) {
  document.getElementById("jobRoles").value = (p.jobRoles || []).join("\n");
  document.getElementById("locations").value = (p.locations || []).join("\n");
  document.getElementById("targetCompanies").value = (p.targetCompanies || []).join("\n");
  document.getElementById("easyApplyOnly").checked = p.easyApplyOnly !== false;
  document.getElementById("jobsFirstPageOnly").checked = p.jobsFirstPageOnly !== false;
  document.getElementById("onlyWithEmail").checked = p.onlyWithEmail === true;
  document.getElementById("postedWithinDays").value = p.postedWithinDays || 1;
  document.getElementById("maxJobsPerRun").value = p.maxJobsPerRun || 50;
  document.getElementById("scrapeSpeed").value = p.scrapeSpeed || "normal";
  document.getElementById("postDateFilter").value = p.postDateFilter || "";
  // fix: restore searchMode from saved prefs
  document.getElementById("dashSearchMode").value = p.searchMode || "jobs";
  document.getElementById("emailSubject").value = p.emailSubject || "";
  document.getElementById("emailBody").value = p.emailBody || "";
  document.getElementById("composeSpeed").value = p.composeSpeed != null ? p.composeSpeed : 1000;
  document.getElementById("excludedEmailDomains").value = (p.excludedEmailDomains || []).join(", ");
  document.getElementById("autoSendEnabled").checked = p.autoSendEnabled === true;
  document.getElementById("autoSendMode").value = p.autoSendMode || "realtime";
  document.getElementById("batchSize").value = p.batchSize || 10;
  document.getElementById("sendMinDelay").value = p.sendMinDelay || 1000;
  document.getElementById("sendMaxDelay").value = p.sendMaxDelay || 3000;
  document.getElementById("autoSendOptions").style.display = p.autoSendEnabled ? "block" : "none";
  document.getElementById("batchSizeLabel").style.display = p.autoSendMode === "batch" ? "" : "none";
  document.getElementById("batchSize").style.display = p.autoSendMode === "batch" ? "" : "none";
}

function getPrefs() {
  return {
    jobRoles: document.getElementById("jobRoles").value.split("\n").map(s => s.trim()).filter(Boolean),
    locations: document.getElementById("locations").value.split("\n").map(s => s.trim()).filter(Boolean),
    targetCompanies: document.getElementById("targetCompanies").value.split("\n").map(s => s.trim()).filter(Boolean),
    easyApplyOnly: document.getElementById("easyApplyOnly").checked,
    jobsFirstPageOnly: document.getElementById("jobsFirstPageOnly").checked,
    onlyWithEmail: document.getElementById("onlyWithEmail").checked,
    postedWithinDays: parseInt(document.getElementById("postedWithinDays").value) || 1,
    maxJobsPerRun: parseInt(document.getElementById("maxJobsPerRun").value) || 50,
    scrapeSpeed: document.getElementById("scrapeSpeed").value,
    postDateFilter: document.getElementById("postDateFilter").value,
    targetPosterTitles: [], excludedKeywords: [],
    searchMode: document.getElementById("dashSearchMode").value,
    emailSubject: document.getElementById("emailSubject").value,
    emailBody: document.getElementById("emailBody").value,
    composeSpeed: parseInt(document.getElementById("composeSpeed").value) || 0,
    excludedEmailDomains: document.getElementById("excludedEmailDomains").value.split(",").map(s => s.trim()).filter(Boolean),
    autoSendEnabled: document.getElementById("autoSendEnabled").checked,
    autoSendMode: document.getElementById("autoSendMode").value,
    batchSize: parseInt(document.getElementById("batchSize").value) || 10,
    sendMinDelay: parseInt(document.getElementById("sendMinDelay").value) || 1000,
    sendMaxDelay: parseInt(document.getElementById("sendMaxDelay").value) || 3000,
  };
}

function renderJobs(jobs) {
  const tb = document.getElementById("jobsBody"); const em = document.getElementById("emptyMsg"); tb.innerHTML = "";
  const filtered = currentFilter === "withEmail" ? jobs.filter(j => j.email) : currentFilter === "withoutEmail" ? jobs.filter(j => !j.email) : jobs;
  if (!filtered.length) { em.style.display = "block"; return; }
  em.style.display = "none";
  filtered.slice().reverse().forEach(j => {
    const tr = document.createElement("tr");
    const cells = [
      j.position, j.company, j.location,
      j.poster_name ? j.poster_name + (j.poster_title ? " - " + j.poster_title : "") : "-",
      j.email || "-",
      j.composed === "Yes" ? "✓" : "",
    ];
    cells.forEach((t, i) => {
      const td = document.createElement("td"); td.textContent = t || "-"; td.title = t || "";
      if (i === 4) td.className = "email-cell";
      if (i === 5) { td.className = "composed-cell"; td.textContent = t || ""; }
      tr.appendChild(td);
    });
    const urlTd = document.createElement("td");
    if (j.job_url) { const a = document.createElement("a"); a.href = j.job_url; a.textContent = "Open"; a.target = "_blank"; urlTd.appendChild(a); }
    else urlTd.textContent = "-";
    tr.appendChild(urlTd);
    const profTd = document.createElement("td");
    if (j.poster_profile_url) { const a = document.createElement("a"); a.href = j.poster_profile_url; a.textContent = "Profile"; a.target = "_blank"; profTd.appendChild(a); }
    else profTd.textContent = "-";
    tr.appendChild(profTd);
    const dateTd = document.createElement("td"); dateTd.textContent = j.date_found || "-"; tr.appendChild(dateTd);
    tb.appendChild(tr);
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById(tab).classList.add("active");
  currentFilter = tab === "tabAll" ? "all" : tab === "tabWithEmail" ? "withEmail" : "withoutEmail";
  renderJobs(allJobs);
}

document.addEventListener("DOMContentLoaded", async () => {
  connect();
  const s = await Storage.getState(); const st = await Storage.getStats();
  const jobs = await Storage.getJobs();
  allJobs = jobs;
  updateState(s, st);
  renderJobs(jobs);
  if (port) port.postMessage({ action: "getPreferences" });
  const ca = await Storage.getComposeState();
  if (ca) { document.getElementById("btnComposeInGmail").style.display = "none"; document.getElementById("btnAbortCompose").style.display = "inline-block"; }

  document.getElementById("btnStart").addEventListener("click", () => { const p = getPrefs(); if (port) port.postMessage({ action: "startScraping", config: p }); });
  document.getElementById("btnStop").addEventListener("click", () => { if (port) port.postMessage({ action: "stopScraping" }); });
  document.getElementById("btnSavePrefs").addEventListener("click", () => { const p = getPrefs(); if (port) port.postMessage({ action: "savePreferences", prefs: p }); });
  document.getElementById("btnSaveEmailPrefs").addEventListener("click", () => {
    const p = getPrefs();
    document.getElementById("emailSaveStatus").textContent = "Saving...";
    if (port) port.postMessage({ action: "savePreferences", prefs: p });
  });
  document.getElementById("autoSendEnabled").addEventListener("change", () => {
    document.getElementById("autoSendOptions").style.display = document.getElementById("autoSendEnabled").checked ? "block" : "none";
  });
  document.getElementById("autoSendMode").addEventListener("change", () => {
    const b = document.getElementById("autoSendMode").value === "batch";
    document.getElementById("batchSizeLabel").style.display = b ? "" : "none";
    document.getElementById("batchSize").style.display = b ? "" : "none";
  });
  document.getElementById("btnExportCSV").addEventListener("click", () => { Storage.getJobs().then(j => Exporter.downloadCSV(j)); });
  document.getElementById("btnExportXLS").addEventListener("click", () => { Storage.getJobs().then(j => Exporter.downloadXLS(j)); });
  document.getElementById("btnClear").addEventListener("click", () => { if (confirm("Delete all?")) { if (port) port.postMessage({ action: "clearJobs" }); } });
  document.getElementById("btnCollapseSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("collapsed");
  });
  document.getElementById("btnExpandSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("collapsed");
  });
  document.getElementById("tabAll").addEventListener("click", () => switchTab("tabAll"));
  document.getElementById("tabWithEmail").addEventListener("click", () => switchTab("tabWithEmail"));
  document.getElementById("tabWithoutEmail").addEventListener("click", () => switchTab("tabWithoutEmail"));

  document.getElementById("btnComposeInGmail").addEventListener("click", async () => {
    const prefs = getPrefs();
    if (port) port.postMessage({ action: "savePreferences", prefs });
    document.getElementById("btnComposeInGmail").style.display = "none";
    document.getElementById("btnAbortCompose").style.display = "inline-block";
    document.getElementById("composeLog").innerHTML = '';
    if (port) port.postMessage({ action: "enableComposeMode" });
  });

  document.getElementById("btnAbortCompose").addEventListener("click", () => {
    if (port) port.postMessage({ action: "disableComposeMode" });
    document.getElementById("btnComposeInGmail").style.display = "inline-block";
    document.getElementById("btnAbortCompose").style.display = "none";
  });

  document.getElementById("resumeFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const data = { name: file.name, type: file.type, data: reader.result };
      await Storage.saveResume(data);
      document.getElementById("resumeStatus").textContent = `Attached: ${file.name}`;
      document.getElementById("btnClearResume").style.display = "inline-block";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btnClearResume").addEventListener("click", async () => {
    await Storage.clearResume();
    document.getElementById("resumeFileInput").value = "";
    document.getElementById("resumeStatus").textContent = "";
    document.getElementById("btnClearResume").style.display = "none";
  });

  (async () => {
    const r = await Storage.getResume();
    if (r) {
      document.getElementById("resumeStatus").textContent = `Attached: ${r.name}`;
      document.getElementById("btnClearResume").style.display = "inline-block";
    }
  })();

  document.getElementById("btnAddDummyEmails").addEventListener("click", async () => {
    const email = document.getElementById("dummyEmailInput").value.trim() || "test@example.com";
    const jobs = await Storage.getJobs();
    for (const j of jobs) j.email = email;
    await chrome.storage.local.set({ jobs });
    allJobs = jobs;
    renderJobs(jobs);
    const st = await Storage.getStats();
    document.getElementById("dashWithEmail").textContent = st.withEmail;
    const ds = document.getElementById("dummyStatus");
    ds.textContent = `Set "${email}" on ${jobs.length} job(s)`;
    setTimeout(() => ds.textContent = "", 4000);
  });
});

function handleComposeProgress(msg) {
  const log = document.getElementById("composeLog");
  const entry = document.createElement("div");
  entry.className = "log-entry";

  if (msg.type === "start") {
    entry.classList.add("log-info");
    entry.textContent = msg.message;
    log.appendChild(entry);
  } else if (msg.type === "progress") {
    entry.classList.add("log-active");
    entry.textContent = `[${msg.completed + 1}/${msg.total}] ${msg.current} — ${msg.subject || ''}`;
    log.appendChild(entry);
  } else if (msg.type === "done") {
    entry.classList.add("log-success");
    entry.textContent = msg.message;
    log.appendChild(entry);
    Storage.getJobs().then(j => { allJobs = j; renderJobs(j); });
    Storage.getStats().then(st => {
      document.getElementById("dashComposed").textContent = st.composed || 0;
    });
  } else if (msg.type === "wait") {
    entry.classList.add("log-info");
    entry.textContent = msg.message;
    log.appendChild(entry);
  } else if (msg.type === "skip") {
    entry.classList.add("log-info");
    entry.textContent = msg.message;
    log.appendChild(entry);
  } else if (msg.type === "warn") {
    entry.classList.add("log-warn");
    entry.textContent = msg.message;
    log.appendChild(entry);
  } else if (msg.type === "abort") {
    document.getElementById("btnComposeInGmail").style.display = "inline-block";
    document.getElementById("btnAbortCompose").style.display = "none";
    entry.classList.add("log-warn");
    entry.textContent = msg.message;
    log.appendChild(entry);
  }
  log.scrollTop = log.scrollHeight;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "composeLog") {
    const log = document.getElementById("composeLog");
    if (!log) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    if (msg.type === "info" || msg.type === "start" || msg.type === "wait" || msg.type === "skip") entry.classList.add("log-info");
    else if (msg.type === "progress" || msg.type === "active") entry.classList.add("log-active");
    else if (msg.type === "warn" || msg.type === "abort") entry.classList.add("log-warn");
    else if (msg.type === "done" || msg.type === "success") entry.classList.add("log-success");
    entry.textContent = msg.message || msg.text || '';
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    if (msg.type === "done") {
      Storage.getJobs().then(j => { allJobs = j; renderJobs(j); });
      Storage.getStats().then(st => document.getElementById("dashComposed").textContent = st.composed || 0);
    }
  }
});
