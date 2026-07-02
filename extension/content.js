let shouldStop = false;
let scrapeSpeedMultiplier = 1;

function rand(lo, hi) { return new Promise(r => setTimeout(r, (lo + Math.random() * (hi - lo)) * scrapeSpeedMultiplier)); }
function closeMenu() { document.body.click(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); }
function send(a, d) { try { chrome.runtime.sendMessage({ action: a, ...(d || {}) }, () => {}); } catch (e) {} }

async function checkStop() {
  const s = await Storage.getState();
  if (s && s.stopRequested) { shouldStop = true; }
  return shouldStop;
}

function waitEl(sel, t) {
  const el = document.querySelector(sel); if (el) return el;
  return new Promise(r => {
    const mo = new MutationObserver(() => { const f = document.querySelector(sel); if (f) { mo.disconnect(); r(f); } });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); r(null); }, t || 8000);
  });
}

// fix: added (at)/(dot) + <at>/<dot> variants + gi flags for case-insensitive obfuscated emails
function normalizeObfuscated(text) {
  return text
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s*\{at\}\s*/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".")
    .replace(/\s*\{dot\}\s*/gi, ".")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s*\[remove\]\s*/gi, "")
    .replace(/\s*\(remove\)\s*/gi, "")
    .replace(/\s*\{remove\}\s*/gi, "");
}

const VALID_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function extractEmails(text) {
  const all = [];
  const mailtoRe = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const mailtoHits = text.match(mailtoRe) || [];
  for (const h of mailtoHits) {
    const clean = h.replace(/mailto:/gi, "").trim();
    if (VALID_EMAIL.test(clean)) all.push(clean);
  }
  const normalized = normalizeObfuscated(text);
  const standardHits = normalized.match(/(?:[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,61}[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,})/g) || [];
  for (const h of standardHits) {
    let clean = h.replace(/[.,;:)\]}>]+$/, "").trim();
    if (VALID_EMAIL.test(clean)) all.push(clean);
  }
  const BAD_EMAIL_PARTS = [".png", ".jpg", ".svg", ".gif", "example.com", "sentry.io", "linkedin.com"];
  return [...new Set(all)].filter(e => !BAD_EMAIL_PARTS.some(b => e.toLowerCase().includes(b))).join("\n");
}

/* ====== JOBS SEARCH ====== */

function jobsUrl(kw, loc, cfg) {
  const p = new URLSearchParams();
  p.set("keywords", kw); if (loc) p.set("location", loc);
  p.set("sortBy", "DD");
  if (cfg.easyApplyOnly) p.set("f_AL", "true");
  const d = cfg.postedWithinDays || 1; p.set("f_TPR", d <= 1 ? "r86400" : d <= 7 ? "r604800" : "r2592000");
  return "https://www.linkedin.com/jobs/search?" + p;
}

function isOnCorrectPage(targetUrl) {
  try {
    const t = new URL(targetUrl);
    const c = new URL(window.location.href);
    if (t.pathname !== c.pathname) return false;
    const tKW = t.searchParams.get("keywords");
    const cKW = c.searchParams.get("keywords");
    if (tKW && tKW !== cKW) return false;
    const tLoc = t.searchParams.get("location");
    const cLoc = c.searchParams.get("location");
    if (tLoc && tLoc !== cLoc) return false;
    return true;
  } catch (e) {
    return window.location.href.includes(targetUrl.split("?")[0]);
  }
}

function getJobIds() {
  return [...new Set(Array.from(document.querySelectorAll("[data-job-id]")).map(c => c.getAttribute("data-job-id")).filter(Boolean))];
}

function scrollJobs() {
  const c = document.querySelector(".jobs-search-results-list, .scaffold-layout__list");
  if (c) c.scrollTop = c.scrollHeight; else window.scrollBy(0, 400);
}

async function clickCard(jid) {
  const card = document.querySelector(`[data-job-id="${jid}"]`);
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  await rand(400, 900);
  card.click(); await rand(600, 1200);
  return true;
}

