let port = null, allJobs = [], currentFilter = "all", manualEmails = [], _prefsMirror = null;
function connect() {
  if (port) { try { port.disconnect(); } catch (e) {} }
  const p = chrome.runtime.connect({ name: "dashboard" });
  port = p;
  p.onDisconnect.addListener(() => { if (port === p) port = null; });
  p.onMessage.addListener(handle);
}
function send(msg) {
  try {
    if (!port) connect();
    port.postMessage(msg);
  } catch (e) {
    try { connect(); if (port) port.postMessage(msg); } catch (e2) { console.error(e2); }
  }
}

function handle(msg) {
  if (msg.action === "state") updateState(msg.state, msg.stats);
  if (msg.action === "jobs") { allJobs = msg.jobs; renderJobs(allJobs); Analytics.setJobs(); }
  if (msg.action === "preferences") {
    _prefsMirror = msg.prefs;
    populateForm(msg.prefs);
    switchSidebarPane(msg.prefs.searchMode === "posts" ? "Posts" : "Jobs");
  }
  if (msg.action === "preferencesSaved") { 
    ["saveStatus", "postsSaveStatus", "emailSaveStatus", "dmSaveStatus"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = "Saved!"; setTimeout(() => el.textContent = "", 2000); }
    });
    send({ action: "getPreferences" });
  }
  if (msg.action === "cleared") { allJobs = []; renderJobs([]); updateState({ status: "idle" }, { total: 0, applied: 0, connected: 0 }); Analytics.setJobs(); }
  if (msg.action === "composeProgress") handleComposeProgress(msg);
}

function updateState(state, stats) {
  const s = state.status === "searching";
  ["btnStop", "btnSkip", "btnPause"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = s ? "inline-block" : "none";
  });
  // Dashboard start buttons are hidden while a search runs so a second run
  // cannot be started from the same page.
  ["btnStartJobs", "btnStartPosts"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = s; el.style.opacity = s ? "0.6" : ""; }
  });
  if (!s) {
    const btn = document.getElementById("btnPause");
    if (btn) { btn.textContent = "Pause"; btn.classList.remove("btn-primary"); }
  }
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
  document.getElementById("jobsRoles").value = (p.jobRoles || []).join("\n");
  document.getElementById("postsRoles").value = (p.jobRoles || []).join("\n");
  document.getElementById("jobsLocations").value = (p.locations || []).join("\n");
  document.getElementById("postsLocations").value = (p.locations || []).join("\n");
  document.getElementById("postsLocationsEnabled").checked = p.locationsEnabled !== false;
  document.getElementById("postsCompaniesEnabled").checked = p.targetCompaniesEnabled !== false;
  document.getElementById("postsCompanies").value = (p.targetCompanies || []).join("\n");
  document.getElementById("jobsEasyApply").checked = p.easyApplyOnly !== false;
  document.getElementById("jobsFirstPage").checked = p.jobsFirstPageOnly !== false;
  document.getElementById("jobsPostedWithin").value = p.postedWithinDays || 1;
  document.getElementById("jobsMaxPerRun").value = p.maxJobsPerRun || 50;
  document.getElementById("jobsSpeed").value = p.searchSpeed || "normal";
  document.getElementById("postsSpeed").value = p.searchSpeed || "normal";
  document.getElementById("jobsOnlyEmail").checked = p.onlyWithEmail === true;
  document.getElementById("postsOnlyEmail").checked = p.onlyWithEmail === true;
  document.getElementById("postsDateFilter").value = p.postDateFilter || "";
  document.getElementById("emailSubject").value = p.emailSubject || "";
  document.getElementById("emailBody").value = p.emailBody || "";
  document.getElementById("connectionNote").value = p.connectionNote || "";
  document.getElementById("connectionNoteCount").textContent = String((p.connectionNote || "").length);
  document.getElementById("linkedinDm").value = p.linkedinDm || "";
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

