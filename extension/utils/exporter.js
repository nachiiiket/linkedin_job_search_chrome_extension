const Exporter = {
  toCSV(jobs) {
    const cols = ["job_id", "date_found", "position", "company", "location",
      "poster_name", "poster_title", "job_url", "email", "applied", "connection_sent", "notes"];
    const esc = v => `"${(v || "").replace(/"/g, '""')}"`;
    const header = cols.join(",");
    const rows = jobs.map(j => cols.map(c => esc(j[c])).join(","));
    return [header, ...rows].join("\n");
  },

  toXLS(jobs) {
    const cols = ["job_id", "date_found", "position", "company", "location",
      "poster_name", "poster_title", "poster_profile_url", "job_url",
      "email", "applied", "connection_sent", "notes"];
    const escHtml = v => (v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = jobs.map(j =>
      `<tr>${cols.map(c => `<td>${escHtml(j[c])}</td>`).join("")}</tr>`
    ).join("\n");
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:x="urn:schemas-microsoft-com:office:excel"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
      <x:Name>Jobs</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
      </x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <style>td{mso-number-format:"\\@";border:1px solid #ccc;padding:4px 8px}th{background:#f0f0f0}</style></head>
      <body><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></body></html>`;
  },

  download(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });
  },

  downloadCSV(jobs) {
    this.download(this.toCSV(jobs), `linkedin_jobs_${Date.now()}.csv`, "text/csv;charset=utf-8");
  },

  downloadXLS(jobs) {
    this.download(this.toXLS(jobs), `linkedin_jobs_${Date.now()}.xls`, "application/vnd.ms-excel");
  }
};
