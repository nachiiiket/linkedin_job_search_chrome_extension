const COLUMNS = [
  "job_id", "date_found", "found_at", "position", "company", "location",
  "poster_name", "poster_title", "poster_profile_url",
  "job_url", "email", "applied", "connection_sent", "composed", "notes", "full_post",
  "phase", "query_label"
];

// date_found is stored as an en-IN locale string (e.g. "16/10/2026, 3:04:05 pm")
// in Asia/Kolkata wall-clock time, which cannot be aggregated. Parse it into a
// real instant so pre-existing rows still get a usable found_at.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function parseDateFound(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  // Already ISO-ish (found_at / Date.toISOString) — never apply the day-first regex.
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  const m = str.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\D+?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let dd = +m[1], mm = +m[2], yy = +m[3];
    if (yy < 100) yy += 2000;
    let hh = +m[4]; const mi = +m[5], ss = m[6] ? +m[6] : 0;
    const ap = (m[7] || "").toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    // Interpret the wall clock as Asia/Kolkata, then convert to a real instant.
    return new Date(Date.UTC(yy, mm - 1, dd, hh, mi, ss) - IST_OFFSET_MS);
  }
  // Date with no time component — fall back to IST midnight.
  const dm = str.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dm) {
    let dd = +dm[1], mm = +dm[2], yy = +dm[3];
    if (yy < 100) yy += 2000;
    return new Date(Date.UTC(yy, mm - 1, dd) - IST_OFFSET_MS);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function dateToIso(d) {
  return d instanceof Date && !isNaN(d) ? d.toISOString() : "";
}

// Shift an ISO instant by the IST offset so its UTC calendar fields equal the
// Asia/Kolkata calendar day. Use this (not the raw ISO) to bucket by day/week.
function toIstDate(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + IST_OFFSET_MS);
}

