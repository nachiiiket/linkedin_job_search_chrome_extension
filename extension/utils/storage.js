const COLUMNS = [
  "job_id", "date_found", "position", "company", "location",
  "poster_name", "poster_title", "poster_profile_url",
  "job_url", "email", "applied", "connection_sent", "email_sent", "notes", "full_post"
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
  scrapeSpeed: "normal",
  senderEmail: "",
  testEmail: "",
  emailSubject: "Application for {position} at {company}",
  emailBody: "Hi {name},\n\nI'm reaching out regarding the {position} role at {company}. I have relevant experience in this domain.\n\nResume attached. Happy to connect.\n\nBest,\n{your_name}",
  yourName: "",
  randomDelayMin: 5,
  randomDelayMax: 15
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
    if (!row.email_sent) row.email_sent = "No";
    jobs.push(row);
    await chrome.storage.local.set({ jobs });
    return true;
  },

  async getStats() {
    const jobs = await this.getJobs();
    return { total: jobs.length, withEmail: jobs.filter(j => j.email).length, applied: jobs.filter(j => j.applied === "Yes").length, connected: jobs.filter(j => j.connection_sent === "Yes").length, sent: jobs.filter(j => j.email_sent === "Sent").length };
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

  async clearJobs() {
    await chrome.storage.local.set({ jobs: [] });
    await this.setState({ status: "idle", mode: "jobs", totalFound: 0 });
  },

  async markEmailSent(jobId) {
    const jobs = await this.getJobs();
    const job = jobs.find(j => j.job_id === jobId);
    if (job) { job.email_sent = "Sent"; await chrome.storage.local.set({ jobs }); }
  },

  async markEmailFailed(jobId) {
    const jobs = await this.getJobs();
    const job = jobs.find(j => j.job_id === jobId);
    if (job) { job.email_sent = "Failed"; await chrome.storage.local.set({ jobs }); }
  },

  async markEmailSending(jobId) {
    const jobs = await this.getJobs();
    const job = jobs.find(j => j.job_id === jobId);
    if (job) { job.email_sent = "Sending"; await chrome.storage.local.set({ jobs }); }
  },

  getEmailSendingState() {
    return { total: 0, sent: 0, failed: 0, current: 0, active: false };
  },

  async setEmailSendingState(state) {
    await chrome.storage.local.set({ emailSendingState: state });
  },

  async getRecipientsToSend() {
    const jobs = await this.getJobs();
    return jobs.filter(j => j.email && j.email_sent !== "Sent");
  },

  async getEmailPrefs() {
    const prefs = await this.getPreferences();
    return {
      senderEmail: prefs.senderEmail || "",
      testEmail: prefs.testEmail || "",
      emailSubject: prefs.emailSubject || "Application for {position} at {company}",
      emailBody: prefs.emailBody || "Hi {name},\n\nI'm reaching out regarding the {position} role at {company}.",
      yourName: prefs.yourName || "",
      randomDelayMin: prefs.randomDelayMin || 5,
      randomDelayMax: prefs.randomDelayMax || 15
    };
  },

  async getResumeData() {
    const r = await chrome.storage.local.get("resumeData");
    return r.resumeData || null;
  },

  async saveResumeData(data) {
    await chrome.storage.local.set({ resumeData: data });
  },

  async clearResumeData() {
    await chrome.storage.local.remove("resumeData");
  }
};
