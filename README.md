# LinkedIn Job Finder Chrome Extension

A Chrome extension to search LinkedIn job listings and posts, extract email addresses, automate Gmail outreach, track applications, and export data to CSV/XLS — all running **100% locally** with no external APIs or servers.

> ⭐ **Star this repo** if you find it useful!

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Branches](#branches)
- [Installation (Step-by-Step)](#installation-step-by-step)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Project Flows](#project-flows)
  - [Flow 1: Job / Post Search](#flow-1-job--post-search)
  - [Flow 2: Gmail Email Compose & Auto-Send](#flow-2-gmail-email-compose--auto-send)
  - [Flow 3: Right-Click Context Actions](#flow-3-right-click-context-actions)
  - [Flow 4: Dashboard & Export](#flow-4-dashboard--export)
- [Code Flows](#code-flows)
  - [Search code flow (end-to-end call chain)](#search-code-flow-end-to-end-call-chain)
  - [Compose code flow (end-to-end call chain)](#compose-code-flow-end-to-end-call-chain)
  - [Message / Port Map](#message--port-map)
  - [Storage Keys](#storage-keys)
- [Search Speed Options](#search-speed-options)
- [Preferences (Dashboard Settings)](#preferences-dashboard-settings)
- [How to Use](#how-to-use)
- [Dashboard Features](#dashboard-features)
- [How Searching Works](#how-searching-works)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)
- [Notes](#notes)
- [Disclaimer](#disclaimer)
- [Support](#support)

---

## Overview

LinkedIn Job Finder automates the repetitive parts of job hunting on LinkedIn:

1. **Search** — crawls LinkedIn's Jobs and Posts search results using your keywords, locations, and filters.
2. **Extract** — pulls job details, poster profiles, and email addresses (including obfuscated ones like `john [at] company [dot] com`).
3. **Outreach** — composes personalized emails in Gmail (optionally auto-sends) and pastes connection notes / DMs on LinkedIn.
4. **Track & Export** — stores everything locally, shows live stats, and exports to CSV/Excel.

**Key design points:**

- **No backend, no API keys, no AI services.** All parsing is regex/heuristic based (`utils/parser.js`). All automation is DOM-driven.
- **No LinkedIn API / OAuth.** It drives your logged-in LinkedIn web UI — you must be signed in.
- **No Gmail API / SMTP.** It automates the Gmail compose dialog directly in the browser tab.
- **Manifest V3** with a classic service worker (`importScripts`), plain vanilla JS/HTML/CSS — **no build step, no npm**.

---

## Features

### Searching
- **Dual search modes**: Jobs, Posts, or Both (jobs first, then posts)
- Query matrix: roles × locations × target companies × date filters
- Job filters: Easy Apply, posted-within 1/7/30 days, first-page-only, max-per-run, exclude companies, only-with-email
- Fuzzy keyword matching: 70% word threshold for multi-word roles + hiring-signal lexicon
- Anti-detection: randomized human-like delays, 3 speed presets
- Triple dedupe: job ID, poster+position, post activity URN
- Session resume across page reloads
- Live controls: Start / Stop / Skip query / Pause / Resume, progress bar, toolbar badge, desktop notifications

### Email Intelligence
- Email extraction from job descriptions and posts
- Obfuscated format support: `[at]`, `(at)`, `{at}`, `[dot]`, `[remove]`, `mailto:` links
- False-positive filtering (`.png`, `example.com`, `sentry.io`, `linkedin.com`, job-title words)
- Also extracts phone numbers, years of experience, skills, location hints

### Outreach / Gmail Automation
- Batch "Compose in Gmail" with live progress log
- Persistent **Compose mode** — keeps processing new jobs until you stop
- **Auto-send** in realtime or batch mode, with domain blocklist and cross-session sent-dedupe
- Configurable per-field typing speed and random inter-email delay
- Resume attachment (stored as base64, injected via native file-input setter)

### Right-Click Helpers
- **Compose and send** to any selected email on LinkedIn
- **Paste connection note** (200-char cap, verified against React re-renders, pierces shadow DOM/iframes)
- **Paste LinkedIn DM** template + auto-attach resume

### UI Surfaces
- **Popup** — quick controls + split search/compose logs
- **Dashboard** — full settings sidebar, stats bar, filterable results table, manual-sends ledger
- **In-page panel** — optional control docked inside the LinkedIn page (collapsible, auto-reconnecting)

### Export / Persistence
- CSV and Excel-compatible XLS export via `chrome.downloads`
- Jobs in `chrome.storage.local`, preferences synced via `chrome.storage.sync`

---

## Branches

| Branch | Description |
|--------|-------------|
| **main** | Stable releases — production-ready code |
| **dev** | Beta updates — latest features, may be unstable |

---

## Installation (Step-by-Step)

### 1. Download the extension

- **Stable version**: Clone or download the `main` branch
- **Beta version**: Clone or download the `dev` branch for latest features

```bash
# Clone the repo (stable)
git clone -b main https://github.com/nachiiiket/linkedin_job_search_chrome_extension.git

# Or download as ZIP from https://github.com/nachiiiket/linkedin_job_search_chrome_extension
```

### 2. Open Chrome extensions page

- Open **Google Chrome** (or Brave, Edge, any Chromium browser)
- Navigate to `chrome://extensions` in the address bar

### 3. Enable Developer Mode

- Toggle **Developer mode** on (top-right corner)

### 4. Load the extension

- Click **Load unpacked**
- Navigate to the downloaded package
- Select the **`extension`** folder (not the root project folder)
- The extension icon should appear in your toolbar

### 5. Pin the extension

- Click the extensions puzzle icon in the toolbar
- Find **LinkedIn Job Finder** and click the pin icon

### 6. Login to LinkedIn

- Open [LinkedIn](https://www.linkedin.com) and log in to your account

### 7. Open the Dashboard

- Click the extension icon → click **Dashboard**
- Set your preferences (see below) and click **Save**

---

## Project Structure

```
linkedin_job_finder_chrome_extension/
├── README.md                        # This file
├── feature-gmail-compose.md         # Design/change-log doc for the Gmail compose feature
├── .gitignore
│
└── extension/                       # ← Load THIS folder (chrome://extensions → Load unpacked)
    ├── manifest.json                # MV3 manifest — permissions, scripts, content matches
    ├── background.js                # Service worker — orchestrator, ports, context menus, Gmail loop
    ├── content.js                   # LinkedIn content script — search automation + in-page panel
    ├── gmail-compose.js             # Gmail content script — fills/sends the compose dialog
    ├── popup.html / popup.js        # Toolbar popup — quick controls + live logs
    ├── dashboard.html / dashboard.js# Full-page dashboard — settings, stats, results table
    ├── styles.css                   # Shared stylesheet for popup + dashboard
    ├── icons/
    │   ├── icon_new.png             # The real logo (used everywhere)
    │   └── icon16/48/128.png        # Legacy sizes (unused by manifest)
    └── utils/
        ├── storage.js               # Storage wrapper — jobs, prefs, state, resume, sent-emails
        ├── parser.js                # LinkedinParser — regex email/phone/skill extraction, post parsing
        └── exporter.js              # Exporter — CSV / XLS generation + download
```

**No build tooling.** No `package.json`, no bundler, no transpiler. Load the `extension/` folder directly.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CHROME BROWSER                            │
│                                                                         │
│  ┌──────────────┐   port "popup"    ┌────────────────────────────────┐  │
│  │  popup.html  │◄────────────────► │                                │  │
│  │  popup.js    │                   │      background.js             │  │
│  └──────────────┘                   │      (MV3 Service Worker)      │  │
│                                     │                                │  │
│  ┌──────────────┐   port "dashboard"│  • Port router (popup/dashboard│  │
│  │ dashboard.*  │◄────────────────► │  • start/stop/skip/pause       │  │
│  └──────────────┘                   │  • Gmail compose queue         │  │
│                                     │  • Context menus               │  │
│  ┌──────────────┐  runtime messages │  • Badge + notifications       │  │
│  │ content.js   │◄────────────────► │  • Auto-send realtime/batch    │  │
│  │ (linkedin.com│                   └───────────┬────────────────────┘  │
│  │  content     │                               │ tabs.sendMessage      │
│  │  script)     │                               ▼                       │
│  │  + in-page   │                   ┌────────────────────────────────┐  │
│  │    panel     │                   │  gmail-compose.js              │  │
│  └──────────────┘                   │  (mail.google.com script)      │  │
│                                     │  • fill To/Subject/Body        │  │
│  ┌──────────────┐                   │  • attach resume               │  │
│  │ utils/*.js   │ (importScripts    │  • optional Send               │  │
│  │ storage      │  in background;   └────────────────────────────────┘  │
│  │ parser       │  injected into                                       │
│  │ exporter     │  content script)     ┌─────────────────────────────┐  │
│  └──────────────┘                      │  chrome.storage             │  │
│                                        │  • local: jobs, state,      │  │
│                                        │          resume, sentEmails │  │
│                                        │  • sync:  preferences       │  │
│                                        └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Component responsibilities:**

| Component | File | Role |
|---|---|---|
| Service worker | `background.js` | Central orchestrator: long-lived ports, search start/stop, Gmail compose loop, context menus, badge, notifications |
| LinkedIn content script | `content.js` | Runs on `linkedin.com`: job/post crawling, email extraction, in-page panel UI, paste/attach helpers |
| Gmail content script | `gmail-compose.js` | Runs on `mail.google.com`: opens compose dialog, fills fields, attaches resume, sends |
| Popup | `popup.html/js` | Quick controls and live search/compose logs |
| Dashboard | `dashboard.html/js` | Full settings, stats, results table, manual-sends ledger, exports |
| Storage util | `utils/storage.js` | Single API over `chrome.storage.local` / `chrome.storage.sync` |
| Parser util | `utils/parser.js` | Regex/heuristic extraction of emails, phones, skills, post structure |
| Export util | `utils/exporter.js` | CSV/XLS generation + `chrome.downloads` |

---

## Project Flows

### Flow 1: Job / Post Search

```
User (popup/dashboard/in-page panel)
   │  click "Start Searching"
   ▼
popup.js ──port "popup"──► background.js: startSearching(config)
                              │  1. find LinkedIn tab (getLinkedInTab)
                              │  2. ping content script (isContentScriptReady)
                              │  3. persist state {status:"searching"}
                              │  4. desktop notification
                              ▼
                    tabs.sendMessage → content.js: startSearching
                              │
                              ▼
                    content.js: runAll(cfg)
                              │  set speed factor, compute phases + query matrix
                              ▼
                    runPhase(cfg, phase, i)   ← loops over each query
                              │  navigate → jobsUrl() / postsUrl()
                              ▼
              ┌───────────────┴───────────────┐
              ▼                               ▼
       searchJobs(cfg)                 searchPosts(cfg)
       scroll → getJobIds              expand "See more" → scroll
       → clickCard → extractJob        → dedupe by URN
       → filter (exclude/email)        → textHasKeyword (70% + signals)
       → Storage.saveJob               → LinkedinParser.parsePost
              │                        → Storage.saveJob
              └───────────────┬───────────────┘
                              ▼
              send("jobFound") / send("log") / send("progress")
                              │
          ┌───────────────────┼──────────────────────┐
          ▼                   ▼                      ▼
   background.js         popup.js /            in-page panel
   updateBadge()         dashboard.js          panelSearchLog()
   handleAutoSendJob()   render logs + bar     panelSetProgress()
   (→ Flow 2)
                              │
                              ▼
                    runAll finishes → send("searchingComplete")
                              │
                              ▼
               background: notification + handleAutoSendFlush()
```

**Controls during search:**

| Action | Path |
|---|---|
| **Stop** | UI → `background.stopSearching()` → broadcast to all LinkedIn tabs + persist `stopRequested` → `content.js checkStop()` aborts |
| **Skip query** | UI → `background.broadcastSearchControl("skipQuery")` → `content.js triggerSkip()` resolves the skip race |
| **Pause / Resume** | UI → sets `chrome.storage.local.searchPaused` → `content.js waitWhilePaused()` blocks between steps |
| **Page reload** | `content.js` saves `activeSearchConfig` → `init()` auto-resumes the interrupted session |

---

### Flow 2: Gmail Email Compose & Auto-Send

**Manual batch compose:**

```
User fills Subject/Body (dashboard Email pane or popup)
   │  click "Compose in Gmail"
   ▼
port "popup"/"dashboard" → background.js
   │  enableComposeMode → Storage.setComposeState(true)
   │  load jobs → filter: has email && composed !== "Yes"
   ▼
composeInGmail(jobs, port)                     background.js
   │  skip excluded domains (isDomainExcluded)
   │  skip already-sent (Storage.getSentEmails)
   │  getOrWaitGmailTab()  ← polls up to 2 min, prompts user if no Gmail tab
   ▼
loop per job:
   tabs.sendMessage(gmailTab, "fillGmailCompose", {to, subject, body, speed, autoSend})
   │                                            │
   │                                            ▼
   │                                  gmail-compose.js: fillCompose()
   │                                    wait for dialog → set To
   │                                    → wait speed → Subject → Body
   │                                    → attachResume() (base64 → File → input.files)
   │                                    → if autoSend: click Send
   ▼
Storage.markComposed(job_id) + Storage.addSentEmail(to)
broadcastComposeLog() + safePost(port, composeProgress)
random delay (sendMinDelay..sendMaxDelay) → next job
```

**Auto-send during search (realtime or batch):**

```
content.js finds a job with email
   │  send("jobFound")
   ▼
background.js: handleAutoSendJob(job)
   │
   ├─ mode "realtime" ──► _composeQueue ──► processQueue()  (serialized, _isComposing lock)
   │
   └─ mode "batch"   ──► _pendingBatch ──► processBatch() when size ≥ batchSize
                                          └─ flushed on "searchingComplete"
                                                   │
                                                   ▼
                                            composeInGmail(...)  → same path as above
```

---

### Flow 3: Right-Click Context Actions

Three context menus are registered in `background.createContextMenus()`:

**1. "Compose and send" (selected email / mailto link on LinkedIn)**

```
contextmenu on LinkedIn
   │  content.js captureMenuContext(e) — captures post URL + poster synchronously
   ▼
contextMenus.onClicked → extractEmailFromContext()
   │  (mailto link or selected text → LinkedinParser.regexExtract)
   ▼
composeManualEmail(email, tab)
   │  blocklist check → sent check
   │  tabs.sendMessage(tab, "getContextMenuInfo") → poster context
   │  Storage.saveManualEmail  → shown in dashboard "Manual Sends" tab
   ▼
queue → _composeQueue → Gmail compose (if tab ready)
        else flushed by chrome.tabs.onUpdated when Gmail finishes loading
```

**2. "Paste connection note" (editable field)**

```
contextMenus.onClicked → pasteTemplateToTab(tab, "pasteConnectionNote", ...)
   ▼
content.js: pasteConnectionNote → pasteNoteWithVerify(text)
   │  pierce same-origin iframes + shadow roots (queryAllFrames)
   │  setEditableText() — 4-tier strategy:
   │    native prototype setter → setRangeText → execCommand → textContent
   │  verify value survived React re-render → retry ×4 (200-char cap)
   ▼
success/fail notification
```

**3. "Paste LinkedIn DM"**

```
contextMenus.onClicked → pasteTemplateToTab(tab, "pasteLinkedInDm", ...)
   ▼
content.js: pasteLinkedInDm
   │  findDmComposer() / getEditableTarget()
   │  setEditableText(template)
   │  attachResumeToLinkedInMessage() — resume File → DataTransfer → native files setter
   ▼
success/fail notification
```

---

### Flow 4: Dashboard & Export

```
chrome.tabs.create({url: "dashboard.html"})
   ▼
dashboard.js connect() ──port "dashboard"──► background.js
   │  getPreferences → populateForm(prefs)
   │  getJobs        → renderJobs(jobs)
   │  getState       → updateState(stats)
   ▼
User actions:
   • Switch sidebar panes (Jobs / Posts / Email)
   • Switch filter tabs (All / With Email / Without Email / Manual Sends)
   • Save preferences → Storage.savePreferences (chrome.storage.sync)
   • Start Jobs / Start Posts / Compose → port actions → background
   • Export CSV / XLS → Exporter.downloadCSV/XLS → chrome.downloads
   • Clear all → port "clearJobs" → Storage.clearJobs
```

---

## Code Flows

### Search code flow (end-to-end call chain)

**Entry points** (all converge on `background.startSearching`):

- `popup.js` → Start button → `port.postMessage({action:"startSearching", config})`
- `dashboard.js` → `send("startSearching", cfg)` on port `"dashboard"`
- `content.js` in-page panel → `panelPost("startSearching", cfg)`
- `background.js` runtime fallback for `startSearching` (when a port died after SW restart)

**Call chain:**

```
background.js:524  chrome.runtime.onConnect (port "popup" | "dashboard")
  └─► background.js:482  startSearching(config)
        ├─► background.js:123  getLinkedInTab()
        ├─► background.js:130  isContentScriptReady(tabId)   // "ping" round-trip
        ├─► Storage.setState({ status: "searching", ... })
        ├─► notify("Searching Started", ...)
        └─► chrome.tabs.sendMessage(tabId, { action:"startSearching", config })

content.js:1445  chrome.runtime.onMessage → { action:"startSearching" }
  └─► content.js:1399  runAll(cfg)
        ├─► set _speedFactor from cfg.searchSpeed (normal=1, fast=0.35, max=0)
        ├─► buildPhaseQueries(cfg, phase)        // content.js:1303
        │     jobs:  role × location
        │     posts: "Hiring" AND "<role>" [AND "<loc>"] [AND "<company>"] × dateFilter
        └─► for each phase → runPhase(cfg, phase, startIdx)   // content.js:1341
              ├─► persist activeSearchConfig (session resume)
              ├─► navigate: window.location.href = jobsUrl()/postsUrl()
              │     jobsUrl:  content.js:93  (sortBy=DD, f_AL, f_TPR)
              │     postsUrl: content.js:220 (/search/results/content/, sortBy=date_posted)
              ├─► waitEl(...)  // MutationObserver
              ├─► race vs skip signal (_skipResolve / triggerSkip)
              └─► phase runner:
                    JOBS  → content.js:181  searchJobs(cfg)
                              scrollJobs() → getJobIds()  (content.js:126/122)
                              → clickCard(id)             (content.js:131)
                              → extractJob(id)            (content.js:140)
                              → excludeCompanies / onlyWithEmail filters
                              → Storage.saveJob(det)      (utils/storage.js)
                              → send("jobFound")          (content.js:34)
                              → nextJobPage(pg)           (content.js:171)
                    POSTS → content.js:1184 searchPosts(cfg)
                              expandAllOnPage()/clickSeeMore()  (content.js:234/250)
                              → scroll, dedupe via seenIds (URN)
                              → textHasKeyword()          (content.js:314, 70% threshold)
                              → LinkedinParser.parsePost() (utils/parser.js:168)
                              → Storage.saveJob()
                              → send("jobFound")

send() fans out:
  content.js:34  send(a,d) ──► chrome.runtime.sendMessage + in-page panel mirror
      │
      ├─► background.js:449 onMessage
      │     "jobFound"          → updateBadge() (background.js:442)
      │                        → handleAutoSendJob(job) (background.js:102) → compose flow
      │     "searchingComplete" → notify() + handleAutoSendFlush() (background.js:117)
      │                          + broadcastState()
      │     "log"/"progress"/"statsUpdate" → broadcast to popup + dashboard ports
      │
      ├─► popup.js:201 onMessage → #searchLog entries + progress bar
      └─► dashboard.js:401 onMessage → stats + table refresh
```

**Parsing pipeline (jobs & posts):**

```
raw DOM text
  └─► utils/parser.js:36  LinkedinParser.regexExtract(text)
        1. STRAIGHT_EMAIL / MAILTO_RE pass  (real addresses)
        2. if none → normalizeObfuscated()   ([at] → @, [dot] → ., etc.)
        3. filter BAD_EMAIL_PARTS + title-word false positives
        4. also: PHONE_RE, YEARS_RE, location hint
  └─► utils/parser.js:93  extractSkills() against SKILL_WORDS (~60 terms)
  └─► utils/parser.js:110 heuristicParse() / :168 parsePost()
        → structured job record (job_id, position, company, poster, email, notes, ...)
  └─► utils/storage.js  Storage.saveJob()
        dedupe by job_id OR (poster_name + position)
```

---

### Compose code flow (end-to-end call chain)

```
UI "Compose in Gmail"
  └─► port message {action:"composeInGmail"} / {action:"enableComposeMode"}
        background.js:524 onConnect handlers
          ├─► Storage.setComposeState(true)         // compose mode flag
          ├─► Storage.getJobs() → filter: j.email && j.composed!=="Yes"
          └─► background.js:149  composeInGmail(jobs, port)
                ├─► filter: isDomainExcluded(j, excluded)      // background.js:49
                ├─► filter: Storage.getSentEmails() (cross-session dedupe)
                ├─► getOrWaitGmailTab()                        // background.js:12
                │     no Gmail tab → notification "Open Gmail in a tab…"
                │     polls every 2s up to 2 min
                └─► for each job:
                      chrome.tabs.sendMessage(gmailTab, {
                        action: "fillGmailCompose",
                        data: { to, subject, body, speed, autoSend }
                      })
                        └─► gmail-compose.js:70  fillCompose(data)
                              getComposeDialog()/waitForDialog()  // :12/:19
                              set To  → wait composeSpeed
                              set Subject → wait → set Body (innerHTML, <br>)
                              attachResume()  // :36 — base64 chrome.storage.local.resumeFile
                                              //      → Blob → File → native input.files setter
                              if autoSend → click Send
                      ◄── ack ──
                      Storage.markComposed(job.job_id)     // utils/storage.js
                      Storage.addSentEmail(to)
                      broadcastComposeLog(msg)             // background.js:145
                      safePost(port, {action:"composeProgress"})
                      await rand(sendMinDelay, sendMaxDelay)

Auto-send hooks (search → compose):
  content.js "jobFound"
    └─► background.js:102 handleAutoSendJob(job)
          realtime → background.js:55  processQueue()   (_composeQueue, _isComposing lock)
          batch    → background.js:83  processBatch()   (_pendingBatch ≥ batchSize)
    background.js:83/117  processBatch / handleAutoSendFlush
          └─► composeInGmail(pendingJobs, port)   // same path as above
```

---

### Message / Port Map

**Long-lived ports** (named, opened by UI pages):

| Port name | Opened by | Handler |
|---|---|---|
| `popup` | `popup.js` `connect()` | `background.js:524` `onConnect` |
| `dashboard` | `dashboard.js` `connect()` | `background.js:524` `onConnect` |

**Port actions** (both ports): `startSearching`, `stopSearching`, `skipQuery`, `pauseSearching`, `resumeSearching`, `getState`, `openDashboard`, `getJobs`, `exportCSV`, `exportXLS`, `clearJobs`, `getPreferences`, `savePreferences`, `enableComposeMode`, `disableComposeMode`, `composeInGmail`, `abortCompose`.

**Runtime messages** (`chrome.runtime.sendMessage` → `background.js:449`):

| Action | Direction | Meaning |
|---|---|---|
| `jobFound` | content → bg | New job saved; update badge + maybe auto-send |
| `searchingComplete` | content → bg | Phase/queries done; notify + flush batch |
| `log` / `progress` / `statsUpdate` | content → bg → UI | Live log lines, progress %, stats |
| `composeLog` / `composeProgress` | bg → UI | Compose loop feedback |
| `state` / `searchControl` | bg → UI | Search state + control echoes |
| `manualEmailsUpdated` | bg → dashboard | Right-click sends ledger changed |
| `openDashboard`, `startSearching`, ... | any → bg | Fallback when the port is dead (SW restarted) |

**Tab messages** (`chrome.tabs.sendMessage`):

| Action | Target script | Purpose |
|---|---|---|
| `startSearching` / `stopSearching` / `skipQuery` / `pauseSearching` / `resumeSearching` / `ping` | `content.js` | Search control |
| `getContextMenuInfo` | `content.js` | Read captured right-click context |
| `pasteConnectionNote` / `pasteLinkedInDm` | `content.js` | Paste templates |
| `fillGmailCompose` | `gmail-compose.js` | Fill + optionally send an email |

---

### Storage Keys

| Key | Location | Contents |
|---|---|---|
| `jobs` | `local` | Array of job records (`utils/storage.js` `COLUMNS`): `job_id, date_found, position, company, location, poster_name, poster_title, poster_profile_url, job_url, email, applied, connection_sent, composed, notes, full_post, source` |
| `searchState` | `local` | `{ status, stopRequested, ... }` — current search status + stop flag |
| `activeSearchConfig` | `local` | Saved phase/query index/URL for **session resume** after reload |
| `searchPaused` | `local` | Pause flag polled by `content.js waitWhilePaused()` |
| `composeActive` | `local` | Compose mode on/off |
| `resumeFile` | `local` | Resume PDF as base64 — injected into Gmail & LinkedIn DM file inputs |
| `sentEmails` | `local` | Ledger of already-emailed addresses (cross-session dedupe) |
| `manualEmails` | `local` | Right-click "compose and send" records (dashboard **Manual Sends** tab) |
| `preferences` | **sync** | All settings — see Preferences table below |

---

## Search Speed Options

| Option | Multiplier | Description |
|--------|-----------|-------------|
| **Normal** | 1x | Full random delays — safest for avoiding rate limits |
| **Fast** | ~0.35x | Reduced delays — faster search, moderate risk |
| **Max** | 0x | No delays — fastest search |

> ⚠️ **WARNING**: **Max speed (0x delay) is NOT recommended.** It removes all delays between actions, which can:
> - Trigger LinkedIn's bot detection mechanisms
> - Lead to account restrictions or IP blocks
> - Violate LinkedIn's User Agreement
>
> Use **Normal** speed for regular use. Use **Fast** only when you understand the risks.

---

## Preferences (Dashboard Settings)

| Setting | Default | Description |
|---------|---------|-------------|
| **Job Roles** | 17 AI/ML roles (AI Engineer, ML Engineer, Data Scientist, etc.) | Keywords to search for in jobs and posts. One per line. The searcher checks if the post/job matches these keywords using partial matching (70% word threshold for multi-word roles). |
| **Locations** | Pune, Bangalore, Hyderabad | Target cities for job search. One per line. |
| **Target Companies** | (empty) | Company names to include in **post** searches. When set, the post search query becomes: `"Hiring" AND "<role>" AND "<company>"`. |
| **Easy Apply Only** | Enabled | Filters job search to show only LinkedIn Easy Apply listings (`f_AL=true`). |
| **Posted Within Days** | 1 day | Recency filter for jobs. Maps to: 1 day (`r86400`), 7 days (`r604800`), or 30 days (`r2592000`). |
| **First Page Only** | Enabled | When enabled, only searches the first page of job results. Disable to paginate through all available pages. |
| **Only Save With Email** | Disabled | When enabled, only saves entries that contain detected email addresses. Highly recommended for **Posts** mode to get direct-contact leads. |
| **Max Per Run** | 50 | Maximum number of items to collect in a single searching session. |
| **Search Speed** | Normal | Controls delay between actions: Normal (safe), Fast (risky), Max (not recommended). |
| **Search Mode** | Jobs | Selector in the popup — **Jobs**, **Posts**, or **Both** (runs jobs first, then posts). |
| **Email Subject / Body** | (empty) | Template used by Gmail compose. Placeholders: use `{name}`, `{company}` style tokens if supported by your template. |
| **Compose Speed** | 1000 ms | Delay between filling To → Subject → Body. |
| **Connection Note** | (empty) | 200-char note pasted by the right-click menu. |
| **LinkedIn DM Template** | (empty) | Message pasted by the right-click DM menu (resume auto-attached). |
| **Auto-Send** | Off | Enables sending during compose; mode = **realtime** or **batch** (batch size, min/max delay configurable). |
| **Excluded Domains** | (empty) | Email domains to never send to (e.g. `example.com`). |
| **Resume File** | (none) | PDF stored as base64 and attached in Gmail and LinkedIn DMs. |
| **In-Page Panel** | Off | Show the control panel docked inside LinkedIn pages. |
| **Debug Logs** | Off | Verbose `ljfLog()` console output. |

---

## How to Use

### Popup (Quick Start)

1. Click the extension icon in your toolbar
2. Select **Search Mode**: Jobs / Posts / Both
3. Toggle filters: *Only save with email*, *First page only*
4. Select **Speed** (keep Normal for safety)
5. Optionally enter **Target Companies** for post search
6. Click **Start Searching**
7. Watch the live log panel for progress
8. Click **Stop** anytime to interrupt

### Dashboard (Full Control)

1. Click **Dashboard** in the popup, or open `dashboard.html`
2. Configure all preferences and click **Save**
3. Click **Start** to begin searching with the saved settings

### In-Page Panel (Optional)

1. Enable **In-Page Panel** in the popup header or preferences
2. Refresh the LinkedIn page — a dockable panel appears with Searching/Compose tabs, stats, progress, and full controls
3. Collapse/expand with the arrow button; the port auto-reconnects if Chrome unloads the service worker

### Email Compose

1. Fill **Subject** and **Body** in the dashboard's Email pane (or popup compose section)
2. Optionally upload a **resume** and enable **Auto-send** (realtime or batch)
3. Click **Compose in Gmail** — keep a Gmail tab open (the extension will wait/prompt for one)
4. Watch the **compose log**; click **Abort** to stop mid-batch
5. Found jobs with emails can also be auto-composed during search if auto-send is enabled

### Right-Click Helpers

- Select an email on LinkedIn → right-click → **Compose and send**
- On a LinkedIn connection/note field → right-click → **Paste connection note**
- On a LinkedIn message composer → right-click → **Paste LinkedIn DM** (attaches resume)

### Recommended: Posts with Emails

For the best results:
1. Set search mode to **Posts**
2. Enable **Only save with email**
3. Set speed to **Normal**

This will only collect posts that contain email addresses — giving you direct contacts you can reach out to on LinkedIn.

---

## Dashboard Features

| Feature | Description |
|---------|-------------|
| **Stats Bar** | Shows Total found, With Email, Applied, Connected, Composed counts |
| **Filter Tabs** | All / With Email / Without Email / Manual Sends — click to filter results |
| **Results Table** | Displays Position, Company, Location, Poster, Email, Job URL, Profile link, Date found |
| **Open Links** | Click "Open" to visit the job/post URL, "Profile" to view the poster's LinkedIn profile |
| **Settings Sidebar** | Three panes — Jobs / Posts / Email — collapsible with ◀ / ▶ |
| **Export CSV** | Downloads all results as a CSV file |
| **Export XLS** | Downloads all results as an Excel-compatible XLS file |
| **Clear Data** | Deletes all searched results |
| **Manual Sends Tab** | Ledger of right-click "compose and send" actions |
| **Email Extraction** | Automatically detects emails including obfuscated formats: `[at]`, `(dot)`, `{at}`, `[remove]`, and `mailto:` links |

---

## How Searching Works

### Job Search

1. Opens LinkedIn job search with your keywords, location, and filters
2. Scrolls the job list to trigger lazy-loading of all cards
3. Iterates through each job card, clicks it, and extracts:
   - Job title, company, location
   - Poster name, title, profile URL
   - Full job description (first 2000 characters)
   - Email addresses (auto-detected from description)
4. Paginates to the next page until max is reached or no more pages

### Post Search

1. Opens LinkedIn content search with query: `"Hiring" AND "<role>"` (plus companies if set)
2. Expands all "See more" buttons to reveal full post content
3. Checks each post against:
   - **Role keywords** (70% word match threshold)
   - **Hiring signals** (keywords like "hiring", "join us", "opening", etc.)
4. If matched, extracts:
   - Poster name, title, profile URL
   - Post URL (via activity URN or context menu)
   - Email addresses (obfuscated formats supported)
5. Scrolls down for more posts; stops after 3 scrolls with no new content
6. Deduplicates by activity URN (`seenIds` set)

### Resume Support

If the page is reloaded while searching, the extension saves the current phase, query index, and URL. On the next page load, it automatically resumes from where it left off (`content.js init()` → `runAll(activeSearchConfig)`).

---

## Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Save searched job data and user preferences locally |
| `downloads` | Export results as CSV or XLS files |
| `tabs` | Find and interact with LinkedIn and Gmail tabs |
| `notifications` | Show desktop notifications for searching start/complete |
| `contextMenus` | Right-click compose / paste-note / paste-DM actions |
| `https://*.linkedin.com/*` | Access LinkedIn pages for searching |
| `https://mail.google.com/*` | Fill and send the Gmail compose dialog |

---

## Troubleshooting

- **First run — extension not responding**: Refresh the LinkedIn page after adding the extension for the content script to initialize
- **Preferences not saving in dashboard**: Refresh the dashboard page — it may need a reload on first startup
- **Extension not responding**: Refresh the LinkedIn page and try again
- **No results found**: Make sure you are signed in to LinkedIn
- **Searching stuck**: Click **Stop** and restart. Try reducing `Max Per Run`
- **Posts mode finds nothing**: Disable "Only save with email" temporarily to see if posts are being detected
- **Dashboard shows old data**: Click **Refresh** (or close and reopen the dashboard)
- **Service worker died**: Chrome MV3 unloads the service worker after ~5 minutes of inactivity. The extension auto-reconnects when you open the popup (and the in-page panel reconnects after 1.5 s)
- **Compose not working**: Open a Gmail tab first — the extension waits up to 2 minutes and will notify you otherwise
- **Resume not attaching**: Re-upload the resume in the dashboard Email pane; the file lives in `chrome.storage.local.resumeFile`

---

## Notes

- You must be **signed in** to LinkedIn (and Gmail, for compose) for the extension to work
- The extension only activates on `linkedin.com` and `mail.google.com` pages
- Built-in random delays (Normal mode) mimic human behavior to reduce detection risk
- There are **no external API calls** — everything runs locally in the browser
- If you encounter any issues, refresh the LinkedIn page
- See `feature-gmail-compose.md` for the detailed design/change-log of the Gmail compose feature

---

## Disclaimer

This extension is provided **for educational and personal use only**. Searching LinkedIn may violate LinkedIn's User Agreement. Use at your own risk. The author is not responsible for any misuse or any violations of platform terms of service.

---

## Support

- 💡 **Feature requests / Bug reports**: Open an [issue on GitHub](https://github.com/nachiiiket/linkedin_job_search_chrome_extension/issues)
- ⭐ **Like the project?** Star the repo — it helps others discover it