function extractJob(jid) {
  const d = {
    job_id: jid, date_found: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    position: "", company: "", location: "", poster_name: "", poster_title: "", poster_profile_url: "",
    job_url: "https://www.linkedin.com/jobs/view/" + jid + "/",
    email: "", applied: "No", connection_sent: "No", composed: "No", notes: "", full_post: "", source: "jobs"
  };
  try { const e = document.querySelector(".jobs-unified-top-card__job-title h1, .t-24.t-bold.jobs-unified-top-card__job-title"); if (e) d.position = e.innerText.trim(); } catch(e) {}
  try { const e = document.querySelector(".jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name"); if (e) d.company = e.innerText.trim(); } catch(e) {}
  try { const e = document.querySelector(".jobs-unified-top-card__bullet, .jobs-unified-top-card__workplace-type"); if (e) d.location = e.innerText.trim(); } catch(e) {}
  try { for (const b of document.querySelectorAll("button")) { if (b.offsetParent !== null && b.innerText.toLowerCase().includes("see more")) { b.click(); break; } } } catch(e) {}
  try {
    const desc = document.querySelector(".jobs-description-content, .jobs-box__body, main");
    if (desc) { const t = desc.innerText || ""; d.email = extractEmails(t); d.full_post = t.slice(0, 2000); }
  } catch(e) {}
  Object.assign(d, posterInfo());
  return d;
}

function posterInfo() {
  const r = { poster_name: "", poster_title: "", poster_profile_url: "" };
  for (const sel of [".hirer-card__hirer-information", ".jobs-poster__name", ".jobs-contact-section"]) {
    const el = document.querySelector(sel); if (!el) continue;
    try { const n = el.querySelector("a span, .jobs-poster__name, strong, b, h3"); if (n) r.poster_name = n.innerText.trim(); } catch(e) {}
    try { const t = el.querySelector(".hirer-card__hirer-job-title, .jobs-poster__subtitle, .t-14"); if (t) r.poster_title = t.innerText.trim(); } catch(e) {}
    try { const a = el.querySelector("a"); if (a) { let h = a.getAttribute("href") || ""; if (h.startsWith("/")) h = "https://www.linkedin.com" + h; r.poster_profile_url = h.split("?")[0]; } } catch(e) {}
    if (r.poster_name) break;
  }
  return r;
}

async function nextJobPage(pg) {
  for (const sel of ['button[aria-label="Page ' + (pg + 1) + '"]', "button.artdeco-pagination__button--next:not([disabled])", "button.jobs-search-pagination__next-button:not([disabled])"]) {
    try {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) { btn.scrollIntoView({ block: "center" }); await rand(300, 600); btn.click(); return true; }
    } catch(e) {}
  }
  return false;
}

async function scrapeJobs(cfg) {
  const max = cfg.maxJobsPerRun || 50;
  await waitEl("[data-job-id], .jobs-search-results-list", 12000);
  await rand(1500, 2500);
  let found = 0, pg = 1;

  while (found < max && !(await checkStop())) {
    scrollJobs(); await rand(600, 1000);
    const ids = getJobIds();
    if (!ids.length) { send("log", { text: "No job cards on page " + pg }); break; }
    send("log", { text: "Jobs Page " + pg + ": " + ids.length + " cards" });

    for (const id of ids) {
      if (await checkStop() || found >= max) break;
      const { jobs } = await chrome.storage.local.get("jobs");
      if ((jobs || []).some(j => j.job_id === id)) continue;
      if (!(await clickCard(id))) continue;
      const det = extractJob(id);
      if (cfg.excludeCompanies && cfg.excludeCompanies.length) {
        if (cfg.excludeCompanies.some(e => (det.company || "").toLowerCase().includes(e.toLowerCase()))) continue;
      }
      if (cfg.onlyWithEmail && !det.email) continue;
      const saved = await Storage.saveJob(det);
      if (saved) { found++; send("jobFound", { job: det }); send("log", { text: "[" + found + "] " + det.position + " @ " + det.company + (det.email ? " - " + det.email : "") }); }
      await rand(800, 2000);
    }
    if (await checkStop() || found >= max) break;
    if (cfg.jobsFirstPageOnly) break;
    if (!(await nextJobPage(pg))) break;
    pg++;
    await new Promise(r => setTimeout(r, 2500));
  }
  return found;
}

