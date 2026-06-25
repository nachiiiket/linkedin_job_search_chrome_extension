# LinkedIn Job Finder Chrome Extension

A Chrome extension to scrape LinkedIn job listings and posts, track applications, and export data to CSV/XLS.

## Features

- **Job Search**: Scrape LinkedIn job search results with role/location filters
- **Post Search**: Scan LinkedIn posts for hiring signals relevant to your keywords
- **Email Extraction**: Automatically detects and extracts email addresses from job descriptions and posts (including obfuscated formats like `[at]`, `(dot)`)
- **Dashboard UI**: Browser-based dashboard to view, filter, and manage collected leads
- **Export**: Download results as CSV or XLS
- **Resume Support**: Automatically resumes interrupted scraping sessions (MV3-compatible)

## Installation

1. **Clone or download** this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `extension` folder from this project
6. The extension icon will appear in your toolbar

## Usage

### Popup
- Click the extension icon to open the popup
- Select search mode: **Jobs**, **Posts**, or **Both**
- Toggle filters like *Only save with email* or *First page only*
- Click **Start Scraping**

### Dashboard
- Click **Dashboard** in the popup to open the full dashboard
- Configure job roles, locations, target companies, and other preferences
- View results in a sortable table with tabs for All / With Email / Without Email
- Export data using CSV or XLS buttons

### Configuration

| Setting | Description |
|---------|-------------|
| Job Roles | Keywords to search (one per line) |
| Locations | Target cities (one per line) |
| Target Companies | Company names to include in post searches |
| Easy Apply Only | Filter for Easy Apply jobs only |
| Posted Within Days | How recently jobs were posted |
| First Page Only | Only scrape the first page of results |
| Only Save With Email | Skip entries without detected emails |
| Max Per Run | Maximum items to collect per scrape session |

## Permissions

- `storage` - Save job data and preferences locally
- `downloads` - Export CSV/XLS files
- `tabs` - Interact with LinkedIn tabs
- `notifications` - Show scraping status updates
- `https://*.linkedin.com/*` - Required for scraping LinkedIn

## Notes

- You must be **signed in** to LinkedIn for the extension to work
- The extension will only activate on `linkedin.com` pages
- Scraping speed includes built-in delays to avoid rate limiting
- If the extension stops responding, refresh the LinkedIn page