function getPrefs(section) {
  section = section || "jobs";
  const jobs = section === "jobs" || section === "all";
  const p = {
    jobRoles: document.getElementById(jobs ? "jobsRoles" : "postsRoles").value.split("\n").map(s => s.trim()).filter(Boolean),
    locations: document.getElementById(jobs ? "jobsLocations" : "postsLocations").value.split("\n").map(s => s.trim()).filter(Boolean),
    locationsEnabled: document.getElementById("postsLocationsEnabled").checked,
    targetCompanies: document.getElementById("postsCompanies").value.split("\n").map(s => s.trim()).filter(Boolean),
    targetCompaniesEnabled: document.getElementById("postsCompaniesEnabled").checked,
    easyApplyOnly: document.getElementById("jobsEasyApply").checked,
    jobsFirstPageOnly: document.getElementById("jobsFirstPage").checked,
    onlyWithEmail: document.getElementById(jobs ? "jobsOnlyEmail" : "postsOnlyEmail").checked,
    postedWithinDays: parseInt(document.getElementById("jobsPostedWithin").value) || 1,
    maxJobsPerRun: parseInt(document.getElementById("jobsMaxPerRun").value) || 50,
    searchSpeed: document.getElementById(jobs ? "jobsSpeed" : "postsSpeed").value,
    postDateFilter: document.getElementById("postsDateFilter").value,
    targetPosterTitles: [], excludedKeywords: [],
    searchMode: jobs ? "jobs" : "posts",
    emailSubject: document.getElementById("emailSubject").value,
    emailBody: document.getElementById("emailBody").value,
    connectionNote: (document.getElementById("connectionNote").value || "").slice(0, 200),
    linkedinDm: document.getElementById("linkedinDm").value || "",
    composeSpeed: parseInt(document.getElementById("composeSpeed").value) || 0,
    excludedEmailDomains: document.getElementById("excludedEmailDomains").value.split(",").map(s => s.trim()).filter(Boolean),
    autoSendEnabled: document.getElementById("autoSendEnabled").checked,
    autoSendMode: document.getElementById("autoSendMode").value,
    batchSize: parseInt(document.getElementById("batchSize").value) || 10,
    sendMinDelay: parseInt(document.getElementById("sendMinDelay").value) || 1000,
    sendMaxDelay: parseInt(document.getElementById("sendMaxDelay").value) || 3000,
    showInPagePanel: _prefsMirror ? _prefsMirror.showInPagePanel === true : false,
    showDebugLogs: _prefsMirror ? _prefsMirror.showDebugLogs === true : false,
  };
  return p;
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

function switchSidebarPane(pane) {
  ["Jobs", "Posts", "Email"].forEach(n => {
    const p = document.getElementById("pane" + n), t = document.getElementById("sbtab" + n);
    if (p) p.style.display = n === pane ? "block" : "none";
    if (t) t.classList.toggle("active", n === pane);
  });
}

function switchTab(tab) {
  document.querySelectorAll("#resultsTabs .tab").forEach(t => t.classList.remove("active"));
  document.getElementById(tab).classList.add("active");
  currentFilter = tab === "tabAll" ? "all" : tab === "tabWithEmail" ? "withEmail" : tab === "tabWithoutEmail" ? "withoutEmail" : "manual";
  const isManual = currentFilter === "manual";
  document.getElementById("jobsTableWrap").style.display = isManual ? "none" : "block";
  document.getElementById("emptyMsg").style.display = isManual ? "none" : "block";
  const ms = document.getElementById("manualSection");
  if (ms) ms.style.display = isManual ? "block" : "none";
  renderJobs(allJobs);
  renderManualEmails();
}

function renderManualEmails() {
  const tb = document.getElementById("manualBody");
  const em = document.getElementById("manualEmptyMsg");
  if (!tb) return;
  tb.innerHTML = "";
  if (!manualEmails.length) { em.style.display = "block"; return; }
  em.style.display = "none";
  manualEmails.slice().reverse().forEach(m => {
    const tr = document.createElement("tr");

    const emailTd = document.createElement("td"); emailTd.className = "email-cell"; emailTd.textContent = m.email || "-"; tr.appendChild(emailTd);

    const recTd = document.createElement("td");
    recTd.textContent = m.poster_name ? m.poster_name + (m.poster_title ? " - " + m.poster_title : "") : "-";
    tr.appendChild(recTd);

    const coTd = document.createElement("td");
    const coParts = [m.company, m.position].filter(Boolean).join(" - ");
    coTd.textContent = coParts || "-";
    tr.appendChild(coTd);

    const urlTd = document.createElement("td");
    if (m.postUrl) { const a = document.createElement("a"); a.href = m.postUrl; a.textContent = "Open Post"; a.target = "_blank"; urlTd.appendChild(a); }
    else urlTd.textContent = "-";
    tr.appendChild(urlTd);

    const tTd = document.createElement("td"); tTd.textContent = (m.status === "sent" ? m.sentAt : m.createdAt) || "-"; tr.appendChild(tTd);

    const sTd = document.createElement("td"); sTd.textContent = m.status === "sent" ? "Sent" : "Queued";
    if (m.status === "sent") sTd.className = "composed-cell";
    tr.appendChild(sTd);

    tb.appendChild(tr);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  connect();
  const s = await Storage.getState(); const st = await Storage.getStats();
  const jobs = await Storage.getJobs();
  allJobs = jobs;
  updateState(s, st);
  renderJobs(jobs);
  manualEmails = await Storage.getManualEmails();
  renderManualEmails();
  try { await Storage.migrateFoundAt(); } catch (e) {}
  Analytics.init();
  send({ action: "getPreferences" });
  const ca = await Storage.getComposeState();
  if (ca) { document.getElementById("btnComposeInGmail").style.display = "none"; document.getElementById("btnAbortCompose").style.display = "inline-block"; }

  document.getElementById("btnStartJobs").addEventListener("click", () => {
    const p = getPrefs("jobs");
    handleSearchProgress({ completed: 0, total: 0 });
    send({ action: "savePreferences", prefs: p });
    send({ action: "startSearching", config: p });
  });
  document.getElementById("btnStartPosts").addEventListener("click", () => {
    const p = getPrefs("posts");
    handleSearchProgress({ completed: 0, total: 0 });
    send({ action: "savePreferences", prefs: p });
    send({ action: "startSearching", config: p });
  });
  document.getElementById("btnStop").addEventListener("click", () => { send({ action: "stopSearching" }); });
  document.getElementById("btnSkip").addEventListener("click", () => { send({ action: "skipQuery" }); });
  document.getElementById("btnPause").addEventListener("click", () => {
    const paused = document.getElementById("btnPause").textContent === "Resume";
    send({ action: paused ? "resumeSearching" : "pauseSearching" });
  });
  document.getElementById("btnSavePrefs").addEventListener("click", () => { send({ action: "savePreferences", prefs: getPrefs("jobs") }); });
  document.getElementById("btnSavePosts").addEventListener("click", () => {
    document.getElementById("postsSaveStatus").textContent = "Saving...";
    send({ action: "savePreferences", prefs: getPrefs("posts") });
  });
  document.getElementById("btnSaveEmailPrefs").addEventListener("click", () => {
    document.getElementById("emailSaveStatus").textContent = "Saving...";
    send({ action: "savePreferences", prefs: getPrefs("all") });
  });
  document.getElementById("btnSaveDmTemplates").addEventListener("click", () => {
    document.getElementById("dmSaveStatus").textContent = "Saving...";
    send({ action: "savePreferences", prefs: getPrefs("all") });
  });
  const noteInput = document.getElementById("connectionNote");
  noteInput.addEventListener("input", () => {
    noteInput.value = noteInput.value.slice(0, 200);
    document.getElementById("connectionNoteCount").textContent = String(noteInput.value.length);
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
  document.getElementById("btnClear").addEventListener("click", () => { if (confirm("Delete all?")) { send({ action: "clearJobs" }); } });
  document.getElementById("btnCollapseSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("collapsed");
  });
  document.getElementById("btnExpandSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("collapsed");
  });
  document.getElementById("tabAll").addEventListener("click", () => switchTab("tabAll"));
  document.getElementById("tabWithEmail").addEventListener("click", () => switchTab("tabWithEmail"));
  document.getElementById("tabWithoutEmail").addEventListener("click", () => switchTab("tabWithoutEmail"));
  document.getElementById("tabManual").addEventListener("click", () => switchTab("tabManual"));

  document.getElementById("sbtabJobs").addEventListener("click", () => switchSidebarPane("Jobs"));
  document.getElementById("sbtabPosts").addEventListener("click", () => switchSidebarPane("Posts"));
  document.getElementById("sbtabEmail").addEventListener("click", () => switchSidebarPane("Email"));

  document.getElementById("btnComposeInGmail").addEventListener("click", async () => {
    send({ action: "savePreferences", prefs: getPrefs("all") });
    document.getElementById("btnComposeInGmail").style.display = "none";
    document.getElementById("btnAbortCompose").style.display = "inline-block";
    document.getElementById("composeLog").innerHTML = '';
    send({ action: "enableComposeMode" });
  });

  document.getElementById("btnAbortCompose").addEventListener("click", () => {
    send({ action: "disableComposeMode" });
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "state") {
    if (msg.state) { updateState(msg.state, msg.stats); if (msg.state.status === "idle") handleSearchProgress({ completed: 0, total: 0 }); }
  }
  if (msg.action === "progress") handleSearchProgress(msg);
  if (msg.action === "searchingComplete") { handleSearchProgress({ completed: 0, total: 0 }); Analytics.setJobs(); }
  if (msg.action === "manualEmailsUpdated") {
    Storage.getManualEmails().then(m => { manualEmails = m; renderManualEmails(); });
  }
  if (msg.action === "searchControl") {
    const btn = document.getElementById("btnPause");
    if (!btn) return;
    if (msg.type === "paused") {
      btn.textContent = "Resume";
      btn.classList.add("btn-primary");
    } else if (msg.type === "resumed") {
      btn.textContent = "Pause";
      btn.classList.remove("btn-primary");
    }
  }
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