/* ====== POSTS SEARCH ====== */

function postsUrl(query) {
  return "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(query) + "&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22";
}

function simulateClick(el) {
  if (!el || el.offsetParent === null) return;
  el.focus();
  ["pointerover", "pointerenter", "pointerdown", "pointerup", "click"].forEach(evtName => {
    try { el.dispatchEvent(new PointerEvent(evtName, { bubbles: true, cancelable: true, pointerType: "mouse", view: window })); } catch(e) {}
  });
}

async function expandAllOnPage() {
  const selectors = [
    '[data-testid="expandable-text-button"]',
    "button.feed-shared-inline-show-more-text__see-more-less-toggle",
    "button[aria-label*='see more' i]", "button[aria-label*='show more' i]",
    "[aria-label*='see more' i]", "[aria-label*='show more' i]",
  ];
  for (const sel of selectors) {
    for (const b of document.querySelectorAll(sel)) {
      if (b.offsetParent === null) continue;
      simulateClick(b);
    }
  }
  await rand(800, 1200);
}

async function clickSeeMore(el) {
  const seen = new Set();
  const tryClick = async (b) => {
    if (!b || seen.has(b)) return;
    seen.add(b);
    try { b.scrollIntoView({ block: "center" }); } catch(e) {}
    for (let attempt = 0; attempt < 2; attempt++) {
      simulateClick(b);
      await rand(400, 700);
      const expanded = el.querySelector('[data-testid="expandable-text-box"]');
      if (expanded) return;
    }
  };

  // data-testid (Feb 2026+ LinkedIn DOM)
  for (const sel of ['[data-testid="expandable-text-button"]', "button.feed-shared-inline-show-more-text__see-more-less-toggle"]) {
    for (const b of el.querySelectorAll(sel)) { await tryClick(b); }
  }

  // aria-labels
  for (const b of el.querySelectorAll("[aria-label]")) {
    const label = (b.getAttribute("aria-label") || "").toLowerCase().replace(/\s+/g, "");
    if (!["seemore", "…more", "...more", "showmore", "readmore", "expand"].some(l => label.includes(l))) continue;
    await tryClick(b);
  }

  // text content match
  for (const sel of ["button", "span", "a", "div"]) {
    for (const b of el.querySelectorAll(sel)) {
      const t = (b.textContent || "").trim().toLowerCase().replace(/\s+/g, "");
      if (!["seemore", "…more", "...more", "showmore"].some(l => t === l || t.startsWith(l) || t.endsWith(l))) continue;
      let target = b;
      let p = b.parentElement;
      while (p && p !== el) {
        const tag = p.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || p.getAttribute("role") === "button") { target = p; break; }
        p = p.parentElement;
      }
      await tryClick(target);
    }
  }

  // <span> more</span> pattern: parent span may contain child span + " more" text
  for (const span of el.querySelectorAll("span")) {
    if (seen.has(span)) continue;
    const allText = Array.from(span.childNodes).map(n => n.textContent || "").join("").trim().toLowerCase().replace(/\s+/g, "");
    if (!["seemore", "…more", "...more", "showmore"].some(l => allText === l || allText.endsWith(l) || allText.includes(l))) continue;
    let target = span;
    let p = span.parentElement;
    while (p && p !== el) {
      const tag = p.tagName.toLowerCase();
      if (tag === "button" || tag === "a" || p.getAttribute("role") === "button") { target = p; break; }
      p = p.parentElement;
    }
    await tryClick(target);
  }
}

const HIRING_SIGNALS = [
  "hiring", "we are looking", "we're looking", "we are hiring", "we're hiring",
  "looking for a", "looking for an", "opening for", "job opening", "position open",
  "join us", "join our", "we need a", "we need an", "opportunity", "recruiting",
  "vacancy", "immediate opening", "immediate hire"
];

