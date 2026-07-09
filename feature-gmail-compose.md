# feature/gmail-compose — Complete Change Log

## Overview

This branch replaces the discarded `feature/email-sending` approach (Python script + Gmail API OAuth + SMTP relay) with a content-script-based Gmail compose automation. The extension now controls Gmail's compose UI directly from a content script injected into `mail.google.com`, filling recipient/subject/body fields and optionally clicking Send — all without SMTP, OAuth, or app passwords.

---

## Files Changed (12 files, +921 / −63 lines)

| File | Status | Summary |
|------|--------|---------|
| `extension/gmail-compose.js` | **NEW** | Gmail content script |
| `extension/background.js` | MODIFIED | Compose orchestration, auto-send, compose mode |
| `extension/popup.html` | MODIFIED | Two-column layout, merged/split logs, new logo |
| `extension/popup.js` | MODIFIED | Compose mode, split log routing, persistent state |
| `extension/dashboard.html` | MODIFIED | New logo, email compose section |
| `extension/dashboard.js` | MODIFIED | Compose mode handlers, runtime log listener |
| `extension/styles.css` | MODIFIED | Two-column layout, split log styles |
| `extension/manifest.json` | MODIFIED | Gmail permissions, new logo, gmail-compose content script |
| `extension/utils/storage.js` | MODIFIED | Compose prefs, sentEmails, composeState |
| `extension/utils/exporter.js` | MODIFIED | Added `composed` column to export |
| `extension/utils/parser.js` | MODIFIED | Added `composed` field to default job object |
| `extension/content.js` | MODIFIED | Scrape speed factor, `composed` field in job objects |
| `extension/icons/icon_new.png` | **NEW** | New logo (1254×1254) |

---

## New Files

### `extension/gmail-compose.js`
Gmail content script injected into `https://mail.google.com/*`.

**Selectors** (4 Gmail DOM elements):
- `toField` — To recipients input
- `subjectField` — Subject input
- `bodyField` — Message body editable div
- `sendBtn` — Send button
- `composeBtn` — "Compose" button to open new dialog

**Functions**:
- `getComposeDialog()` — Finds the open compose dialog
- `waitForDialog(maxRetries)` — Polls for dialog to render (300ms × 30 retries)
- `openCompose()` — Clicks the Compose button, resets `_resumeAttached` flag
- `attachResume(dialog)` — Attaches resume from `chrome.storage.local` via native setter on hidden file input
- `fillCompose({to, subject, body, speed, autoSend})` — Fills all 4 fields sequentially with per-field delays, then optionally clicks Send

