# LinkedIn Job Finder Chrome Extension

A Chrome extension to scrape LinkedIn job listings and posts, extract email addresses, track applications, and export data to CSV/XLS.

> ⭐ **Star this repo** if you find it useful!

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

## Scraping Speed Options

| Option | Multiplier | Description |
|--------|-----------|-------------|
| **Normal** | 1x | Full random delays — safest for avoiding rate limits |
| **Fast** | ~0.35x | Reduced delays — faster scraping, moderate risk |
| **Max** | 0x | No delays — fastest scraping |

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
| **Job Roles** | 17 AI/ML roles (AI Engineer, ML Engineer, Data Scientist, etc.) | Keywords to search for in jobs and posts. One per line. The scraper checks if the post/job matches these keywords using partial matching (70% word threshold for multi-word roles). |
| **Locations** | Pune, Bangalore, Hyderabad | Target cities for job search. One per line. |
| **Target Companies** | (empty) | Company names to include in **post** searches. When set, the post search query becomes: `"Hiring" AND "<role>" AND "<company>"`. |
| **Easy Apply Only** | Enabled | Filters job search to show only LinkedIn Easy Apply listings (`f_AL=true`). |
| **Posted Within Days** | 1 day | Recency filter for jobs. Maps to: 1 day (`r86400`), 7 days (`r604800`), or 30 days (`r2592000`). |
| **First Page Only** | Enabled | When enabled, only scrapes the first page of job results. Disable to paginate through all available pages. |
| **Only Save With Email** | Disabled | When enabled, only saves entries that contain detected email addresses. Highly recommended for **Posts** mode to get direct-contact leads. |
| **Max Per Run** | 50 | Maximum number of items to collect in a single scraping session. |
| **Scrape Speed** | Normal | Controls delay between actions: Normal (safe), Fast (risky), Max (not recommended). |
| **Search Mode** | Jobs | Selector in the popup — **Jobs**, **Posts**, or **Both** (runs jobs first, then posts). |

---

## How to Use

### Popup (Quick Start)

1. Click the extension icon in your toolbar
2. Select **Search Mode**: Jobs / Posts / Both
3. Toggle filters: *Only save with email*, *First page only*
4. Select **Speed** (keep Normal for safety)
5. Optionally enter **Target Companies** for post search
6. Click **Start Scraping**
7. Watch the live log panel for progress
8. Click **Stop** anytime to interrupt

### Dashboard (Full Control)

1. Click **Dashboard** in the popup, or open `dashboard.html`
2. Configure all preferences and click **Save**
3. Click **Start** to begin scraping with the saved settings

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
| **Stats Bar** | Shows Total found, With Email, Applied, Connected counts |
| **Filter Tabs** | All / With Email / Without Email — click to filter results |
| **Results Table** | Displays Position, Company, Location, Poster, Email, Job URL, Profile link, Date found |
| **Open Links** | Click "Open" to visit the job/post URL, "Profile" to view the poster's LinkedIn profile |
| **Export CSV** | Downloads all results as a CSV file |
| **Export XLS** | Downloads all results as an Excel-compatible XLS file |
| **Clear Data** | Deletes all scraped results |
| **Collapsible Sidebar** | Toggle the preferences sidebar with the ◀ / ▶ buttons |
| **Email Extraction** | Automatically detects emails including obfuscated formats: `[at]`, `(dot)`, `{at}`, `[remove]`, and `mailto:` links |

---

## How Scraping Works

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

If the page is reloaded while scraping, the extension saves the current phase, query index, and URL. On the next page load, it automatically resumes from where it left off.

---

## Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Save scraped job data and user preferences locally |
| `downloads` | Export results as CSV or XLS files |
| `tabs` | Find and interact with LinkedIn tabs |
| `notifications` | Show desktop notifications for scraping start/complete |
| `https://*.linkedin.com/*` | Access LinkedIn pages for scraping |

---

## Troubleshooting

- **First run — extension not responding**: Refresh the LinkedIn page after adding the extension for the content script to initialize
- **Preferences not saving in dashboard**: Refresh the dashboard page — it may need a reload on first startup
- **Extension not responding**: Refresh the LinkedIn page and try again
- **No results found**: Make sure you are signed in to LinkedIn
- **Scraping stuck**: Click **Stop** and restart. Try reducing `Max Per Run`
- **Posts mode finds nothing**: Disable "Only save with email" temporarily to see if posts are being detected
- **Dashboard shows old data**: Click **Refresh** (or close and reopen the dashboard)
- **Service worker died**: Chrome MV3 unloads the service worker after ~5 minutes of inactivity. The extension auto-reconnects when you open the popup

---

## Notes

- You must be **signed in** to LinkedIn for the extension to work
- The extension only activates on `linkedin.com` pages
- Built-in random delays (Normal mode) mimic human behavior to reduce detection risk
- If you encounter any issues, refresh the LinkedIn page

---

## Disclaimer

This extension is provided **for educational and personal use only**. Scraping LinkedIn may violate LinkedIn's User Agreement. Use at your own risk. The author is not responsible for any misuse or any violations of platform terms of service.

---

## Support

- 💡 **Feature requests / Bug reports**: Open an [issue on GitHub](https://github.com/nachiiiket/linkedin_job_search_chrome_extension/issues)
- ⭐ **Like the project?** Star the repo — it helps others discover it