function textHasKeyword(originalText, cleanText, keywords) {
  if (!keywords || !keywords.length) return true;
  const cleanLower = cleanText.toLowerCase();
  const hasRole = keywords.some(kw => {
    const kl = kw.toLowerCase();
    if (cleanLower.includes(kl) || cleanLower.includes(kl.replace(/\s+/g, ""))) return true;
    const words = kl.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    const threshold = Math.max(1, Math.floor(words.length * 0.7));
    let matched = 0;
    for (const w of words) {
      const wordBoundary = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (wordBoundary.test(cleanLower)) { matched++; if (matched >= threshold) return true; }
    }
    return false;
  });
  if (!hasRole) return false;
  const lowerOrig = originalText.toLowerCase();
  const isHiring = HIRING_SIGNALS.some(s => lowerOrig.includes(s));
  if (isHiring) return true;
  const wordsMatch = keywords.some(kw => {
    const ws = kw.toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length >= 1 && ws.some(w => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(lowerOrig));
  });
  return wordsMatch;
}

function extractPostMeta(el) {
  let profileUrl = "", dateText = "";
  for (const a of el.querySelectorAll('a[href*="/in/"]')) {
    const h = a.href || "";
    if (h.includes("/in/") && !h.includes("/feed/")) { profileUrl = h.split("?")[0]; break; }
  }
  const timeEl = el.querySelector("time");
  if (timeEl) dateText = (timeEl.getAttribute("datetime") || timeEl.textContent || "").trim();
  if (!dateText) { const sp = el.querySelector(".feed-shared-actor__sub-description"); if (sp) dateText = sp.textContent.trim(); }
  return { profileUrl, dateText };
}

function extractPosterFromFeed(el) {
  const r = { poster_name: "", poster_title: "", poster_profile_url: "" };
  const actor = el.querySelector(".feed-shared-actor__name, .update-components-actor__name, a[href*='/in/']");
  if (actor) {
    const spans = actor.querySelectorAll("span[dir='ltr'], span[dir='auto']");
    r.poster_name = Array.from(spans).map(s => s.textContent.trim()).filter(Boolean).join(" ") || actor.textContent.trim();
    r.poster_profile_url = actor.getAttribute("href") || "";
    if (r.poster_profile_url.startsWith("/")) r.poster_profile_url = "https://www.linkedin.com" + r.poster_profile_url;
    r.poster_profile_url = r.poster_profile_url.split("?")[0];
  }
  const titleEl = el.querySelector(".feed-shared-actor__description, .update-components-actor__subtitle");
  if (titleEl) r.poster_title = titleEl.textContent.trim();
  return r;
}

function findUrnInEl(el) {
  if (!el) return "";
  const fromAttr = el.getAttribute("data-urn") || "";
  if (fromAttr.includes("urn:li:activity")) return fromAttr;
  const child = el.querySelector("[data-urn]");
  if (child) { const v = child.getAttribute("data-urn") || ""; if (v.includes("urn:li:activity")) return v; }
  const all = el.querySelectorAll("*");
  for (const node of all) {
    for (const attr of node.attributes || []) {
      if (attr.value && attr.value.includes("urn:li:activity")) return attr.value;
    }
  }
  return "";
}

function searchAnchors(root) {
  if (!root) return "";
  for (const a of root.querySelectorAll("a")) {
    const h = a.href || "";
    const path = a.getAttribute("href") || "";
    if (/linkedin\.com\/(feed\/update|activity|posts\/)/.test(h) && !h.includes("/in/")) return h.split("?")[0];
    if (h.includes("urn:li:activity")) return h.split("?")[0];
    const updateUrnMatch = h.match(/[?&]updateUrn=([^&]+)/);
    if (updateUrnMatch) {
      const actMatch = decodeURIComponent(updateUrnMatch[1]).match(/urn:li:activity:\d+/);
      if (actMatch) return "https://www.linkedin.com/feed/update/" + actMatch[0] + "/";
    }
    if (/^\/(feed\/update\/urn:li:activity:\d+|posts\/.*activity)/.test(path)) return "https://www.linkedin.com" + path.split("?")[0];
  }
  return "";
}