**Resume attachment** (`attachResume`):
- Reads base64 data from `chrome.storage.local` key `resumeFile`
- Decodes via `atob`, builds `ArrayBuffer` → `Blob` → `File`
- Uses `DataTransfer` to create a `FileList`
- Sets using native setter: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(fileInput, dt.files)`
- Falls back to `Object.defineProperty` if native setter unavailable
- `_resumeAttached` flag prevents re-attaching for subsequent emails in same dialog; reset on `openCompose()`

**Message handlers**:
- `fillGmailCompose` — Entry point for compose operation
- `ping` — Content script readiness check

---

### `extension/icons/icon_new.png`
New logo (1254×1254, ~1.1MB). Used in:
- popup header (CSS scaled to 28×28)
- dashboard header (CSS scaled to 28×28)
- Extension icons (16, 48, 128) via manifest
- Action default icon
- Notification icon

---

## Modified Files — Detailed Changes

### `extension/background.js` (+272 lines)

#### Variables
- `composeAbort` — Global abort flag for compose operations
- `_composeQueue` — Queue for realtime auto-send jobs
- `_isComposing` — Lock flag to prevent concurrent queue processing
- `_pendingBatch` — Accumulator for batch mode jobs

#### New Helper Functions
| Function | Purpose |
|----------|---------|
| `rand(min, max)` | Random integer for between-email delays |
| `getOrWaitGmailTab()` | Find Gmail tab or poll every 2s for up to 2 minutes |
| `getGmailTab()` | Query for existing Gmail tab |
| `isContentScriptReady(tabId)` | Ping content script to check readiness |
| `isDomainExcluded(job, excluded)` | Check if email domain matches exclusion list (substring match on part after `@`) |
| `safePost(port, msg)` | Port message with try/catch to handle disconnects |
| `broadcastComposeLog(msg)` | Send compose log via `chrome.runtime.sendMessage` for any open popup/dashboard to catch |

#### Compose Functions

**`sendSingleJob(job, prefs, tabId)`**
- Extracts recipient, subject, body from job/prefs
- Sends `fillGmailCompose` message to Gmail tab
- Marks job as composed (`Storage.markComposed`)
- Adds email to sent list (`Storage.addSentEmail`)
- Broadcasts compose log on success/failure
- Applies random between-email delay

**`composeInGmail(jobs, port)`**
- Filters jobs: excludes already-composed, domain-blocked, already-sent
- Logs each skip reason (excluded domain / already sent)
- Waits for Gmail tab (with notification if none found)
- Iterates jobs with per-field speed + between-email random delay
- On abort/tab-lost: sets `composeActive = false` and stops
- On completion: keeps `composeActive = true` (continuous mode)
- Broadcasts all progress via both `safePost` and `broadcastComposeLog`

#### Auto-Send Functions

**`handleAutoSendJob(job)`**
- Called when `jobFound` message arrives from content script
- Checks both `prefs.autoSendEnabled` AND `Storage.getComposeState()`
- In realtime mode (or when compose mode is active): pushes to `_composeQueue` → `processQueue()`
- In batch mode: accumulates in `_pendingBatch` → `processBatch()` when count reaches `batchSize`

**`handleAutoSendFlush()`**
- Called on `scrapingComplete` to flush any remaining batch jobs

**`processQueue()`**
- Serialized processing via `_isComposing` lock
- Filters domain-excluded and already-sent emails
- Calls `sendSingleJob` for each job

**`processBatch()`**
- Splice all pending jobs and process in order
- Same filtering as `processQueue`

#### Compose Mode Port Handlers

**`enableComposeMode`** (both popup and dashboard ports):
- Resets `composeAbort = false`
- Sets `Storage.setComposeState(true)`
- Fetches existing uncomposed jobs and calls `composeInGmail`
- If no pending jobs, logs "Compose mode active — waiting for new jobs..."

**`disableComposeMode`** (both ports):
- Sets `composeAbort = true`
- Sets `Storage.setComposeState(false)`

#### Other
- Notification icon updated from `icons/icon48.png` to `icons/icon_new.png`
- Scraping state management (`startScraping`, `stopScraping`) unchanged

---

### `extension/content.js` (+8 lines)

#### Speed Factor (`_speedFactor`)
```
normal → _speedFactor = 1
fast   → _speedFactor = 0.35
max    → _speedFactor = 0
```
- `rand(lo, hi)` now multiplies base delay by `_speedFactor`
- Set in `runAll(cfg)` from `cfg.scrapeSpeed`

#### `composed` Field
- Added `composed: "No"` to job objects in `extractJob()`, `scrapePosts()` (both email and no-email branches)

---

### `extension/utils/parser.js` (+1 line)
- Added `result.composed = "No"` to default job object in `LinkedinParser.parseJobPost()`

---

### `extension/utils/exporter.js` (+2 lines)
- Added `"composed"` column to both CSV and XLS export column arrays

---

### `extension/utils/storage.js` (+66 lines)

#### New Default Preferences
```javascript
composeSpeed: 1000,           // Per-field delay in ms
excludedEmailDomains: [],     // Comma-separated domain list
autoSendEnabled: false,       // Auto-send toggle
autoSendMode: "realtime",     // "realtime" | "batch"
batchSize: 10,                // Batch trigger count
sendMinDelay: 1000,           // Min between-email delay (ms)
sendMaxDelay: 3000,           // Max between-email delay (ms)
```

#### New Storage Methods
| Method | Purpose |
|--------|---------|
| `getSentEmails()` | Returns array of previously-sent email addresses |
| `addSentEmail(email)` | Adds email to sent list (lowercase, deduped) |
| `clearSentEmails()` | Clears sent email list |
| `getComposeState()` | Returns boolean — is compose mode active? |
| `setComposeState(active)` | Sets compose mode state |

---

### `extension/manifest.json` (+4 lines)

```json
{
  "host_permissions": ["https://*.linkedin.com/*", "https://mail.google.com/*"],
  "content_scripts": [
    { "matches": ["https://*.linkedin.com/*"], "js": ["utils/storage.js", "utils/parser.js", "content.js"] },
    { "matches": ["https://mail.google.com/*"], "js": ["gmail-compose.js"] }
  ],
  "icons": { "16": "icons/icon_new.png", "48": "icons/icon_new.png", "128": "icons/icon_new.png" },
  "action": { "default_icon": "icons/icon_new.png" }
}
```

---

### `extension/popup.html` (rewritten — two-column layout)

#### Layout
```
.popup-container (640px max, flex column)
  ├── .popup-header (full width, icon_new.png + title)
  └── .popup-body (flex row)
       ├── .popup-left (340px, scrollable controls)
       │    ├── Status section (status text + stats row)
       │    ├── Search mode select
       │    ├── Speed select (Normal/Fast/Max with descriptions)
       │    ├── Checkboxes (Only with email / First page only)
       │    ├── Target companies input
       │    ├── Action buttons (Start/Stop/Dashboard)
       │    └── Email Compose section
       │         ├── Speed select (3s/2s/1s/0.5s/Instant)
       │         ├── Auto-send checkbox + options
       │         ├── Resume status text
       │         ├── Excluded domains input
       │         └── Compose/Stop buttons
       └── .popup-right (flex 1, border-left)
            ├── .popup-log-section (Scraping log — upper half)
            └── .popup-log-section (Email Compose log — lower half)