// A stored `email` field can hold several addresses: the job/post extractor
// joins them with "\n", while one page fallback historically joined with ", ".
// Normalise either form into a clean list of individual addresses.
function parseEmailList(value) {
  return String(value == null ? "" : value)
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Canonical excluded-address test shared by the content script (search-time
// filter), the background (compose/send) and the analytics dashboard. An
// address is excluded when the trimmed, lowercased configured entry appears as
// a substring of the whole lowercased address — this matches what
// content.js isDomainExcluded() has always done, so the three views agree.
function emailMatchesExcluded(email, domains) {
  if (!email || !domains || !domains.length) return false;
  const e = String(email).toLowerCase();
  return domains.some(d => { const s = String(d == null ? "" : d).toLowerCase().trim(); return s && e.includes(s); });
}

// Pick the address a compose/send should target: the first one that is NOT on
// the user's excluded list. Returns "" when the field has no deliverable
// address (empty, or every address is excluded).
function firstDeliverableEmail(value, domains) {
  const list = parseEmailList(value);
  for (const e of list) { if (!emailMatchesExcluded(e, domains)) return e; }
  return "";
}

const MAX_QUERY_STATS = 2000;

// Serializes bumpDailyStat read-modify-write cycles within this context.
let _dailyWriteChain = Promise.resolve();

const defaultPreferences = {
  jobRoles: ["AI Engineer", "ML Engineer", "Machine Learning Engineer",
    "Artificial Intelligence Engineer", "AI/ML Engineer", "Gen AI Engineer",
    "Generative AI Engineer", "AI Researcher", "Deep Learning Engineer",
    "NLP Engineer", "Computer Vision Engineer", "Prompt Engineer",
    "LLM Engineer", "MLOps Engineer", "Data Scientist", "Applied Scientist", "AI Architect"],
  locations: ["Pune", "Bangalore", "Hyderabad"],
  locationsEnabled: true,
  targetCompanies: [], easyApplyOnly: true, postedWithinDays: 1, maxJobsPerRun: 50,
  targetCompaniesEnabled: true,
  searchMode: "jobs",
  jobsFirstPageOnly: true,
  onlyWithEmail: false,
  searchSpeed: "normal",
  postDateFilter: "",
  emailSubject: "",
  emailBody: "",
  composeSpeed: 1000,
  excludedEmailDomains: [],
  autoSendEnabled: false,
  autoSendMode: "realtime",
  batchSize: 10,
  sendMinDelay: 1000,
  sendMaxDelay: 3000,
  connectionNote: "",
  linkedinDm: "",
  showInPagePanel: false,
  showDebugLogs: false
};

const Storage = {
  async getJobs() {
    const r = await chrome.storage.local.get("jobs");
    return r.jobs || [];
  },

  async saveJob(job) {
    const jobs = await this.getJobs();
    const jid = (job.job_id || "").trim();
    const pname = (job.poster_name || "").trim().toLowerCase();
    const pos = (job.position || "").trim().toLowerCase();
    // Only fall back to the poster+position identity when both are non-empty,
    // otherwise distinct rows with no poster/position get silently dropped.
    const named = pname && pos;
    const isDup = jobs.some(j => (jid && j.job_id === jid) ||
      (named && (j.poster_name || "").toLowerCase() === pname && (j.position || "").toLowerCase() === pos));
    if (isDup) return false;

    const row = {};
    COLUMNS.forEach(c => row[c] = job[c] || "");
    if (!row.date_found) row.date_found = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    if (!row.found_at) {
      const parsed = parseDateFound(row.date_found);
      row.found_at = dateToIso(parsed || new Date());
    }
    if (!row.phase) row.phase = job.source || "";
    if (!row.applied) row.applied = "No";
    if (!row.connection_sent) row.connection_sent = "No";
    if (!row.composed) row.composed = "No";
    jobs.push(row);
    try {
      await chrome.storage.local.set({ jobs });
    } catch (e) {
      console.error("saveJob storage write failed", e);
      return false;
    }
    return true;
  },

  async getStats() {
    const jobs = await this.getJobs();
    return { total: jobs.length, withEmail: jobs.filter(j => j.email).length, applied: jobs.filter(j => j.applied === "Yes").length, connected: jobs.filter(j => j.connection_sent === "Yes").length, composed: jobs.filter(j => j.composed === "Yes").length };
  },

  async markComposed(jobId) {
    const jobs = await this.getJobs();
    const idx = jobs.findIndex(j => j.job_id === jobId);
    if (idx === -1) return false;
    jobs[idx].composed = "Yes";
    await chrome.storage.local.set({ jobs });
    return true;
  },

  async getPreferences() {
    const r = await chrome.storage.sync.get("preferences");
    return r.preferences || defaultPreferences;
  },

  async savePreferences(prefs) {
    await chrome.storage.sync.set({ preferences: prefs });
  },

  async getState() {
    const r = await chrome.storage.local.get("searchState");
    return r.searchState || { status: "idle", mode: "jobs", totalFound: 0 };
  },

  async setState(state) {
    await chrome.storage.local.set({ searchState: state });
  },

  async saveResume(data) {
    await chrome.storage.local.set({ resumeFile: data });
  },

  async getResume() {
    const r = await chrome.storage.local.get("resumeFile");
    return r.resumeFile || null;
  },

  async clearResume() {
    await chrome.storage.local.remove("resumeFile");
  },

  async getSentEmails() {
    const r = await chrome.storage.local.get("sentEmails");
    return r.sentEmails || [];
  },

  async addSentEmail(email) {
    const list = await this.getSentEmails();
    const e = (email || '').trim().toLowerCase();
    if (e && !list.includes(e)) {
      list.push(e);
      await chrome.storage.local.set({ sentEmails: list });
    }
  },

  async clearSentEmails() {
    await chrome.storage.local.remove("sentEmails");
  },

  async getManualEmails() {
    const r = await chrome.storage.local.get("manualEmails");
    return r.manualEmails || [];
  },

  async saveManualEmail(entry) {
    const list = await this.getManualEmails();
    const idx = list.findIndex(m => m.id === entry.id);
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
    await chrome.storage.local.set({ manualEmails: list });
    return list;
  },

  async markManualEmailSent(id, sentAt) {
    const list = await this.getManualEmails();
    const idx = list.findIndex(m => m.id === id);
    if (idx === -1) return false;
    list[idx].status = "sent";
    list[idx].sentAt = sentAt;
    await chrome.storage.local.set({ manualEmails: list });
    return true;
  },

  async clearManualEmails() {
    await chrome.storage.local.remove("manualEmails");
  },

  async getComposeState() {
    const r = await chrome.storage.local.get("composeActive");
    return r.composeActive || false;
  },

  async setComposeState(active) {
    await chrome.storage.local.set({ composeActive: !!active });
  },

  async clearJobs() {
    await chrome.storage.local.set({ jobs: [] });
    const s = await this.getState();
    await this.setState({ status: "idle", mode: s.mode || "jobs", totalFound: 0 });
  },

  /* ====== Analytics: per-query aggregates, per-day buckets, disabled queries ====== */

  async getQueryStats() {
    const r = await chrome.storage.local.get("queryStats");
    return r.queryStats || [];
  },

  async saveQueryStats(list) {
    await chrome.storage.local.set({ queryStats: (list || []).slice(-MAX_QUERY_STATS) });
  },

  // Increment a per-query aggregate. Counters in `delta` are ADDED, metadata is SET.
  async addQueryStat(delta) {
    if (!delta || !delta.id) return;
    const list = await this.getQueryStats();
    let e = list.find(x => x.id === delta.id);
    const now = delta.at || new Date().toISOString();
    if (!e) {
      e = {
        id: delta.id, label: "", phase: "", keyword: "", location: "",
        runs: 0, found: 0, withEmail: 0,
        excludedNoEmail: 0, excludedCompany: 0, excludedDupe: 0, excludedDomain: 0,
        skipped: 0, failed: 0, completeRuns: 0, interrupted: 0, firstRunAt: now, lastRunAt: now
      };
      list.push(e);
    }
    ["label", "phase", "keyword", "location"].forEach(k => { if (delta[k]) e[k] = delta[k]; });
    ["runs", "found", "withEmail", "excludedNoEmail", "excludedCompany", "excludedDupe",
      "excludedDomain", "skipped", "failed", "completeRuns", "interrupted"].forEach(k => {
      if (typeof delta[k] === "number") e[k] = (e[k] || 0) + delta[k];
    });
    e.lastRunAt = now;
    if (!e.firstRunAt) e.firstRunAt = now;
    await this.saveQueryStats(list);
  },

  async getDailyStats() {
    const r = await chrome.storage.local.get("dailyStats");
    return r.dailyStats || {};
  },

  // Serialize read-modify-write bumps so overlapping calls (e.g. the
  // un-awaited `searches` bump racing a query's run/result bumps) cannot read
  // the same snapshot and clobber each other's counters. The chain only
  // guards writers inside THIS context; dailyStats is written solely by the
  // content script, so a single chain is enough.
  async bumpDailyStat(day, fields) {
    if (!day || !fields) return;
    _dailyWriteChain = _dailyWriteChain.then(async () => {
      const obj = await this.getDailyStats();
      const e = obj[day] || (obj[day] = { found: 0, withEmail: 0, excluded: 0 });
      Object.keys(fields).forEach(k => { e[k] = (e[k] || 0) + (fields[k] || 0); });
      const keys = Object.keys(obj).sort();
      while (keys.length > 800) delete obj[keys.shift()];
      await chrome.storage.local.set({ dailyStats: obj });
    }).catch(() => {});
    return _dailyWriteChain;
  },

  async getDisabledQueries() {
    const r = await chrome.storage.local.get("disabledQueries");
    return r.disabledQueries || [];
  },

  async setDisabledQueries(list) {
    await chrome.storage.local.set({ disabledQueries: list || [] });
  },

  async setQueryDisabled(label, disabled) {
    if (!label) return [];
    const list = await this.getDisabledQueries();
    const i = list.indexOf(label);
    if (disabled && i === -1) list.push(label);
    if (!disabled && i !== -1) list.splice(i, 1);
    await this.setDisabledQueries(list);
    return list;
  },

  // Backfill found_at on rows saved before analytics existed.
  async migrateFoundAt() {
    const jobs = await this.getJobs();
    let changed = 0;
    for (const j of jobs) {
      if (j.found_at) continue;
      const p = parseDateFound(j.date_found);
      if (p) { j.found_at = dateToIso(p); changed++; }
    }
    if (changed) await chrome.storage.local.set({ jobs });
    return changed;
  },

  async clearAnalytics() {
    await chrome.storage.local.remove(["queryStats", "dailyStats", "disabledQueries"]);
  }
};