function extractPostUrl(el, knownUrn) {
  if (knownUrn && knownUrn.includes("activity")) {
    const match = knownUrn.match(/urn:li:activity:\d+/);
    if (match) return "https://www.linkedin.com/feed/update/" + match[0] + "/";
  }
  let urn = findUrnInEl(el);
  if (urn) {
    const match = urn.match(/urn:li:activity:\d+/);
    if (match) return "https://www.linkedin.com/feed/update/" + match[0] + "/";
  }
  let url = searchAnchors(el);
  if (url) return url;
  const outer = el.closest('[role="listitem"], li.reusable-search__result-container, .reusable-search__result-container');
  if (outer && outer !== el) {
    url = searchAnchors(outer);
    if (url) return url;
    urn = findUrnInEl(outer);
    if (urn) {
      const match = urn.match(/urn:li:activity:\d+/);
      if (match) return "https://www.linkedin.com/feed/update/" + match[0] + "/";
    }
  }
  return window.location.href.split("?")[0];
}

async function extractPostUrlWithMenu(el, knownUrn) {
  const normalUrl = extractPostUrl(el, knownUrn);
  if (normalUrl && !normalUrl.includes("/search/results/content")) return normalUrl;

  const btn = el.querySelector('button[aria-label*="Open control menu"]')
    || (el.closest('[role="listitem"], li.reusable-search__result-container')
      ?.querySelector('button[aria-label*="Open control menu"]'));
  if (!btn) return normalUrl;

  btn.click();
  await rand(400, 700);

  for (const a of document.querySelectorAll('a[href*="updateUrn"]')) {
    if (a.offsetParent === null) continue;
    const h = a.href || "";
    const m = h.match(/[?&]updateUrn=([^&]+)/);
    if (m) {
      const act = decodeURIComponent(m[1]).match(/urn:li:activity:\d+/);
      if (act) {
        closeMenu();
        await rand(300, 500);
        return "https://www.linkedin.com/feed/update/" + act[0] + "/";
      }
    }
  }

  closeMenu();
  return normalUrl;
}