```

#### Removed Elements
- Test email input + button (was for testing compose without scraping)
- Resume file picker + upload button
- Dummy email row
- Separate scrape/compose log toggles

#### Added Elements
- New logo (`icon_new.png`, CSS 28×28)
- Resume status text line
- Merged single log → split to two stacked log panels
- Excluded domains input
- Auto-send checkbox + mode select + batch size input
- Compose speed select

---

### `extension/popup.js` (rewritten — stateful compose mode)

#### Functions
| Function | Purpose |
|----------|---------|
| `connect()` | Open port to background, handle messages |
| `updateUI(state, stats)` | Sync scrape state from storage |
| `setStatus(s)` | Toggle idle/scraping button state |
| `setComposeUI(active)` | Toggle Compose/Stop button visibility |
| `addLogEntry(containerId, msg)` | Append colored entry to specified log container |
| `handleComposeProgress(msg)` | Route compose progress to composeLog; manage buttons |

#### Key Behaviors

**Compose button click:**
1. Saves prefs (speed, domains, auto-send)
2. Clears compose log
3. Sends `enableComposeMode` to background
4. Background processes existing jobs + enables auto-send for new ones

**Stop button click:**
1. Sends `disableComposeMode` to background
2. Background: `composeAbort = true`, `composeState = false`

**On popup load:**
1. Reads `Storage.getComposeState()` — shows Stop button if compose active
2. Reads `Storage.getResume()` — shows resume filename

**Runtime message handlers:**
- `composeLog` (from `broadcastComposeLog`) — appended to composeLog container

#### Removed
- Dummy email handler
- Resume file picker handlers
- Single `logToPopup(msg)` — replaced by `addLogEntry(containerId, msg)`

---

### `extension/dashboard.html` (+70 lines)
- **Added**: Email compose section with full controls
  - Per-field speed select
  - Auto-send toggle + mode/batch-size options
  - Between-email delay range inputs (min/max)
  - Excluded email domains input
  - Resume file picker + upload
  - Compose/Abort buttons
  - Save Email Prefs button
  - Compose log container
- **Changed**: Header icon from `icon48.png` to `icon_new.png`

### `extension/dashboard.js` (+170 lines)

#### New Features
- Email compose preferences (speed, auto-send, batch size, delays, excluded domains)
- Resume file upload (reads file, converts to base64, saves to storage)
- `enableComposeMode` / `disableComposeMode` port handlers
- `populateForm()` — reads prefs from storage and fills form
- `getPrefs()` — collects all form values into prefs object
- Runtime `composeLog` listener for auto-send logs
- Compose state check on load (shows Stop button if active)

#### Changed
- Compose button no longer early-exits on "no jobs" — uses `enableComposeMode`
- Abort button now calls `disableComposeMode` + restores buttons immediately
- "Done" message no longer restores Compose button (compose mode stays active)

---

### `extension/styles.css` (+45 lines)

#### Added Classes
| Class | Purpose |
|-------|---------|
| `.popup-container` | 640px wide, max-height 500px, flex column |
| `.popup-body` | Flex row for two-column layout |
| `.popup-left` | 340px fixed-width scrolling panel |
| `.popup-right` | Flex 1 column with border-left separator |
| `.popup-log-section` | Flex 1, 50% height, column direction |
| `.popup-log-header` | Uppercase label, 11px bold, border-bottom |
| `.popup-log` | Flex 1 scrollable log area, 11px font |
| `.popup-log .log-entry` | 2px/4px padding, ellipsis overflow |
| `.popup-log .log-info` | Blue background (#e8f0fe) |
| `.popup-log .log-active` | Amber background (#fef7e0) |
| `.popup-log .log-success` | Green background (#e6f4ea) |
| `.popup-log .log-warn` | Red background (#fce8e6) |
| `.popup-divider` | Horizontal rule for popup sections |
| `.popup-compose` | Email compose section wrapper |
| `.compose-header` | Uppercase section label |
| `.compose-row` | Flex row for controls |
| `.compose-input` | Styled input/select for compose section |
| `.sidebar .form-group` | Dashboard form styling |
| `.sidebar .form-row` | Flex row for paired inputs |
| `.sidebar .half` | 50% width within form-row |
| `.btn-secondary` | Gray button style |
| `.sidebar-divider` | HR for sidebar sections |
| `.email-section` | Email prefs section styling |
| `.compose-log` | Dashboard compose log container |

#### Modified Classes
- `.popup-icon` — unchanged (32×32)
- `.btn`, `.btn-primary`, `.btn-danger`, `.btn-outline` — unchanged
- `.mode-select`, `.actions`, `.status-section` — unchanged behavior, new layout context
- `.dummy-email-row`, `.dummy-email-input` — kept for dashboard, removed from popup

---

## Architecture & Code Flow

### Compose Flow Diagram (Manual)
```
User clicks "Compose" in popup
  │
  ├─ popup.js: setComposeUI(true), clear composeLog
  │
  └─ port.postMessage({ action: "enableComposeMode" })
       │
       └─ background.js: handleEnableComposeMode()
            │
            ├─ composeAbort = false
            ├─ Storage.setComposeState(true)      ← persistent
            │
            ├─ Fetch jobs from storage
            │  └─ If jobs exist → composeInGmail(jobs, port)
            │       │
            │       ├─ Filter: skip composed/domain-excluded/already-sent
            │       ├─ Wait for Gmail tab (notify user if needed)
            │       ├─ Loop: for each job →
            │       │    ├─ sendMessage("fillGmailCompose", {to,subject,body,speed,autoSend})
            │       │    ├─ markComposed(job.job_id)
            │       │    ├─ addSentEmail(to)
            │       │    ├─ broadcastComposeLog({ type: "success", ... })
            │       │    └─ Random delay (1-3s default)
            │       │
            │       ├─ On abort/tab-lost: setComposeState(false), stop
            │       └─ On completion: setComposeState stays TRUE
            │            └─ Log: "Compose mode still active — waiting for new jobs..."
            │
            └─ If no jobs → log: "Compose mode active — waiting for new jobs..."
                 │
                 └─ handleAutoSendJob() will catch new jobs
