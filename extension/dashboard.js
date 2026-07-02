let port = null, allJobs = [], currentFilter = "all";
function connect() { port = chrome.runtime.connect({ name: "dashboard" }); port.onMessage.addListener(handle); }

function handle(msg) {
  if (msg.action === "state") updateState(msg.state, msg.stats);
  if (msg.action === "jobs") { allJobs = msg.jobs; renderJobs(allJobs); }
  if (msg.action === "preferences") populateForm(msg.prefs);
  if (msg.action === "preferencesSaved") {
    document.getElementById("saveStatus").textContent = "Saved!"; setTimeout(() => document.getElementById("saveStatus").textContent = "", 2000);
    document.getElementById("emailSaveStatus").textContent = "Saved!"; setTimeout(() => document.getElementById("emailSaveStatus").textContent = "", 2000);
  }
  if (msg.action === "cleared") { allJobs = []; renderJobs([]); updateState({ status: "idle" }, { total: 0, applied: 0, connected: 0, sent: 0 }); }
  if (msg.action === "preferences") populateEmailForm(msg.prefs);
  if (msg.action === "emailProgress") updateEmailProgress(msg);
  if (msg.action === "emailComplete") { finishEmailSending(msg); }
  if (msg.action === "emailLog") { addSendLog(msg.text); }
  if (msg.action === "emailTestResult") { showTestResult(msg); }
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
    document.getElementById("dashSent").textContent = stats.sent || 0;
    document.getElementById("dashApplied").textContent = stats.applied;
    document.getElementById("dashConnected").textContent = stats.connected;
    chrome.action.setBadgeText({ text: String(stats.total) });
  }
}

function updateEmailProgress(msg) {
  const p = document.getElementById("emailProgress"); p.style.display = "block";
  document.getElementById("progressFill").style.width = msg.total > 0 ? (msg.current / msg.total * 100) + "%" : "0%";
  document.getElementById("progressText").textContent = msg.sent + " sent, " + msg.failed + " failed";
  document.getElementById("progressDetail").textContent = "(" + msg.current + " / " + msg.total + ") - " + (msg.status || "");
}

function finishEmailSending(msg) {
  document.getElementById("btnSendEmails").style.display = "block";
  document.getElementById("btnStopSending").style.display = "none";
  document.getElementById("progressFill").style.width = "100%";
  document.getElementById("progressText").textContent = msg.sent + " sent, " + msg.failed + " failed";
  document.getElementById("progressDetail").textContent = msg.total > 0 ? "Completed" : "Cancelled";
  addSendLog("Done. Sent: " + msg.sent + ", Failed: " + msg.failed + ", Total: " + msg.total);
  Storage.getStats().then(stats => { updateState({ status: "idle" }, stats); renderJobs(allJobs); });
}

