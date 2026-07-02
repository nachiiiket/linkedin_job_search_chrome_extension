const COLUMNS = [
  "job_id", "date_found", "position", "company", "location",
  "poster_name", "poster_title", "poster_profile_url",
  "job_url", "email", "applied", "connection_sent", "composed", "notes", "full_post"
];

const defaultPreferences = {
  jobRoles: ["AI Engineer", "ML Engineer", "Machine Learning Engineer",
    "Artificial Intelligence Engineer", "AI/ML Engineer", "Gen AI Engineer",
    "Generative AI Engineer", "AI Researcher", "Deep Learning Engineer",
    "NLP Engineer", "Computer Vision Engineer", "Prompt Engineer",
    "LLM Engineer", "MLOps Engineer", "Data Scientist", "Applied Scientist", "AI Architect"],
  locations: ["Pune", "Bangalore", "Hyderabad"],
  targetCompanies: [], easyApplyOnly: true, postedWithinDays: 1, maxJobsPerRun: 50,
  excludedKeywords: [],
  targetPosterTitles: ["Talent Acquisition", "Recruiter", "HR", "Hiring Manager",
    "Technical Recruiter", "People Operations", "Talent Partner",
    "Head of Talent", "VP of Engineering", "CTO", "Engineering Manager",
    "Team Lead", "Tech Lead", "Senior Engineer", "Staff Engineer",
    "Founder", "Co-Founder", "CEO", "Director of Engineering"],
  searchMode: "jobs",
  jobsFirstPageOnly: true,
  onlyWithEmail: false,
  emailSubject: "",
  emailBody: "",
  composeSpeed: 150
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
    const isDup = jobs.some(j => (jid && j.job_id === jid) ||
      (j.poster_name?.toLowerCase() === pname && j.position?.toLowerCase() === pos));
    if (isDup) return false;

    const row = {};
    COLUMNS.forEach(c => row[c] = job[c] || "");
    if (!row.date_found) row.date_found = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    if (!row.applied) row.applied = "No";
    if (!row.connection_sent) row.connection_sent = "No";
    if (!row.composed) row.composed = "No";
    jobs.push(row);
    await chrome.storage.local.set({ jobs });
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
    const r = await chrome.storage.local.get("scrapeState");
    return r.scrapeState || { status: "idle", mode: "jobs", totalFound: 0 };
  },

  async setState(state) {
    await chrome.storage.local.set({ scrapeState: state });
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

  async clearJobs() {
    await chrome.storage.local.set({ jobs: [] });
    await this.setState({ status: "idle", mode: "jobs", totalFound: 0 });
  }
};