```

### Auto-Send Flow (New Jobs During Compose Mode)
```
content.js sends "jobFound"
  │
  └─ background.js: handleAutoSendJob(job)
       │
       ├─ Storage.getComposeState() → true
       │  └─ OR prefs.autoSendEnabled → true
       │
       ├─ Push to _composeQueue
       └─ processQueue()
            │
            ├─ Filter domain + sent-email checks
            ├─ getOrWaitGmailTab()
            ├─ sendSingleJob(job, prefs, tabId)
            │    ├─ broadcastComposeLog("Sending to ...")
            │    ├─ sendMessage("fillGmailCompose")
            │    ├─ markComposed + addSentEmail
            │    └─ broadcastComposeLog("Sent to ...")
            └─ Random between-email delay
```

### Redundancy Check Flow
```
Before each compose operation:
  1. Load sentEmails from chrome.storage.local
  2. Extract domain part (after @) from recipient email
  3. Check: sentEmails.includes(lowercased email)
  4. If match → log "Skipped (already sent)" and skip
  5. After successful send → Storage.addSentEmail(to)
```

### Compose Mode State Lifecycle
```
┌─────────────────────────────────────────────────────┐
│  Storage Key: composeActive (chrome.storage.local)  │
├─────────────────────────────────────────────────────┤
│  setComposeState(true):                              │
│    • enableComposeMode port handler                  │
│    • composeInGmail starts processing                │
│                                                      │
│  setComposeState(false):                             │
│    • disableComposeMode port handler (user Stop)     │
│    • composeInGmail abort (user Stop)                │
│    • composeInGmail tab-lost (Gmail tab closed)      │
│                                                      │
│  stays true after:                                   │
│    • composeInGmail normal completion                │
│      (continuous mode for new jobs)                  │
│                                                      │
│  Checked on popup/dashboard load:                    │
│    • true → show Stop button                         │
│    • false → show Compose button                     │
└─────────────────────────────────────────────────────┘
```

### Scrape Speed Flow
```
content.js runAll(cfg):
  cfg.scrapeSpeed = "normal" | "fast" | "max"
    normal → _speedFactor = 1    (full delays)
    fast   → _speedFactor = 0.35 (35% of delays)
    max    → _speedFactor = 0    (no delays, instant)

  rand(lo, hi) = (lo + random * (hi - lo)) * _speedFactor
