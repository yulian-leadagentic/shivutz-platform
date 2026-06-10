// Tiny CSV helpers used by admin tables to export the current
// rows. Excel-compatible (UTF-8 BOM so Hebrew renders correctly when
// the file is opened directly in Excel; comma separator; CRLF line
// endings) and no external dependencies.

export type CsvCell = string | number | null | undefined;

/** Escape a single cell value to a CSV-safe string. Wraps in quotes
 *  when needed; escapes embedded quotes by doubling them. */
function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Always wrap if contains separator, quote, newline, or starts with
  // a leading character Excel would interpret as a formula (=, +, -, @).
  const needsWrap = /[",\r\n]/.test(s) || /^[=+\-@]/.test(s);
  if (!needsWrap) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Build a CSV string from a header row + a list of rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return lines.join('\r\n');
}

/** Trigger a browser download. The BOM prefix (﻿) makes Excel
 *  read the file as UTF-8 instead of CP-1255, which is what causes
 *  Hebrew strings to appear as mojibake. */
export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience — build + download in one call. */
export function exportCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  downloadCsv(filename, toCsv(headers, rows));
}
