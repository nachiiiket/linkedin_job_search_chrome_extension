const LinkedinParser = {
  STRAIGHT_EMAIL: /(?:[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,61}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,})/g,
  OBFUSCATED_CLEAN: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  MAILTO_RE: /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
  PHONE_RE: /[\+]?[0-9]{1,3}[-.\s]?[(\s]?[0-9]{3,5}[)\s]?[-.\s]?[0-9]{4,6}/g,
  YEARS_RE: /(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:exp|experience)|(\d+)\+?\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)/gi,
  LOC_RE: /(?:Location|Based in|Office|Hybrid|Remote|WFO|WFH)[:\s]+([A-Za-z ,]+?)(?:\n|$|\.)/gi,
  TITLE_AT: /(.+?)\s+(?:at|@)\s+(.+)/i,
  ROLE_IN_BODY: /(?:hiring|looking\s+for|we\s+are\s+hiring|we're\s+hiring)\s*:?\s*(.+?)(?:\n|$)/i,
  CO_IN_BODY: /(?:Company\s*:\s*)(.+?)(?:\n|$)/i,
  LOC_IN_BODY: /(?:Location\s*:\s*|Office\s*:\s*|Based\s+in\s+)(.+?)(?:\n|$)/i,
  NAME_LIKE: /^[A-Z][a-z]+(?:\s[A-Z][a-z]+){1,4}$/,
  TITLE_KEYWORDS: ["engineer", "scientist", "manager", "director", "head", "lead", "architect", "specialist", "analyst", "consultant", "developer", "researcher", "intern", "fellow", "officer", "vp", "vice president", "president", "ceo", "cto", "coo", "founder", "co-founder"],
  SKILL_WORDS: ["python","java","c++","javascript","typescript","rust","go","sql","nosql","pytorch","tensorflow","keras","jax","transformers","langchain","llama","docker","kubernetes","k8s","aws","gcp","azure","mlops","ci/cd","git","machine learning","deep learning","nlp","computer vision","reinforcement learning","ai","generative ai","llm","rag","agent","fine-tuning","spark","hadoop","flask","fastapi","django","react","angular","node.js","redis","postgresql","mongodb","kafka","airflow","terraform","ansible","prometheus","grafana"],
  BAD_EMAIL_PARTS: [".png", ".jpg", ".svg", ".gif", "example.com", "sentry.io", "linkedin.com"],

  normalizeObfuscated(text) {
    return text
      .replace(/\s*\[at\]\s*/gi, "@")
      .replace(/\s*\(at\)\s*/gi, "@")
      .replace(/\s*\{at\}\s*/gi, "@")
      .replace(/\s*\[dot\]\s*/gi, ".")
      .replace(/\s*\(dot\)\s*/gi, ".")
      .replace(/\s*\{dot\}\s*/gi, ".")
      .replace(/\s+at\s+(?![^@\n]{0,40}@)/gi, "@")
      .replace(/\s+dot\s+(?![^@\n]{0,40}@)/gi, ".")
      .replace(/\s*\[remove\]\s*/gi, "")
      .replace(/\s*\(remove\)\s*/gi, "")
      .replace(/\s*\{remove\}\s*/gi, "");
  },

  cleanEmails(emails) {
    return emails.filter(e => !this.BAD_EMAIL_PARTS.some(b => e.toLowerCase().includes(b)));
  },

  regexExtract(text) {
    const rawEmails = [];
    const normalized = this.normalizeObfuscated(text);
    const mailtoHits = text.match(this.MAILTO_RE) || [];
    for (const h of mailtoHits) {
      let clean = h.replace(/mailto:/gi, "").trim();
      if (this.OBFUSCATED_CLEAN.test(clean)) rawEmails.push(clean);
    }
    const standardHits = normalized.match(this.STRAIGHT_EMAIL) || [];
    for (const h of standardHits) {
      let clean = h.replace(/[.,;:)\]}>]+$/, "").trim();
      if (this.OBFUSCATED_CLEAN.test(clean)) rawEmails.push(clean);
    }
    const emails = this.cleanEmails([...new Set(rawEmails)]);
    const phones = [...new Set((text.match(this.PHONE_RE) || []))].slice(0, 3);
    let years = null;
    const yrMatch = text.match(this.YEARS_RE);
    if (yrMatch) {
      const nums = yrMatch[0].match(/\d+/g);
      if (nums) years = parseInt(nums[0]);
    }
    const locHits = [...text.matchAll(this.LOC_RE)];
    const location = locHits.length ? locHits[0][1].trim() : "";
    return { emails, phones, minYearsExp: years, locationHint: location };
  },

  looksLikeName(line) {
    const w = (line || "").trim().split(/\s+/);
    if (w.length < 2 || w.length > 5) return false;
    if (!w.every(word => word && word[0] === word[0].toUpperCase())) return false;
    const bad = new Set(["follow", "following", "like", "comment", "share", "send", "…more", "...more", "show more", "see more", "repost", "reply", "message"]);
    return !bad.has(line.trim().toLowerCase());
  },

  looksLikeTitle(line) {
    const l = (line || "").toLowerCase();
    return this.TITLE_KEYWORDS.some(kw => l.includes(kw)) || l.includes("@") || l.includes(" at ");
  },

  extractSkills(text, max = 8) {
    const found = [];
    const lower = text.toLowerCase();
    for (const skill of this.SKILL_WORDS) {
      if (lower.includes(skill) && !found.includes(skill)) {
        found.push(skill);
        if (found.length >= max) break;
      }
    }
    return found;
  },

  isJunkLike(line) {
    const junk = ["like", "comment", "share", "send", "repost", "reply", "message", "…more", "...more", "show more", "see more", "follow", "following", "save", "copy link", "report", "embed", "promote"];
    return junk.some(j => line.toLowerCase().trim() === j);
  },

  heuristicParse(lines, tags, queryRole) {
    const result = {
      poster_name: "", poster_title: "", company: "", location: "",
      position: queryRole || "", email: "", job_id: "", notes: "", full_post: ""
    };

    const contentLines = lines.filter(l => !this.isJunkLike(l) && !/^\d+$/.test(l) && l.length > 1);

    for (const line of contentLines) {
      if (!result.poster_name && this.looksLikeName(line)) { result.poster_name = line; continue; }
      if (result.poster_name && !result.poster_title && this.looksLikeTitle(line)) {
        result.poster_title = line;
        const m = line.match(this.TITLE_AT);
        if (m && !result.company) result.company = m[2].trim();
        continue;
      }
    }

    let bodyStart = 0;
    for (let i = 0; i < contentLines.length; i++) {
      const l = contentLines[i];
      if (!this.looksLikeName(l) && !this.looksLikeTitle(l) && !l.includes("•") && !l.toLowerCase().includes("following") && !/^\d+[smhdw]\s*(?:•|edited)/i.test(l)) {
        bodyStart = i; break;
      }
    }
    const body = contentLines.slice(bodyStart).join("\n");
    result.full_post = body.slice(0, 2000);

    const rm = body.match(this.ROLE_IN_BODY);
    if (rm) {
      result.position = rm[1].trim().replace(/[.!,\s]+$/, "");
      for (const prefix of ["for a ", "for an ", "for ", "a ", "an ", "the "]) {
        if (result.position.toLowerCase().startsWith(prefix)) { result.position = result.position.slice(prefix.length); break; }
      }
    }

    const cm = body.match(this.CO_IN_BODY);
    if (cm) result.company = cm[1].trim().replace(/:$/, "");

    const lm = body.match(this.LOC_IN_BODY);
    if (lm) result.location = lm[1].trim();
    else if (tags.locationHint) result.location = tags.locationHint;

    if (tags.profileUrl) {
      const m = tags.profileUrl.match(/\/in\/([^/?#]+)/);
      if (m && !result.company) result.company = m[1].replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    if (tags.emails && tags.emails.length) result.email = tags.emails.join("\n");
    const skills = this.extractSkills(body);
    if (skills.length) result.notes = `skills: ${skills.slice(0, 5).join(", ")}`;

    const raw = `${result.poster_name}${result.company}${result.position}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    result.job_id = raw.slice(-25);

    return result;
  },

  parsePost(postText, profileUrl, dateText, queryRole, htmlName) {
    const lines = postText.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    const ex = this.regexExtract(postText);
    const tags = {
      emails: ex.emails, phones: ex.phones, minYearsExp: ex.minYearsExp,
      locationHint: ex.locationHint, profileUrl: profileUrl || "", dateText: dateText || ""
    };

    const result = this.heuristicParse(lines, tags, queryRole);
    if (!result.poster_name && htmlName) result.poster_name = htmlName;
    if (!result.poster_name && !result.email) return null;

    result.date_found = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    result.applied = "No";
    result.connection_sent = "No";
    result.composed = "No";
    return result;
  }
};