```

---

## What Was Added

### Features
1. **Gmail compose automation** — Content script fills To, Subject, Body fields on `mail.google.com` with configurable per-field delays
2. **Resume attachment** — Base64 resume stored in `chrome.storage.local`, auto-attached via native setter on hidden file input
3. **Compose mode** — Persistent toggle that processes existing jobs + auto-sends new jobs until user clicks Stop
4. **Auto-send** — Two modes: realtime (send as detected) and batch (every N emails)
5. **Random between-email delay** — Configurable min/max range (default 1-3s)
6. **Email redundancy check** — Track sent emails, skip duplicates across sessions
7. **Excluded email domains** — Comma-separated substring match on domain part (after @)
8. **Scrape speed selector** — Normal/Fast/Max controls delay multiplier in content script
9. **Per-field compose speed** — 3s / 2s / 1s / 0.5s / Instant (replaced old ms-based values)
10. **New logo** — `icon_new.png` (1254×1254, used across all UI surfaces)

### UI Elements
- Two-column popup layout (controls left, logs right)
- Split log panels (Scraping upper, Email Compose lower)
- Resume status text (read-only, shows filename from storage)
- Auto-send options (checkbox, mode dropdown, batch size input)
- Excluded domains input
- Compose speed select
- Save Email Prefs button (dashboard)
- Colored log entries (blue=info, amber=progress, green=success, red=warn/abort)

### Storage Keys
- `chrome.storage.local`: `sentEmails`, `composeActive`, `resumeFile`, `composed: "Yes"` on jobs
- `chrome.storage.sync`: `composeSpeed`, `excludedEmailDomains`, `autoSendEnabled`, `autoSendMode`, `batchSize`, `sendMinDelay`, `sendMaxDelay`

### Content Script
- `gmail-compose.js` — Selectors, fill functions, resume attachment, `fillGmailCompose` + `ping` message handlers

---

## What Was Removed

### From Previous Approach (`feature/email-sending` branch)
- Python SMTP relay script (discarded entirely)
- Gmail API OAuth flow (discarded entirely)
- App password / SMTP server configuration (discarded entirely)

### From Popup
- Test email input + "Test Compose" button
- Resume file picker + upload button
- Dummy email row
- Single merged log (replaced by split Scraping + Compose logs)

### From Code
- `unmaximizeDialog()` function and minimize-button selector (not needed with `#inbox?compose=new` URL)
- All `chrome.tabs.create` calls for Gmail (extension never opens Gmail tab — waits for user)
- Separate scrape/compose log toggles

