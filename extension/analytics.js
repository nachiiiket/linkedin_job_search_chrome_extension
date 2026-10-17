/* Analytics dashboard — hand-rolled animated SVG charts (MV3 CSP: no remote scripts). */
const Analytics = (() => {
  const SVGNS = "http://www.w3.org/2000/svg";
  const IST_MS = 5.5 * 60 * 60 * 1000;
  const RANGES = ["day", "week", "month", "year", "all"];
  const STOP = new Set(("a an and are as at be but by for from has have if in into is it its of on or " +
    "that the their then there these they this to was we were will with you your your's not no " +
    "or more most other some such only over under about after all also can could do does each " +
    "how than when where which while would should may might our us them he she his her him " +
    "been being because between both during each few many own same very just now new get make " +
    "like use used using via per one two three we're you're we're i'm i've it's that's there's").split(" "));

  let range = "week";
  let view = "results";
  let autoDisableDead = false;
  let wordScope = "all";
  let wordTopN = 20;
  let wordMinCount = 2;
  let showUnigrams = true;
  let showBigrams = true;
  let lastKpis = {};
  let jobsCache = [];
  let queryStatsCache = [];
  let dailyCache = {};
  let excludedDomains = [];
  let deadQueryRuns = 3;
  const lowYieldRatio = 0.2;

  /* ---------- tiny helpers ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function animateNumeric(host, key, next, draw) {
    host._anim = host._anim || {};
    host._raf = host._raf || {};
    const prev = host._anim[key];
    if (!prev || prev.length !== next.length) {
      draw(next.slice());
      host._anim[key] = next.slice();
      return;
    }
    if (host._raf[key]) cancelAnimationFrame(host._raf[key]);
    const from = prev.slice(), to = next.slice(), t0 = performance.now(), dur = 520;
    function frame(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e2 = 1 - Math.pow(1 - p, 3);
      draw(to.map((v, i) => from[i] + (v - from[i]) * e2));
      if (p < 1) host._raf[key] = requestAnimationFrame(frame);
      else host._anim[key] = to.slice();
    }
    host._raf[key] = requestAnimationFrame(frame);
  }

  function countUp(node, to) {
    const from = typeof node._v === "number" ? node._v : 0;
    node._v = to;
    if (from === to) { node.textContent = String(to); return; }
    const t0 = performance.now(), dur = 480;
    function frame(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e2 = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(from + (to - from) * e2));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- settings ---------- */
  async function loadSettings() {
    try {
      const r = await chrome.storage.local.get("analyticsSettings");
      const s = r.analyticsSettings || {};
      if (RANGES.indexOf(s.range) !== -1) range = s.range;
      if (typeof s.autoDisableDead === "boolean") autoDisableDead = s.autoDisableDead;
      if (s.wordScope === "all" || s.wordScope === "email") wordScope = s.wordScope;
      if (s.wordTopN) wordTopN = +s.wordTopN;
      if (s.wordMinCount) wordMinCount = +s.wordMinCount;
      if (typeof s.showUnigrams === "boolean") showUnigrams = s.showUnigrams;
      if (typeof s.showBigrams === "boolean") showBigrams = s.showBigrams;
      if (s.deadQueryRuns) deadQueryRuns = Math.max(1, Math.min(50, +s.deadQueryRuns || 3));
    } catch (e) {}
  }
  async function saveSettings() {
    try {
      await chrome.storage.local.set({
        analyticsSettings: { range, autoDisableDead, wordScope, wordTopN, wordMinCount, showUnigrams, showBigrams, deadQueryRuns }
      });
    } catch (e) {}
  }

  /* ---------- bucketing (all in Asia/Kolkata) ---------- */
  function bucketKeyFromDay(day, r) {
    if (r === "all") return "all";
    if (r === "year") return day.slice(0, 4);
    if (r === "month") return day.slice(0, 7);
    if (r === "week") {
      const p = day.split("-").map(Number);
      const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      return dt.toISOString().slice(0, 10);
    }
    return day;
  }
  function stepKeys(minKey, maxKey, r) {
    if (r === "all" || !minKey || !maxKey) return [minKey || maxKey].filter(Boolean);
    const out = [];
    if (r === "year") {
      let y = +minKey, yMax = +maxKey;
      while (y <= yMax) { out.push(String(y)); y++; }
      return out;
    }
    if (r === "month") {
      let y = +minKey.slice(0, 4), m = +minKey.slice(5, 7);
      const yM = +maxKey.slice(0, 4), mM = +maxKey.slice(5, 7);
      while (y < yM || (y === yM && m <= mM)) {
        out.push(y + "-" + String(m).padStart(2, "0"));
        m++; if (m > 12) { m = 1; y++; }
      }
      return out;
    }
    const p1 = minKey.split("-").map(Number), p2 = maxKey.split("-").map(Number);
    const step = (r === "week" ? 7 : 1) * 86400000;
    for (let t = Date.UTC(p1[0], p1[1] - 1, p1[2]); t <= Date.UTC(p2[0], p2[1] - 1, p2[2]); t += step) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }
  function bucketLabel(key, r) {
    if (key === "all") return "All time";
    if (r === "day" || r === "week" || r === "month") return key.length > 7 ? key.slice(5) : key;
    return key;
  }
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // Monday-first display order for the "best day of week" chart.
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const HOUR_BLOCKS = [
    { label: "Night 0-6", lo: 0, hi: 6 },
    { label: "Morning 6-12", lo: 6, hi: 12 },
    { label: "Afternoon 12-18", lo: 12, hi: 18 },
    { label: "Evening 18-24", lo: 18, hi: 24 }
  ];
  // Human-friendly full label for a raw bucket key. Dates are built in UTC from the
  // key parts so the rendered name never shifts with the local timezone.
  function bucketFullLabel(key, mode) {
    if (key == null || key === "all") return "All time";
    const p = String(key).split("-").map(Number);
    const y = p[0], m = p[1], d = p[2];
    if (mode === "year") return String(y);
    if (mode === "month") return (m >= 1 && m <= 12) ? (MONTH_NAMES[m - 1] + " " + y) : key;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt.getTime())) return key;
    const base = DAY_NAMES[dt.getUTCDay()] + " " + d + " " + MONTH_SHORT[m - 1] + " " + y;
    return mode === "week" ? "Week of " + base : base;
  }
  function istStartIsoFromDay(day) {
    const p = day.split("-").map(Number);
    // start of that IST calendar day as a real instant (IST is ahead of UTC)
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]) - IST_MS).toISOString();
  }
  function rangeStartDay() {
    const today = toIstDate(new Date()).toISOString().slice(0, 10);
    const p = today.split("-").map(Number);
    switch (range) {
      case "day": return new Date(Date.UTC(p[0], p[1] - 1, p[2] - 29)).toISOString().slice(0, 10);
      // trailing 7 days: today and the 6 days before it
      case "week": return new Date(Date.UTC(p[0], p[1] - 1, p[2] - 6)).toISOString().slice(0, 10);
      case "month": return new Date(Date.UTC(p[0], p[1] - 1 - 11, 1)).toISOString().slice(0, 10);
      case "year": return new Date(Date.UTC(p[0] - 4, 0, 1)).toISOString().slice(0, 10);
      default: return null;
    }
  }
  function rangeStartIso(r) {
    const day = rangeStartDay();
    return day ? istStartIsoFromDay(day) : null;
  }

  /* ---------- aggregation ---------- */
  function inRangeDay(day) {
    const start = rangeStartDay();
    return !start || day >= start;
  }

  function jobDay(job) {
    let iso = job.found_at;
    if (!iso && job.date_found && typeof parseDateFound === "function") {
      const d = parseDateFound(job.date_found);
      if (d) iso = d.toISOString();
    }
    if (!iso) return "";
    const t = new Date(iso);
    if (isNaN(t.getTime())) return "";
    return toIstDate(t).toISOString().slice(0, 10);
  }

  // A saved email is "excluded" when it matches the user's excluded-domain list.
  // Mirrors content.js isDomainExcluded() exactly (substring test on the whole
  // lowercased email) so the reconstructed Excluded line matches what the live
  // search filter actually dropped. Version-agnostic: rebuilds history from
  // durable saved jobs + their found_at timestamps.
  function emailDomainExcluded(email) {
    if (!email || !excludedDomains.length) return false;
    const e = String(email).toLowerCase();
    return excludedDomains.some(d => e.includes(d));
  }
  // The email that actually lands on the "Emails found" line (kept, not excluded).
  function jobHasKeptEmail(job) {
    return !!job.email && !emailDomainExcluded(job.email);
  }

  function buildSeries() {
    const dayMap = new Map();
    const add = (day, fields) => {
      const e = dayMap.get(day) || { found: 0, withEmail: 0, excluded: 0, runs: 0, searches: 0 };
      if (fields.found) e.found += fields.found;
      if (fields.withEmail) e.withEmail += fields.withEmail;
      if (fields.excluded) e.excluded += fields.excluded;
      if (fields.runs) e.runs += fields.runs;
      if (fields.searches) e.searches += fields.searches;
      dayMap.set(day, e);
    };
    // found / excluded come from the durable saved jobs so past runs show up too:
    // an email whose domain is in excludedEmailDomains goes on the Excluded line
    // (at its found_at timestamp), every other saved email goes on the found line.
    jobsCache.forEach(j => {
      const day = jobDay(j);
      if (!day || !j.email) return;
      if (emailDomainExcluded(j.email)) add(day, { excluded: 1 });
      else add(day, { found: 1, withEmail: 1 });
    });
    // search-time exclusions (domain only) and the run/search counters are only
    // recorded live, so they come from dailyStats. `excludedDomain` counts emails
    // that were dropped because their domain is on the user's excluded list.
    Object.keys(dailyCache).forEach(day => {
      const dc = dailyCache[day] || {};
      add(day, { excluded: dc.excludedDomain || 0, runs: dc.runs || 0, searches: dc.searches || 0 });
    });
    const days = Array.from(dayMap.keys()).filter(inRangeDay).sort();
    if (!days.length) return { labels: [], found: [], excluded: [], runs: [], searches: [], keys: [], mode: range };
    const buckets = new Map();
    // for "all", pick a bucket width that keeps the whole history readable;
    // a 7-day "week" window is read day-by-day (Monday-start week buckets would
    // show mostly-out-of-window partial weeks at this width).
    let mode = range;
    if (range === "week") mode = "day";
    else if (range === "all") {
      const p1 = days[0].split("-").map(Number), p2 = days[days.length - 1].split("-").map(Number);
      const span = (Date.UTC(p2[0], p2[1] - 1, p2[2]) - Date.UTC(p1[0], p1[1] - 1, p1[2])) / 86400000;
      mode = span > 730 ? "year" : span > 45 ? "month" : "day";
    }
    for (const day of days) {
      const key = bucketKeyFromDay(day, mode);
      const e = buckets.get(key) || { found: 0, withEmail: 0, excluded: 0, runs: 0, searches: 0 };
      const d = dayMap.get(day);
      e.found += d.found; e.withEmail += d.withEmail; e.excluded += d.excluded;
      e.runs += d.runs; e.searches += d.searches;
      buckets.set(key, e);
    }
    const keys = Array.from(buckets.keys()).sort();
    const filled = stepKeys(keys[0], keys[keys.length - 1], mode);
    return {
      labels: filled.map(k => bucketLabel(k, mode)),
      found: filled.map(k => (buckets.get(k) || {}).withEmail || 0),
      excluded: filled.map(k => (buckets.get(k) || {}).excluded || 0),
      runs: filled.map(k => (buckets.get(k) || {}).runs || 0),
      searches: filled.map(k => (buckets.get(k) || {}).searches || 0),
      keys: filled.slice(),
      mode
    };
  }

  // All-time best buckets (ignores the active range window) at each granularity.
  // `found` mirrors buildSeries()'s public metric: the count of jobs WITH an email.
  function computePeaks() {
    const dayMap = new Map();
    const add = (day, fields) => {
      const e = dayMap.get(day) || { found: 0, withEmail: 0, excluded: 0 };
      if (fields.found) e.found += fields.found;
      if (fields.withEmail) e.withEmail += fields.withEmail;
      if (fields.excluded) e.excluded += fields.excluded;
      dayMap.set(day, e);
    };
    jobsCache.forEach(j => {
      const day = jobDay(j);
      if (!day || !j.email) return;
      if (emailDomainExcluded(j.email)) add(day, { excluded: 1 });
      else add(day, { found: 1, withEmail: 1 });
    });
    Object.keys(dailyCache).forEach(day => add(day, { excluded: (dailyCache[day] || {}).excludedDomain || 0 }));

    const out = { day: null, week: null, month: null, year: null };
    ["day", "week", "month", "year"].forEach(mode => {
      const buckets = new Map();
      dayMap.forEach((d, day) => {
        const key = bucketKeyFromDay(day, mode);
        const e = buckets.get(key) || { found: 0, withEmail: 0, excluded: 0 };
        e.found += d.found; e.withEmail += d.withEmail; e.excluded += d.excluded;
        buckets.set(key, e);
      });
      let best = null, bestKey = null;
      buckets.forEach((e, key) => {
        if (e.withEmail <= 0) return;
        if (!best || e.withEmail > best.withEmail || (e.withEmail === best.withEmail && key > bestKey)) {
          best = e; bestKey = key;
        }
      });
      if (best) {
        out[mode] = {
          key: bestKey,
          label: bucketFullLabel(bestKey, mode),
          found: best.withEmail,
          withEmail: best.withEmail,
          excluded: best.excluded
        };
      }
    });
    return out;
  }

  // Index of the on-chart peak (max found) for the CURRENT series, or -1.
  function computeRangePeak(series) {
    let best = -1, bestV = 0;
    const f = series.found || [];
    for (let i = 0; i < f.length; i++) {
      if (f[i] > bestV) { bestV = f[i]; best = i; }
    }
    return best;
  }

  function inRange(job) {
    const start = rangeStartIso(range);
    if (!start) return true;
    const iso = job.found_at || "";
    if (!iso) return true;
    return iso >= start;
  }

  // Merged per-query rows so the table and the "top queries" chart stay in sync:
  // found/withEmail are reconciled from saved jobs (durable across runs), while
  // runs/skipped/failed/excluded come from the per-query aggregates. Outside the
  // "all" range the job side is scoped to the window; per-query run counters are
  // all-time (they are not recorded per day) and are preserved as-is.
  function queryRows() {
    const scoped = range !== "all";
    const jobs = scoped ? jobsCache.filter(inRange) : jobsCache;
    const byLabel = new Map();
    jobs.forEach(j => {
      const label = j.query_label || "";
      if (!label) return;
      const e = byLabel.get(label) || { found: 0, withEmail: 0, excluded: 0, phase: j.phase || "" };
      e.found++;
      if (jobHasKeptEmail(j)) e.withEmail++;
      if (emailDomainExcluded(j.email)) e.excluded++;
      if (!e.phase && j.phase) e.phase = j.phase;
      byLabel.set(label, e);
    });
    const rows = queryStatsCache.map(q => {
      const d = byLabel.get(q.label);
      const row = Object.assign({}, q);
      // Excluded = domain-excluded emails reconstructed from (scoped) jobs for
      // this label, plus the live search-time domain exclusions for the query.
      row.excluded = (d ? d.excluded : 0) + (q.excludedDomain || 0);
      if (d) {
        if (scoped) {
          row.found = d.found;
          row.withEmail = d.withEmail;
        } else {
          row.found = Math.max(q.found || 0, d.found);
          row.withEmail = Math.max(q.withEmail || 0, d.withEmail);
        }
        if (!row.phase && d.phase) row.phase = d.phase;
      } else if (scoped) {
        row.found = 0;
        row.withEmail = 0;
      }
      return row;
    });
    const seen = new Set(rows.map(r => r.label));
    byLabel.forEach((d, label) => {
      if (seen.has(label)) return;
      rows.push({
        id: "jobs|" + label, label, phase: d.phase, keyword: "", location: "",
        runs: 0, found: d.found, withEmail: d.withEmail, excluded: d.excluded, excludedNoEmail: 0,
        excludedCompany: 0, excludedDupe: 0, excludedDomain: 0, skipped: 0, failed: 0,
        completeRuns: 0, interrupted: 0, lastRunAt: ""
      });
    });
    return rows;
  }

  function computeKpis(series) {
    const jobs = jobsCache.filter(inRange);
    const total = jobs.length;
    const withEmail = jobs.filter(jobHasKeptEmail).length;
    const composed = jobs.filter(j => j.composed === "Yes").length;
    const excluded = series.excluded.reduce((a, b) => a + b, 0);
    const executed = (series.runs || []).reduce((a, b) => a + b, 0);
    const searches = (series.searches || []).reduce((a, b) => a + b, 0);
    const active = queryRows().filter(r => (r.runs || 0) > 0 || (r.found || 0) > 0);
    const measured = active.filter(r => (r.runs || 0) > 0);
    const runs = measured.reduce((a, q) => a + (q.runs || 0), 0);
    const foundTotal = measured.reduce((a, q) => a + (q.found || 0), 0);
    return {
      total, withEmail, composed, excluded, executed, searches,
      queries: active.length,
      yield: runs ? Math.round((foundTotal / runs) * 100) / 100 : 0
    };
  }

  /* ---------- day-of-week / time-of-day / phase optimisation analytics ---------- */
  // Weekday index (0=Sun..6=Sat) of an IST calendar day "YYYY-MM-DD".
  function dayToWeekday(day) {
    const p = String(day).split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  }
  // IST hour-of-day (0..23) a job was captured, or -1 when unknown.
  function jobIstHour(job) {
    let iso = job.found_at;
    if (!iso && job.date_found && typeof parseDateFound === "function") {
      const d = parseDateFound(job.date_found);
      if (d) iso = d.toISOString();
    }
    if (!iso) return -1;
    const t = new Date(iso);
    if (isNaN(t.getTime())) return -1;
    return toIstDate(t).getUTCHours();
  }

  // "On which weekday do we get the most email posts?" — within the active range.
  function computeWeekdayStats() {
    const stats = {};
    WEEKDAY_ORDER.forEach(i => { stats[i] = { idx: i, label: DAY_NAMES[i], found: 0, withEmail: 0, days: {}, activeDays: 0, lastDay: "" }; });
    jobsCache.forEach(j => {
      const day = jobDay(j);
      if (!day || !inRangeDay(day)) return;
      const s = stats[dayToWeekday(day)];
      if (!s) return;
      s.found++;
      if (jobHasKeptEmail(j)) s.withEmail++;
      if (!s.days[day]) { s.days[day] = 1; s.activeDays++; }
      if (day > s.lastDay) s.lastDay = day;
    });
    const arr = WEEKDAY_ORDER.map(i => {
      const s = stats[i];
      return { idx: i, label: s.label, found: s.found, withEmail: s.withEmail, activeDays: s.activeDays, lastDay: s.lastDay };
    });
    let best = null;
    arr.forEach(a => {
      if (a.withEmail <= 0) return;
      if (!best || a.withEmail > best.withEmail) best = a; // ties keep the earlier weekday (Mon-first)
    });
    return { arr, best };
  }

  // When during the day do emails land? (IST hour blocks) — helps time the runs.
  function computeHourStats() {
    const arr = HOUR_BLOCKS.map(b => ({ label: b.label, found: 0, withEmail: 0 }));
    jobsCache.forEach(j => {
      const day = jobDay(j);
      if (!day || !inRangeDay(day)) return;
      const h = jobIstHour(j);
      if (h < 0) return;
      const bi = HOUR_BLOCKS.findIndex(b => h >= b.lo && h < b.hi);
      if (bi < 0) return;
      arr[bi].found++;
      if (jobHasKeptEmail(j)) arr[bi].withEmail++;
    });
    let best = null;
    arr.forEach(a => { if (a.withEmail <= 0) return; if (!best || a.withEmail > best.withEmail) best = a; });
    return { arr, best };
  }

  // Which phase (jobs feed vs posts feed) actually yields emails.
  function computePhaseStats() {
    const m = new Map();
    jobsCache.forEach(j => {
      const day = jobDay(j);
      if (!day || !inRangeDay(day)) return;
      const ph = j.phase || "other";
      const e = m.get(ph) || { phase: ph, found: 0, withEmail: 0 };
      e.found++;
      if (jobHasKeptEmail(j)) e.withEmail++;
      m.set(ph, e);
    });
    const arr = Array.from(m.values()).sort((a, b) => (b.withEmail - a.withEmail) || (b.found - a.found));
    return { arr, best: arr[0] || null };
  }

  /* ---------- charts ---------- */
  function drawTimeSeries(host, series) {
    const w = Math.max(320, host.clientWidth || host.parentElement.clientWidth || 620);
    const h = 210, padL = 38, padR = 10, padT = 12, padB = 28;
    const n = series.labels.length;
    let root = host.querySelector("svg");
    if (!root) {
      root = svg("svg", { class: "chart-svg", viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "none" });
      host.appendChild(root);
    }
    root.setAttribute("viewBox", "0 0 " + w + " " + h);
    clear(root);
    if (!n) {
      const t = svg("text", { x: w / 2, y: h / 2, "text-anchor": "middle", class: "chart-empty" });
      t.textContent = "No data yet — run a search";
      root.appendChild(t);
      host._anim = {};
      const oldTip = host.querySelector(".chart-tip");
      if (oldTip) { oldTip.style.display = "none"; oldTip.textContent = ""; }
      host._ts = { n: 0, w, h, series, keys: series.keys || [], mode: series.mode || range, labels: series.labels, peak: -1, guide: null, dots: [], tip: null };
      bindHover(host);
      tsLeave(host);
      const cap0 = $("peakCaption"); if (cap0) cap0.textContent = "";
      return;
    }
    const maxV = Math.max(1, ...series.found, ...series.excluded);
    const x = i => padL + (n === 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (n - 1));
    const y = v => h - padB - (v / maxV) * (h - padT - padB);

    // query-run intensity drawn behind the lines: how many runs produced each point
    const runsArr = series.runs || [];
    const maxRuns = Math.max(1, ...runsArr);
    const slot = (w - padL - padR) / Math.max(1, n);
    const barW = Math.max(2, slot * 0.5);
    for (let i = 0; i < n; i++) {
      const rv = runsArr[i] || 0;
      if (!rv) continue;
      const bh = (rv / maxRuns) * (h - padT - padB);
      root.appendChild(svg("rect", {
        x: x(i) - barW / 2, y: h - padB - bh, width: barW, height: bh,
        rx: 2, class: "run-bar"
      }));
    }

    for (let g = 0; g <= 4; g++) {
      const gy = padT + g * (h - padT - padB) / 4;
      root.appendChild(svg("line", { x1: padL, x2: w - padR, y1: gy, y2: gy, class: "grid-line" }));
      const lb = svg("text", { x: padL - 6, y: gy + 3, "text-anchor": "end", class: "axis-label" });
      lb.textContent = String(Math.round(maxV * (1 - g / 4)));
      root.appendChild(lb);
    }
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const lb = svg("text", { x: x(i), y: h - 8, "text-anchor": "middle", class: "axis-label" });
      lb.textContent = series.labels[i];
      root.appendChild(lb);
    }
    const pathFound = svg("path", { class: "line-found" });
    const pathExcl = svg("path", { class: "line-excluded" });
    const areaFound = svg("path", { class: "area-found" });
    const areaExcl = svg("path", { class: "area-excluded" });
    root.appendChild(areaExcl); root.appendChild(areaFound);
    root.appendChild(pathExcl); root.appendChild(pathFound);
    const rangePeak = computeRangePeak(series);
    const dots = [];
    for (let i = 0; i < n; i++) {
      const isPeak = i === rangePeak && series.found[i] > 0;
      const c1 = svg("circle", { r: isPeak ? 3.6 : 2.6, class: isPeak ? "dot-found dot-peak" : "dot-found" });
      const c2 = svg("circle", { r: isPeak ? 3.6 : 2.6, class: "dot-excluded" });
      root.appendChild(c2); root.appendChild(c1);
      dots.push([c1, c2]);
    }
    const legend = svg("g", { class: "legend" });
    [["Emails found", "dot-found", 0], ["Excluded", "dot-excluded", 96], ["Query runs", "run-bar", 186]].forEach(([label, cls, dx]) => {
      legend.appendChild(svg("rect", { x: padL + dx, y: 2, width: 8, height: 8, class: cls }));
      const t = svg("text", { x: padL + dx + 12, y: 10, class: "axis-label" });
      t.textContent = label; legend.appendChild(t);
    });
    root.appendChild(legend);

    const guide = svg("line", { class: "guide-line" });
    guide.style.opacity = "0";
    root.appendChild(guide);
    let tip = host.querySelector(".chart-tip");
    if (!tip) { tip = el("div", "chart-tip"); host.appendChild(tip); }
    else { tip.style.display = "none"; tip.textContent = ""; }
    host._ts = {
      n, w, h, padL, padR, padT, padB, x, y, series,
      keys: series.keys || [], mode: series.mode || range,
      labels: series.labels, peak: rangePeak, guide, dots, tip
    };
    bindHover(host);

    function paint(fArr, eArr) {
      const fPts = fArr.map((v, i) => x(i) + "," + y(v));
      const ePts = eArr.map((v, i) => x(i) + "," + y(v));
      pathFound.setAttribute("d", "M" + fPts.join(" L"));
      pathExcl.setAttribute("d", "M" + ePts.join(" L"));
      areaFound.setAttribute("d", "M" + x(0) + "," + (h - padB) + " L" + fPts.join(" L") + " L" + x(n - 1) + "," + (h - padB) + " Z");
      areaExcl.setAttribute("d", "M" + x(0) + "," + (h - padB) + " L" + ePts.join(" L") + " L" + x(n - 1) + "," + (h - padB) + " Z");
      for (let i = 0; i < n; i++) {
        dots[i][0].setAttribute("cx", x(i)); dots[i][0].setAttribute("cy", y(fArr[i]));
        dots[i][1].setAttribute("cx", x(i)); dots[i][1].setAttribute("cy", y(eArr[i]));
      }
    }
    const prevF = host._anim && host._anim.tsFound;
    const prevE = host._anim && host._anim.tsExcl;
    host._raf = host._raf || {};
    host._anim = host._anim || {};
    if (prevF && prevE && prevF.length === n && prevE.length === n) {
      if (host._raf.ts) cancelAnimationFrame(host._raf.ts);
      const fromF = prevF.slice(), fromE = prevE.slice(), t0 = performance.now(), dur = 520;
      const tick = t => {
        const p = Math.min(1, (t - t0) / dur), e2 = 1 - Math.pow(1 - p, 3);
        paint(
          fromF.map((v, i) => v + (series.found[i] - v) * e2),
          fromE.map((v, i) => v + (series.excluded[i] - v) * e2)
        );
        if (p < 1) host._raf.ts = requestAnimationFrame(tick);
      };
      host._raf.ts = requestAnimationFrame(tick);
    } else {
      paint(series.found, series.excluded);
    }
    host._anim.tsFound = series.found.slice();
    host._anim.tsExcl = series.excluded.slice();

    const cap = $("peakCaption");
    if (cap) {
      const peakRuns = (series.runs || [])[rangePeak];
      cap.textContent = rangePeak >= 0
        ? "Peak: " + seriesFullLabel(series, rangePeak) + " · " + series.found[rangePeak] +
          (series.found[rangePeak] === 1 ? " email" : " emails") +
          (peakRuns ? " · " + peakRuns + (peakRuns === 1 ? " run" : " runs") : "")
        : "";
    }
  }

  /* ---------- time-series hover ---------- */
  function seriesFullLabel(series, i) {
    const key = (series.keys || [])[i];
    if (key != null) return bucketFullLabel(key, series.mode || range);
    return (series.labels && series.labels[i]) || "";
  }

  // Secondary tooltip line: the exact weekday (day buckets) or the full
  // Monday–Sunday date span (week buckets) so runs can be compared day-wise.
  function seriesSubLabel(series, i) {
    const key = (series.keys || [])[i];
    const mode = series.mode || range;
    if (key == null || key === "all") return "";
    const p = String(key).split("-").map(Number);
    if (mode === "day") {
      const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
      if (isNaN(dt.getTime())) return "";
      return DAY_FULL[dt.getUTCDay()];
    }
    if (mode === "week") {
      const start = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
      if (isNaN(start.getTime())) return "";
      const end = new Date(start.getTime() + 6 * 86400000);
      return DAY_NAMES[start.getUTCDay()] + " " + start.getUTCDate() + " " + MONTH_SHORT[start.getUTCMonth()] +
        " – " + DAY_NAMES[end.getUTCDay()] + " " + end.getUTCDate() + " " + MONTH_SHORT[end.getUTCMonth()] + " " + end.getUTCFullYear();
    }
    return "";
  }

  function bindHover(host) {
    if (host._hoverBound) return;
    host._hoverBound = true;
    const move = ev => tsMove(host, ev);
    const leave = () => tsLeave(host);
    host.addEventListener("mousemove", move);
    host.addEventListener("pointermove", move);
    host.addEventListener("mouseleave", leave);
    host.addEventListener("pointerleave", leave);
  }

  function tsBaseR(ts, i) { return (i === ts.peak && ts.series.found[i] > 0) ? 3.6 : 2.6; }

  function tsHide(host) {
    const ts = host._ts;
    if (!ts) return;
    if (ts.guide) ts.guide.style.opacity = "0";
    if (ts.tip) ts.tip.style.display = "none";
  }

  function tsLeave(host) {
    const ts = host._ts;
    if (!ts) return;
    if (ts.guide) ts.guide.style.opacity = "0";
    if (ts.tip) ts.tip.style.display = "none";
    if (ts.dots) for (let i = 0; i < ts.dots.length; i++) {
      const r = tsBaseR(ts, i);
      ts.dots[i][0].setAttribute("r", r);
      ts.dots[i][1].setAttribute("r", r);
    }
  }

  function tsMove(host, ev) {
    const ts = host._ts;
    if (!ts || !ts.n) { tsHide(host); return; }
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = (ev.clientX - rect.left) / rect.width * ts.w;
    let idx = 0, bestD = Infinity;
    for (let i = 0; i < ts.n; i++) {
      const d = Math.abs(ts.x(i) - svgX);
      if (d < bestD) { bestD = d; idx = i; }
    }
    tsShow(host, ts, idx, rect);
  }

  function tsShow(host, ts, idx, rect) {
    if (ts.guide) {
      const gx = ts.x(idx);
      ts.guide.setAttribute("x1", gx); ts.guide.setAttribute("x2", gx);
      ts.guide.setAttribute("y1", ts.padT); ts.guide.setAttribute("y2", ts.h - ts.padB);
      ts.guide.style.opacity = "1";
    }
    for (let i = 0; i < ts.dots.length; i++) {
      const r = i === idx ? tsBaseR(ts, i) + 2 : tsBaseR(ts, i);
      ts.dots[i][0].setAttribute("r", r);
      ts.dots[i][1].setAttribute("r", r);
    }
    const tip = ts.tip;
    if (!tip) return;
    clear(tip);
    tip.appendChild(el("div", "tip-title", seriesFullLabel(ts.series, idx)));
    const sub = seriesSubLabel(ts.series, idx);
    if (sub) tip.appendChild(el("div", "tip-line tip-sub", sub));
    tip.appendChild(el("div", "tip-line", "Emails found: " + ts.series.found[idx]));
    tip.appendChild(el("div", "tip-line", "Excluded: " + ts.series.excluded[idx]));
    const tRuns = (ts.series.runs || [])[idx];
    if (typeof tRuns === "number") tip.appendChild(el("div", "tip-line", "Query runs: " + tRuns));
    if (idx === ts.peak) tip.appendChild(el("div", "tip-line tip-peak", "\u2605 Peak for this range"));
    tip.style.display = "block";
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const px = ts.x(idx) * (rect.width / ts.w);
    const py = Math.min(ts.y(ts.series.found[idx]), ts.y(ts.series.excluded[idx])) * (rect.height / ts.h);
    let left = px + 12, top = py - th - 10;
    left = Math.max(4, Math.min(left, rect.width - tw - 4));
    top = Math.max(4, Math.min(top, rect.height - th - 4));
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function drawBarChart(host, labels, values, colorClass) {
    const w = Math.max(300, host.clientWidth || host.parentElement.clientWidth || 320);
    const rowH = 22, padL = 4, padR = 46;
    const n = labels.length;
    const h = Math.max(60, n * rowH + 8);
    let root = host.querySelector("svg");
    if (!root) { root = svg("svg", { class: "chart-svg" }); host.appendChild(root); }
    root.setAttribute("viewBox", "0 0 " + w + " " + h);
    root.style.height = h + "px";
    clear(root);
    if (!n) {
      const t = svg("text", { x: w / 2, y: h / 2, "text-anchor": "middle", class: "chart-empty" });
      t.textContent = "No data yet";
      root.appendChild(t);
      host._anim = {};
      return;
    }
    const maxV = Math.max(1, ...values);
    const bars = [], texts = [], vals = [];
    for (let i = 0; i < n; i++) {
      const yy = 6 + i * rowH;
      const r = svg("rect", { x: padL, y: yy, height: rowH - 6, rx: 4, class: "bar " + (colorClass || "bar-found"), width: 0 });
      const t = svg("text", { x: padL + 4, y: yy + (rowH - 6) / 2 + 3, class: "bar-label" });
      t.textContent = labels[i].length > 34 ? labels[i].slice(0, 33) + "…" : labels[i];
      const v = svg("text", { x: w - padR + 6, y: yy + (rowH - 6) / 2 + 3, class: "bar-value" });
      root.appendChild(r); root.appendChild(t); root.appendChild(v);
      bars.push(r); texts.push(t); vals.push(v);
    }
    function paint(arr) {
      for (let i = 0; i < n; i++) {
        const bw = Math.max(2, (arr[i] / maxV) * (w - padL - padR));
        bars[i].setAttribute("width", bw);
        vals[i].textContent = String(Math.round(arr[i]));
      }
    }
    animateNumeric(host, "bars" + (colorClass || ""), values, paint);
  }

  /* ---------- table ---------- */
  // Dead/Low decision for auto-disabling queries. Only a FULLY COMPLETED run
  // counts as a "complete run" — interrupted attempts (user skip mid-run, resumed
  // sessions) are tracked separately and shown, but never make a query look dead.
  // Rows written before `completeRuns` existed are skipped entirely: their legacy
  // `runs` counted every attempt, so they must never be treated as complete.
  function queryFlag(e) {
    if (e.completeRuns == null) return null;
    const found = e.found || 0;
    const complete = e.completeRuns || 0;
    const interrupted = e.interrupted || 0;
    const min = deadQueryRuns || 3;
    if (complete >= min && found === 0) return { label: "Dead", cls: "flag-dead", dead: true, complete: complete, interrupted: interrupted };
    if (complete >= min && (found / complete) < lowYieldRatio) return { label: "Low", cls: "flag-low", complete: complete, interrupted: interrupted };
    return null;
  }

  function renderQueryTable(disabled) {
    const tb = $("queryStatsBody"), empty = $("queryStatsEmpty");
    if (!tb) return;
    clear(tb);
    const list = queryRows().sort((a, b) => ((b.found || 0) - (a.found || 0)) || ((b.runs || 0) - (a.runs || 0)));
    if (!list.length) { if (empty) empty.style.display = "block"; return; }
    if (empty) empty.style.display = "none";
    list.forEach(e => {
      const tr = document.createElement("tr");
      const qTd = el("td"); qTd.textContent = e.label || e.id || "-"; qTd.title = e.label || e.id || ""; qTd.className = "query-cell";
      tr.appendChild(qTd);
      tr.appendChild(el("td", null, e.phase || "-"));
      const complete = (e.completeRuns != null) ? (e.completeRuns || 0) : (e.runs || 0);
      const interrupted = e.interrupted || 0;
      const runsTd = el("td", null, String(e.runs || 0));
      if (complete !== (e.runs || 0) || interrupted) {
        runsTd.title = "Completed runs: " + complete + " · Interrupted: " + interrupted + " · Total attempts: " + (e.runs || 0);
      }
      tr.appendChild(runsTd);
      tr.appendChild(el("td", null, String(e.found || 0)));
      tr.appendChild(el("td", null, String(e.withEmail || 0)));
      // "Excluded" = emails dropped because their domain is on the user's
      // excluded-domain list (not no-email / company / duplicate skips).
      const exclTd = el("td", null, String(e.excluded || e.excludedDomain || 0));
      exclTd.title = "Emails dropped because their domain is on your excluded list";
      tr.appendChild(exclTd);
      const runs = e.runs || 0;
      tr.appendChild(el("td", null, runs ? (Math.round(((e.found || 0) / runs) * 100) / 100) : "0"));
      const flag = queryFlag(e);
      const fTd = el("td");
      if (flag) fTd.appendChild(el("span", "q-flag " + flag.cls, flag.label));
      if (interrupted > 0) {
        const note = el("span", "q-int", (flag ? " · " : "") + interrupted + " interrupted");
        note.title = "Interrupted runs never count as complete runs for the dead-query decision.";
        fTd.appendChild(note);
      }
      tr.appendChild(fTd);
      tr.appendChild(el("td", null, e.lastRunAt ? new Date(e.lastRunAt).toLocaleDateString() : "-"));
      const td = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = disabled.indexOf(e.label) === -1;
      cb.addEventListener("change", async () => {
        await Storage.setQueryDisabled(e.label, !cb.checked);
        await render(true);
      });
      td.appendChild(cb);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
  }

  /* ---------- hiring words ---------- */
  function scanWords() {
    const counts = new Map(), big = new Map();
    jobsCache.forEach(j => {
      if (wordScope === "email" && !j.email) return;
      const text = ((j.full_post || "") + " " + (j.position || "") + " " + (j.company || "")).toLowerCase();
      const toks = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
      for (let i = 0; i < toks.length; i++) {
        counts.set(toks[i], (counts.get(toks[i]) || 0) + 1);
        if (i + 1 < toks.length) {
          const bg = toks[i] + " " + toks[i + 1];
          big.set(bg, (big.get(bg) || 0) + 1);
        }
      }
    });
    const top = m => Array.from(m.entries())
      .filter(([, c]) => c >= wordMinCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, wordTopN);
    return { unigrams: top(counts), bigrams: top(big) };
  }

  function renderWordList(hostId, pairs) {
    const host = $(hostId);
    if (!host) return;
    clear(host);
    if (!pairs.length) { host.appendChild(el("p", "empty-msg", "No matches")); return; }
    pairs.forEach(([word, count]) => {
      const row = el("div", "word-row");
      row.appendChild(el("span", "word-text", word));
      const barWrap = el("div", "word-bar");
      const bar = el("div", "word-fill");
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(el("span", "word-count", String(count)));
      host.appendChild(row);
      const max = pairs[0][1];
      requestAnimationFrame(() => { bar.style.width = Math.max(3, (count / max) * 100) + "%"; });
    });
  }

  function renderPeakInsights() {
    const host = $("peakInsights");
    if (!host) return;
    clear(host);
    const peaks = computePeaks();
    const defs = [["day", "Best day"], ["week", "Best week"], ["month", "Best month"], ["year", "Best year"]];
    let any = false;
    defs.forEach(([k, lab]) => {
      const p = peaks[k];
      if (!p) return;
      any = true;
      host.appendChild(el("span", "peak-chip",
        lab + " · " + p.label + " · " + p.found + (p.found === 1 ? " email" : " emails") + " (all-time)"));
    });
    const wk = computeWeekdayStats();
    if (wk.best) {
      any = true;
      host.appendChild(el("span", "peak-chip peak-weekday",
        "Most emails on " + wk.best.label + " · " + wk.best.withEmail + " (range)"));
    }
    const ph = computePhaseStats();
    if (ph.best && ph.arr.length > 1) {
      any = true;
      host.appendChild(el("span", "peak-chip",
        "Best feed · " + ph.best.phase + " · " + ph.best.withEmail + " emails (range)"));
    }
    if (!any) host.appendChild(el("span", "peak-chip peak-empty", "No data yet"));
  }

  function renderWeekday() {
    const host = $("chartWeekday");
    if (!host) return;
    const { arr, best } = computeWeekdayStats();
    drawBarChart(host, arr.map(a => a.label), arr.map(a => a.withEmail), "bar-day");
    const cap = $("weekdayCaption");
    if (cap) {
      cap.textContent = best
        ? best.label + " leads with " + best.withEmail + (best.withEmail === 1 ? " email" : " emails") +
          (best.lastDay ? " · last on " + bucketFullLabel(best.lastDay, "day") : "") +
          " · " + best.activeDays + " active day" + (best.activeDays === 1 ? "" : "s")
        : "No emails in this range yet";
    }
  }

  function renderHour() {
    const host = $("chartHour");
    if (!host) return;
    const { arr, best } = computeHourStats();
    drawBarChart(host, arr.map(a => a.label), arr.map(a => a.withEmail), "bar-hour");
    const cap = $("hourCaption");
    if (cap) cap.textContent = best
      ? best.label + " yields the most emails (" + best.withEmail + ")"
      : "No emails in this range yet";
  }

  /* ---------- render entry ---------- */
  async function render(force) {
    if (view !== "analytics") return;
    try {
      [jobsCache, queryStatsCache] = await Promise.all([Storage.getJobs(), Storage.getQueryStats()]);
      dailyCache = await Storage.getDailyStats();
      try {
        const prefs = await Storage.getPreferences();
        excludedDomains = (prefs.excludedEmailDomains || []).map(d => String(d).toLowerCase().trim()).filter(Boolean);
      } catch (e2) { excludedDomains = []; }
    } catch (e) { return; }
    if (autoDisableDead) {
      const dead = queryStatsCache.filter(e => queryFlag(e) && queryFlag(e).dead).map(e => e.label).filter(Boolean);
      if (dead.length) {
        const disabled = await Storage.getDisabledQueries();
        const add = dead.filter(l => disabled.indexOf(l) === -1);
        if (add.length) { await Storage.setDisabledQueries(disabled.concat(add)); queryStatsCache = await Storage.getQueryStats(); }
      }
    }
    const disabled = await Storage.getDisabledQueries();
    const series = buildSeries();
    const kpis = computeKpis(series);

    const map = { kpiTotal: kpis.total, kpiEmail: kpis.withEmail, kpiComposed: kpis.composed, kpiExcluded: kpis.excluded, kpiQueries: kpis.queries, kpiExec: kpis.executed, kpiSearches: kpis.searches };
    Object.keys(map).forEach(id => { const node = $(id); if (node) countUp(node, map[id]); });
    const yieldNode = $("kpiYield");
    if (yieldNode) { yieldNode.textContent = String(kpis.yield); yieldNode._v = kpis.yield; }
    lastKpis = kpis;

    drawTimeSeries($("chartTimeSeries"), series);
    renderPeakInsights();
    renderWeekday();
    renderHour();

    const top = queryRows().filter(q => (q.found || 0) > 0).sort((a, b) => (b.found || 0) - (a.found || 0)).slice(0, 8);
    drawBarChart($("chartPerQuery"), top.map(q => q.label || q.id || "-"), top.map(q => q.found || 0), "bar-found");

    renderQueryTable(disabled);

    const w = scanWords();
    renderWordList("wordList", showUnigrams ? w.unigrams : []);
    renderWordList("bigramList", showBigrams ? w.bigrams : []);
  }

  /* ---------- view switching ---------- */
  function setView(v) {
    view = v;
    const rv = $("resultsView"), av = $("analyticsView");
    if (rv) rv.style.display = v === "results" ? "" : "none";
    if (av) av.style.display = v === "analytics" ? "" : "none";
    const br = $("viewResults"), ba = $("viewAnalytics");
    if (br) br.classList.toggle("active", v === "results");
    if (ba) ba.classList.toggle("active", v === "analytics");
    if (v === "analytics") render(true);
  }

  function syncControls() {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.toggle("active", b.dataset.range === range));
    const cb = $("autoDisableDead"); if (cb) cb.checked = autoDisableDead;
    const dq = $("deadQueryRuns"); if (dq) dq.value = deadQueryRuns;
    const sc = document.querySelectorAll(".word-range-btn");
    sc.forEach(b => b.classList.toggle("active", b.dataset.scope === wordScope));
    const u = $("wordUnigrams"); if (u) u.checked = showUnigrams;
    const g = $("wordBigrams"); if (g) g.checked = showBigrams;
    const tn = $("wordTopN"); if (tn) tn.value = wordTopN;
    const mc = $("wordMinCount"); if (mc) mc.value = wordMinCount;
  }

  async function init() {
    await loadSettings();
    syncControls();
    const br = $("viewResults"), ba = $("viewAnalytics");
    if (br) br.addEventListener("click", () => setView("results"));
    if (ba) ba.addEventListener("click", () => setView("analytics"));
    document.querySelectorAll(".range-btn").forEach(b => b.addEventListener("click", async () => {
      range = b.dataset.range; await saveSettings(); syncControls(); render(true);
    }));
    const rd = $("btnRefreshAnalytics");
    if (rd) rd.addEventListener("click", () => render(true));
    const cl = $("btnClearAnalytics");
    if (cl) cl.addEventListener("click", async () => {
      if (!confirm("Reset analytics history (per-query stats, daily counts, disabled queries)?")) return;
      await Storage.clearAnalytics();
      await render(true);
    });
    const ad = $("autoDisableDead");
    if (ad) ad.addEventListener("change", async () => { autoDisableDead = ad.checked; await saveSettings(); render(true); });
    const dq = $("deadQueryRuns");
    if (dq) dq.addEventListener("change", async () => { deadQueryRuns = Math.max(1, Math.min(50, +dq.value || 3)); dq.value = deadQueryRuns; await saveSettings(); render(true); });
    document.querySelectorAll(".word-range-btn").forEach(b => b.addEventListener("click", async () => {
      wordScope = b.dataset.scope; await saveSettings(); syncControls(); render(true);
    }));
    const u = $("wordUnigrams"); if (u) u.addEventListener("change", async () => { showUnigrams = u.checked; await saveSettings(); render(true); });
    const g = $("wordBigrams"); if (g) g.addEventListener("change", async () => { showBigrams = g.checked; await saveSettings(); render(true); });
    const tn = $("wordTopN"); if (tn) tn.addEventListener("change", async () => { wordTopN = Math.max(5, Math.min(100, +tn.value || 20)); tn.value = wordTopN; await saveSettings(); render(true); });
    const mc = $("wordMinCount"); if (mc) mc.addEventListener("change", async () => { wordMinCount = Math.max(1, Math.min(50, +mc.value || 2)); mc.value = wordMinCount; await saveSettings(); render(true); });
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => render(false), 200); });
  }

  return {
    init, setView, render,
    refresh: render,
    isAnalyticsView: () => view === "analytics",
    setJobs() { if (view === "analytics") render(true); }
  };
})();