// fix: removed onlyWithEmail filter — posts always saved; dashboard "Without Email" tab handles filtering
async function scrapePosts(cfg) {
  await waitEl(".feed-shared-update-v2, [data-urn*='activity'], li.reusable-search__result-container, [role='listitem']", 12000);
  await rand(1500, 2500);
  send("log", { text: "Expanding all see-more buttons on page..." });
  await expandAllOnPage();
  let found = 0;
  let noNewCount = 0;
  const seenIds = new Set();

  const getPosts = () => {
    for (const sel of [".feed-shared-update-v2", "[data-urn*='activity']", "li.reusable-search__result-container", ".search-content__result"]) {
      const els = document.querySelectorAll(sel);
      if (els.length >= 2) return Array.from(els);
    }
    const listitems = document.querySelectorAll('[role="listitem"]');
    if (listitems.length >= 2) return Array.from(listitems);
    return [];
  };

  while (!(await checkStop())) {
    scrollJobs(); await rand(1200, 1800);
    await expandAllOnPage();
    const els = getPosts();
    send("log", { text: "Found " + els.length + " posts (saved: " + found + ")" });

    if (els.length === 0) {
      send("log", { text: "No post elements found, extracting from page text" });
      const pageText = (document.body.innerText || "").trim();
      if (pageText.length > 200) {
        const allEmails = LinkedinParser.regexExtract(pageText);
        const basic = {
          job_id: "page_" + pageText.slice(0, 30).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, ""),
          date_found: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          position: "", company: "", location: cfg.locations?.[0] || "",
          poster_name: "", poster_title: "", poster_profile_url: "", job_url: window.location.href.split("?")[0],
          email: (allEmails.emails || []).join(", "), applied: "No", connection_sent: "No", composed: "No",
          notes: "", full_post: pageText.slice(0, 2000), source: "posts"
        };
        const saved = await Storage.saveJob(basic);
        if (saved) { found++; send("jobFound", { job: basic }); }
      }
      break;
    }

    let newOnPage = 0;
    for (const el of els) {
      if (await checkStop()) break;

      const urn = el.getAttribute("data-urn") || el.querySelector("a[data-urn]")?.getAttribute("data-urn") || "";
      if (urn && seenIds.has(urn)) continue;
      if (urn) seenIds.add(urn);

      await clickSeeMore(el);
      await rand(300, 600);

      const text = (el.innerText || "").trim();
      if (text.length < 80) continue;

      const cleanText = text
        .replace(/#[^\s#]+/g, "")
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
        .replace(/https?:\/\/\S+/g, "<url>")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/^\s*[\*\-]\s*$/gm, "")
        .trim();

      const keywords = cfg.jobRoles || [];
      if (!textHasKeyword(text, cleanText, keywords)) continue;

      const meta = extractPostMeta(el);
      const poster = extractPosterFromFeed(el);
      const postUrl = await extractPostUrlWithMenu(el, urn);
      const parsed = LinkedinParser.parsePost(cleanText, meta.profileUrl || poster.poster_profile_url, meta.dateText, "", poster.poster_name);

      if (parsed) {
        if (cfg.onlyWithEmail && !parsed.email) { send("log", { text: "Skipped (no email): " + (poster.poster_name || "unknown") }); }
        else {
          Object.assign(parsed, poster);
          parsed.job_url = postUrl;
          parsed.source = "posts";
          const saved = await Storage.saveJob(parsed);
          if (saved) { found++; newOnPage++; send("jobFound", { job: parsed }); }
        }
      } else {
        if (cfg.onlyWithEmail) { send("log", { text: "Skipped (no email): " + (poster.poster_name || "unknown") }); }
        else {
          const basic = {
            job_id: "post_" + (postUrl.replace(/[^a-zA-Z0-9]/g, "").slice(-20) || cleanText.slice(0, 20).replace(/\s+/g, "_")),
            date_found: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            position: "", company: poster.poster_name || "", location: meta.dateText || "",
            poster_name: poster.poster_name || "", poster_title: poster.poster_title || "",
            poster_profile_url: poster.poster_profile_url || "", job_url: postUrl,
            email: "", applied: "No", connection_sent: "No", composed: "No", notes: "", full_post: cleanText.slice(0, 2000), source: "posts"
          };
          const saved = await Storage.saveJob(basic);
          if (saved) { found++; newOnPage++; send("jobFound", { job: basic }); send("log", { text: "Saved (no email): " + (poster.poster_name || "unknown poster") }); }
        }
      }
      await rand(500, 1200);
    }

    if (newOnPage === 0) {
      noNewCount++;
      if (noNewCount >= 3) { send("log", { text: "No new posts after 3 scrolls, moving on" }); break; }
    } else {
      noNewCount = 0;
    }

    scrollJobs();
    await rand(2000, 3000);
  }
  return found;
}

/* ====== MAIN ====== */

function buildPhaseQueries(cfg, phase) {
  const qs = [];
  const companies = cfg.targetCompanies || [];
  if (phase === "posts") {
    for (const role of cfg.jobRoles || []) {
      if (companies.length) {
        for (const company of companies) {
          qs.push({ keyword: role, location: "", label: "Posts: " + role + " @ " + company, query: '"Hiring" AND "' + role + '" AND "' + company + '"', _posts: true });
        }
      } else {
        qs.push({ keyword: role, location: "", label: "Posts: " + role, query: '"Hiring" AND "' + role + '"', _posts: true });
      }
    }
  } else {
    for (const role of cfg.jobRoles || []) {
      if ((cfg.locations || []).length) { for (const loc of cfg.locations) qs.push({ keyword: role, location: loc, label: "Jobs: " + role + " @ " + loc, _posts: false }); }
      else { qs.push({ keyword: role, location: "", label: "Jobs: " + role, _posts: false }); }
    }
  }
  return qs;
}