---

## What Was Fixed

### Bugs
1. **Speed `0` (Instant) bug** — All `|| 150` fallbacks replaced with null-safe checks (`!= null ? x : 150`)
2. **Compose URL** — Changed from `?view=cm&fs=1&to=...&su=...&body=...` (full-screen, URL length limits) to `#inbox?compose=new` (normal popup compose)
3. **Compose button persistence** — Added `composeActive` flag in storage so Stop button persists across popup close/reopen
4. **Scrape speed label** — Restored descriptive text "(random delays)", "(reduced delays)", "(no delays)"

### Behavioral Changes
- **Single shared Gmail tab** — All emails reuse one open Gmail tab; fields overwritten in-place; `_resumeAttached` flag prevents re-attaching resume per dialog
- **Compose mode continuous** — Compose button enables persistent mode that stays active until explicit Stop
- **Dashboard compose** — Uses same `enableComposeMode`/`disableComposeMode` as popup for consistent behavior
- **Runtime log broadcasting** — `broadcastComposeLog()` sends to any open popup/dashboard, not just the originating port

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `#inbox?compose=new` URL | Avoids full-screen compose (`fs=1`) and URL length limits; Gmail renders normal popup dialog |
| Native setter for resume | `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set` bypasses React-controlled read-only file input |
| Never open Gmail tab | Extension manipulates existing Gmail tab; user gets notification to open Gmail if needed |
| Storage-based compose state | Survives service worker termination and popup close/reopen (MV3 lifecycle) |
| Runtime message broadcast | Both port messages and `chrome.runtime.sendMessage` ensure logs reach any open UI |
| Substring domain exclusion | Matches partial domains (e.g., "gmail" matches "gmail.com", "googlemail.com") |
| `_resumeAttached` flag | Prevents double-attach across emails in same dialog; reset on `openCompose()` |
| `_composeQueue` + `_isComposing` lock | Serializes auto-send operations to prevent Gmail conflicts |
| Random between-email delay | Avoids Gmail rate-limiting; configurable min/max |
| `composed` column in exports | Allows users to filter/see which jobs received emails |

---

## Commit History (12 commits)

```
55ff506 feat: auto-send, batch mode, random delays, excluded domains, compose fixes
03c2fc4 fix: match scrape speed implementation from fix/scroll-loop
a9cda97 fix: composeSpeed fallback 15000 -> 150
f04de32 feat: add scrape speed selector for LinkedIn
4906aac feat: per-field delays, resume attachment, unmaximize compose
1c8ee86 fix: speed in milliseconds not seconds
ae47258 feat: generic email template, speed selector, remove variables
15de4e4 feat: add compose to popup + use existing Gmail tab
d23a3a9 fix: replace conditional dummy email with explicit input field
05cc8c5 feat: add test email button for Gmail compose testing
597c8fe fix: update Gmail selectors from real DOM structure
a67ea90 feat: compose emails via Gmail compose URL
```