function addSendLog(text) {
  const log = document.getElementById("sendLog");
  const d = document.createElement("div"); d.className = "log-entry"; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

function showTestResult(msg) {
  const el = document.getElementById("testResult");
  el.style.display = "block";
  el.className = "test-result " + (msg.success ? "test-success" : "test-fail");
  el.textContent = msg.success ? "Test sent successfully!" : "Failed: " + msg.error;
  if (msg.success) setTimeout(() => { el.style.display = "none"; }, 4000);
  document.getElementById("btnSendTest").disabled = false;
  document.getElementById("btnSendTest").textContent = "Send Test";
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
  // fix: restore searchMode from saved prefs
  document.getElementById("dashSearchMode").value = p.searchMode || "jobs";
}

function populateEmailForm(p) {
  document.getElementById("senderEmail").value = p.senderEmail || "";
  document.getElementById("testEmail").value = p.testEmail || "";
  document.getElementById("yourName").value = p.yourName || "";
  document.getElementById("emailSubject").value = p.emailSubject || "";
  document.getElementById("emailBody").value = p.emailBody || "";
  document.getElementById("randomDelayMin").value = p.randomDelayMin || 5;
  document.getElementById("randomDelayMax").value = p.randomDelayMax || 15;
  Storage.getResumeData().then(d => {
    document.getElementById("resumeStatus").textContent = d ? "Resume loaded (" + (d.name || "unknown") + ")" : "No resume selected";
  });
}

function getEmailPrefs() {
  return {
    senderEmail: document.getElementById("senderEmail").value.trim(),
    testEmail: document.getElementById("testEmail").value.trim(),
    yourName: document.getElementById("yourName").value.trim(),
    emailSubject: document.getElementById("emailSubject").value.trim(),
    emailBody: document.getElementById("emailBody").value,
    randomDelayMin: parseInt(document.getElementById("randomDelayMin").value) || 5,
    randomDelayMax: parseInt(document.getElementById("randomDelayMax").value) || 15,
  };
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
    targetPosterTitles: [], excludedKeywords: [],
    searchMode: document.getElementById("dashSearchMode").value,
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
    ];
    cells.forEach((t, i) => {
      const td = document.createElement("td"); td.textContent = t || "-"; td.title = t || "";
      if (i === 4) td.className = "email-cell";
      tr.appendChild(td);
    });
    const statusTd = document.createElement("td");
    const status = j.email_sent || "No";
    statusTd.textContent = status;
    statusTd.className = "email-status-" + status.toLowerCase();
    tr.appendChild(statusTd);
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

  document.getElementById("btnStart").addEventListener("click", async () => {
    const existing = await Storage.getPreferences();
    const p = getPrefs();
    Object.assign(existing, p);
    if (port) port.postMessage({ action: "startScraping", config: existing });
  });
  document.getElementById("btnStop").addEventListener("click", () => { if (port) port.postMessage({ action: "stopScraping" }); });
  document.getElementById("btnSavePrefs").addEventListener("click", async () => {
    const existing = await Storage.getPreferences();
    const p = getPrefs();
    Object.assign(existing, p);
    if (port) port.postMessage({ action: "savePreferences", prefs: existing });
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

  document.getElementById("sidebarTabScraping").addEventListener("click", () => {
    document.getElementById("sidebarTabScraping").classList.add("active");
    document.getElementById("sidebarTabEmail").classList.remove("active");
    document.getElementById("scrapingPrefs").style.display = "block";
    document.getElementById("emailPrefs").style.display = "none";
  });
  document.getElementById("sidebarTabEmail").addEventListener("click", () => {
    document.getElementById("sidebarTabEmail").classList.add("active");
    document.getElementById("sidebarTabScraping").classList.remove("active");
    document.getElementById("scrapingPrefs").style.display = "none";
    document.getElementById("emailPrefs").style.display = "block";
    if (port) port.postMessage({ action: "getPreferences" });
  });

  document.getElementById("btnSaveEmailPrefs").addEventListener("click", async () => {
    const existing = await Storage.getPreferences();
    const emailPrefs = getEmailPrefs();
    Object.assign(existing, emailPrefs);
    if (port) port.postMessage({ action: "savePreferences", prefs: existing });
  });

  document.getElementById("resumeFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Please select a PDF file."); return; }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const base64 = evt.target.result.split(",")[1];
      await Storage.saveResumeData({ name: file.name, data: base64 });
      document.getElementById("resumeStatus").textContent = "Resume loaded (" + file.name + ")";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btnSendEmails").addEventListener("click", async () => {
    const prefs = await Storage.getEmailPrefs();
    if (!prefs.senderEmail) { alert("Please configure sender email in Email Preferences first."); return; }
    const recipients = await Storage.getRecipientsToSend();
    if (!recipients.length) { alert("No unsent recipients with email found. Scrape some jobs/posts first."); return; }
    document.getElementById("btnSendEmails").style.display = "none";
    document.getElementById("btnStopSending").style.display = "block";
    document.getElementById("emailProgress").style.display = "block";
    document.getElementById("sendLog").innerHTML = "";
    addSendLog("Starting email campaign to " + recipients.length + " recipients...");
    if (port) port.postMessage({ action: "startEmailSending" });
  });

  document.getElementById("btnStopSending").addEventListener("click", () => {
    if (port) port.postMessage({ action: "stopEmailSending" });
  });

  document.getElementById("btnSendTest").addEventListener("click", async () => {
    const prefs = await Storage.getEmailPrefs();
    if (!prefs.senderEmail) { alert("Please configure sender email first."); return; }
    const testTo = document.getElementById("testEmail").value.trim();
    if (!testTo) { alert("Enter a test email address."); return; }
    document.getElementById("btnSendTest").disabled = true;
    document.getElementById("btnSendTest").textContent = "Sending...";
    document.getElementById("testResult").style.display = "none";
    if (port) port.postMessage({ action: "sendTestEmail", testEmail: testTo });
  });
});