// fix: returns false on navigation failure (waitEl timeout) so runAll returns early
// and activeScrapeConfig is preserved for resumption on page reload
async function runPhase(cfg, phase, startIdx) {
  const queries = buildPhaseQueries(cfg, phase);
  const scraper = phase === "posts" ? scrapePosts : scrapeJobs;
  const waitSel = phase === "posts"
    ? ".feed-shared-update-v2, li.reusable-search__result-container, [role='listitem']"
    : "[data-job-id], .jobs-search-results-list";

  for (let i = startIdx; i < queries.length && !(await checkStop()); i++) {
    const q = queries[i];
    const url = q._posts ? postsUrl(q.query) : jobsUrl(q.keyword, q.location, cfg);

    await chrome.storage.local.set({ activeScrapeConfig: { phase, idx: i, url, config: cfg } });
    send("log", { text: "=== " + q.label + " ===" });

    if (!isOnCorrectPage(url)) {
      window.location.href = url;
      const loaded = await waitEl(waitSel, 15000);
      if (!loaded) { send("log", { text: "Navigation failed, aborting phase" }); return false; }
      await rand(2000, 3000);
    }

    const found = await scraper(cfg);
    send("log", { text: "=== Complete: " + found + " items ===" });
  }
  return true;
}

// fix: clear stopRequested + reset shouldStop at top so stale stop state from previous run
// doesn't immediately abort a fresh start
async function runAll(cfg) {
  shouldStop = false;
  const mode = cfg.searchMode || "jobs";
  await Storage.setState({ status: "scraping", mode, totalFound: 0, stopRequested: false });

  if (await checkStop()) { await chrome.storage.local.remove("activeScrapeConfig"); return; }

  const phases = mode === "both" ? ["jobs", "posts"] : [mode === "posts" ? "posts" : "jobs"];

  const saved = await chrome.storage.local.get("activeScrapeConfig");
  let sc = saved.activeScrapeConfig;
  let phaseStart = sc ? phases.indexOf(sc.phase) : 0;
  if (phaseStart < 0) phaseStart = 0;

  for (let p = phaseStart; p < phases.length && !(await checkStop()); p++) {
    const phase = phases[p];
    const idx = (sc && sc.phase === phase) ? (sc.idx || 0) : 0;
    const done = await runPhase(cfg, phase, idx);
    if (!done) return;
    sc = null;
  }

  await chrome.storage.local.remove("activeScrapeConfig");
  await Storage.setState({ status: "idle", mode, totalFound: 0, stopRequested: false });
  shouldStop = false;
  send("scrapingComplete", {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startScraping") {
    sendResponse({ ok: true });
    shouldStop = false;
    scrapeSpeedMultiplier = msg.config.scrapeSpeed || 1;
    // clear stale activeScrapeConfig so fresh start never resumes an old session
    chrome.storage.local.remove("activeScrapeConfig").then(() =>
      runAll(msg.config || {}).catch(e => send("log", { text: "Error: " + e.message }))
    );
    return true;
  }
  if (msg.action === "stopScraping") { sendResponse({ ok: true }); shouldStop = true; Storage.setState({ stopRequested: true }); }
  if (msg.action === "ping") { sendResponse({ ok: true }); }
});

(async function init() {
  const saved = await chrome.storage.local.get("activeScrapeConfig");
  const sc = saved.activeScrapeConfig;
  if (!sc || !sc.config) return;
  if (await checkStop()) { await chrome.storage.local.remove("activeScrapeConfig"); await Storage.setState({ stopRequested: false, status: "idle" }); return; }
  const isOnSearch = window.location.href.includes("/jobs/search") || window.location.href.includes("/search/results/content");
  if (isOnSearch) {
    scrapeSpeedMultiplier = sc.config.scrapeSpeed || 1;
    await rand(500, 1000);
    send("log", { text: "Resuming scrape session..." });
    await runAll(sc.config);
  }
})();