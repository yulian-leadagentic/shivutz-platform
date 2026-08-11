#!/usr/bin/env node
// scan-messages.mjs
//
// Catalogues every user-facing string in the app:
//   1. Frontend: services/frontend/src/i18n/he.ts (central) + every
//      Hebrew literal in .tsx/.ts under services/frontend/src/
//   2. Backend errors: FastAPI HTTPException(detail=...) + Express
//      res.status(...).json({ error/message/detail: ... }) with
//      Hebrew or English customer-facing text.
//   3. Notification templates: every INSERT INTO notification_templates
//      row in db/migrations/*.sql (SMS/email/WhatsApp bodies).
//
// Writes:
//   screens-export/messages-map.md   (grouped, review-friendly)
//   screens-export/messages-map.csv  (tool-friendly)

import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'screens-export');
mkdirSync(OUT_DIR, { recursive: true });

// ─── file walk ──────────────────────────────────────────────────
function walk(dir, filter, hits = []) {
  let ents;
  try { ents = readdirSync(dir); } catch { return hits; }
  for (const name of ents) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (['node_modules', '.next', '.venv', '__pycache__', 'dist', 'build'].includes(name)) continue;
      walk(full, filter, hits);
    } else if (filter(full)) {
      hits.push(full);
    }
  }
  return hits;
}

// ─── Hebrew literal detection ───────────────────────────────────
// Matches a single/double/backtick-quoted string that contains at least
// one Hebrew char (U+0590..U+05FF). Preserves the raw text (verbatim,
// RTL) so the reviewer sees exactly what the user reads.
const HEB_STRING = /(['"`])((?:(?!\1|\\)[\s\S])*[֐-׿](?:(?!\1|\\)[\s\S])*)\1/g;

function extractHebrewStrings(text) {
  const out = [];
  let m;
  HEB_STRING.lastIndex = 0;
  while ((m = HEB_STRING.exec(text))) {
    const s = m[2].trim();
    if (s.length < 2) continue;
    // Filter out mostly-code strings: if it's a JSX attribute like
    // dir="rtl" we still capture the Hebrew ones, but we don't want
    // pure identifiers.
    out.push({ raw: s, offset: m.index });
  }
  return out;
}

function lineFor(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

// ─── categorization heuristics ──────────────────────────────────
// Applied per string, based on the source file + surrounding context.
function categorize(rel, text, snippet) {
  const t = text.toLowerCase();
  const s = snippet.toLowerCase();
  if (/toast|Toast/.test(snippet))                             return { category: 'toast',       channel: 'toast'  };
  if (/dialog|Modal|ConfirmDialog/.test(snippet))              return { category: 'modal',       channel: 'modal'  };
  if (/aria-label|placeholder=/.test(snippet))                 return { category: 'label',       channel: 'inline' };
  if (/setError\(|throw new Error|error:|בעיה|שגיאה/.test(snippet)) return { category: 'validation',  channel: 'inline' };
  if (/EmptyState|StateCard|אין|לא נמצאו|no data/.test(snippet))    return { category: 'empty-state', channel: 'inline' };
  if (/Banner|banner|נותרו|עדכון/.test(snippet))               return { category: 'banner',      channel: 'inline' };
  if (rel.includes('/notification/'))                          return { category: 'notification', channel: 'SMS'   };
  return { category: 'copy', channel: 'inline' };
}

// ─── issue heuristics ────────────────────────────────────────────
function flagIssues(text, category, channel) {
  const issues = [];
  const t = text.trim();

  // Generic bare "error occurred" without action
  if (/^(שגיאה|Error|error)\.?$/.test(t))                              issues.push('generic-no-action');
  if (/^שגיאה בשמירה?$/.test(t))                                        issues.push('generic-no-action');
  if (/^אירעה שגיאה$/.test(t) || /^אירעה שגיאה — נסה שוב$/.test(t))     issues.push('generic-no-action');
  if (/^internal[_ ]error$/i.test(t))                                   issues.push('raw-internal-error');
  if (/^Internal Server Error$/.test(t))                                issues.push('english-technical-leak');

  // English text in a customer-visible message (excluding proper nouns
  // and code identifiers). Only flag when the string is majority English
  // AND category is customer-visible.
  const engRatio = (t.match(/[A-Za-z]/g)?.length ?? 0) / Math.max(t.length, 1);
  const hebRatio = (t.match(/[֐-׿]/g)?.length ?? 0) / Math.max(t.length, 1);
  if (engRatio > 0.6 && hebRatio < 0.05 && !['label','copy'].includes(category)) {
    issues.push('english-in-user-text');
  }

  // Untranslated technical tokens surfaced to the user
  if (/\bENOTFOUND\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\btraceback\b|\bstack\b/i.test(t)) {
    issues.push('technical-leak');
  }

  // Non-RTL-safe embed: phone/URL/email that isn't wrapped in ltr but
  // sits inside Hebrew text. We can't check the runtime dir attribute
  // from the string alone; only flag when a bare URL/phone appears in
  // Hebrew copy with no adjacent `dir=`.
  if (/[֐-׿]/.test(t) && /\+?\d{7,}|https?:\/\//.test(t)) {
    issues.push('inline-ltr-in-rtl');
  }

  return issues;
}

// ─── SOURCE 1: frontend Hebrew strings ──────────────────────────
const frontendFiles = walk(
  join(REPO_ROOT, 'services', 'frontend', 'src'),
  (f) => /\.(tsx?|jsx?)$/.test(f) && !f.includes('.next'),
);

const entries = [];
let id = 1;

for (const f of frontendFiles) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const strings = extractHebrewStrings(text);
  for (const { raw, offset } of strings) {
    const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');
    const line = lineFor(text, offset);
    // Snippet: 80 chars before + 40 after — for context-aware categorize
    const snippet = text.slice(Math.max(0, offset - 80), offset + raw.length + 40);
    const { category, channel } = categorize(rel, raw, snippet);
    const issues = flagIssues(raw, category, channel);
    entries.push({
      id: `FE-${String(id++).padStart(4, '0')}`,
      category, channel,
      trigger: '',
      text: raw,
      source: `${rel}:${line}`,
      issues,
    });
  }
}

// ─── SOURCE 2: backend error responses ──────────────────────────
// FastAPI: HTTPException(status_code=..., detail=...) OR HTTPException(status_code=..., detail={...})
//          Also: raise HTTPException(..., detail="…")
// Express: res.status(N).json({ error: "…", message: "…", detail: "…" })

const backendFiles = [
  ...walk(join(REPO_ROOT, 'services'), (f) => /\.py$/.test(f) && !f.includes('/tests/')),
  ...walk(join(REPO_ROOT, 'services'), (f) => /\.js$/.test(f) && !f.includes('node_modules') && !f.includes('/frontend/')),
];

for (const f of backendFiles) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');

  // FastAPI HTTPException — string form
  const fastapi = /HTTPException\s*\(\s*(?:status_code\s*=\s*(\d+)[^)]*?)?detail\s*=\s*(['"])([^'"\n]{2,300})\2/g;
  let m;
  while ((m = fastapi.exec(text))) {
    const line = lineFor(text, m.index);
    const status = m[1] || '?';
    const detail = m[3];
    entries.push({
      id: `BE-${String(id++).padStart(4, '0')}`,
      category: 'api-error', channel: 'inline',
      trigger: `HTTP ${status}`,
      text: detail,
      source: `${rel}:${line}`,
      issues: flagIssues(detail, 'api-error', 'inline'),
    });
  }

  // FastAPI HTTPException — dict form with "code": "..." OR "message":
  const fastDict = /HTTPException\s*\(\s*(?:status_code\s*=\s*(\d+)[^)]*?)?detail\s*=\s*\{[^}]{0,400}?(?:['"](?:code|message|error)['"]|code|message|error)\s*:\s*(['"])([^'"\n]{2,300})\2/g;
  fastDict.lastIndex = 0;
  while ((m = fastDict.exec(text))) {
    const line = lineFor(text, m.index);
    const status = m[1] || '?';
    const detail = m[3];
    entries.push({
      id: `BE-${String(id++).padStart(4, '0')}`,
      category: 'api-error', channel: 'inline',
      trigger: `HTTP ${status}`,
      text: detail,
      source: `${rel}:${line}`,
      issues: flagIssues(detail, 'api-error', 'inline'),
    });
  }

  // Express: res.status(N).json({ error/message/detail: "..." })
  const express = /res\.status\s*\(\s*(\d+)\s*\)\.json\s*\(\s*\{[^}]{0,300}?(?:error|message|detail)\s*:\s*(['"])([^'"\n]{2,300})\2/g;
  while ((m = express.exec(text))) {
    const line = lineFor(text, m.index);
    entries.push({
      id: `BE-${String(id++).padStart(4, '0')}`,
      category: 'api-error', channel: 'inline',
      trigger: `HTTP ${m[1]}`,
      text: m[3],
      source: `${rel}:${line}`,
      issues: flagIssues(m[3], 'api-error', 'inline'),
    });
  }
}

// ─── SOURCE 3: notification templates ───────────────────────────
// Parses INSERT INTO notification_templates ... VALUES (...) rows.
// The migration format uses PostgreSQL-flavored quoting with '' for
// escaped single quotes; we don't need to un-escape — the reviewer
// wants the verbatim source text.

const migrationFiles = walk(join(REPO_ROOT, 'db', 'migrations'), (f) => f.endsWith('.sql'));
const NOTIF_INSERT = /INSERT\s+INTO\s+notification_templates[\s\S]*?VALUES\s*([\s\S]*?);/gi;
const ROW = /\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*'([\s\S]*?[^\\])'\s*(?:,|\))/g;

for (const f of migrationFiles) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');
  NOTIF_INSERT.lastIndex = 0;
  let insertMatch;
  while ((insertMatch = NOTIF_INSERT.exec(text))) {
    const valuesBlock = insertMatch[1];
    const line = lineFor(text, insertMatch.index);
    // For each parenthesized row: we can't reliably parse SQL multi-
    // column tuples with regex when the body itself contains commas +
    // quotes. Simpler: grab every quoted string with Hebrew in it and
    // call it a template body. Loses the event_key attribution but
    // captures verbatim customer text.
    const strings = valuesBlock.match(/'([^'\\]|\\.|'')*'/g) || [];
    for (const raw of strings) {
      const trimmed = raw.slice(1, -1);
      if (!/[֐-׿]/.test(trimmed)) continue;
      if (trimmed.length < 6) continue;
      entries.push({
        id: `NT-${String(id++).padStart(4, '0')}`,
        category: 'notification', channel: 'SMS/email',
        trigger: 'template',
        text: trimmed,
        source: `${rel}:~${line}`,
        issues: flagIssues(trimmed, 'notification', 'SMS/email'),
      });
    }
  }
}

// ─── output: markdown + CSV ─────────────────────────────────────

function esc(s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function csvCell(s) {
  const str = String(s ?? '');
  if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Group MD by category
const grouped = {};
for (const e of entries) (grouped[e.category] ??= []).push(e);

const now = new Date().toISOString().slice(0, 10);
const md = [];
md.push('# Messages & errors map');
md.push('');
md.push(`Generated **${now}** by \`tools/screens-export/scan-messages.mjs\`.`);
md.push(`Total: **${entries.length}** entries across **${Object.keys(grouped).length}** categories.`);
md.push('');
md.push('## Columns');
md.push('');
md.push('| Col | Meaning |');
md.push('|---|---|');
md.push('| id | Stable ID (FE / BE / NT prefix) |');
md.push('| category | validation / api-error / toast / banner / empty-state / modal / notification / copy / label |');
md.push('| channel | inline / toast / modal / SMS / email / SMS+email |');
md.push('| trigger | HTTP status for api-error, or "template" for notifications |');
md.push('| text | Verbatim source text (RTL preserved) |');
md.push('| source | file:line (repo-relative) |');
md.push('| issues | Flagged concerns — see legend below |');
md.push('');
md.push('## Issue legend');
md.push('');
md.push('- `generic-no-action` — bare "שגיאה" / "אירעה שגיאה" with no explanation of what happened or how to fix');
md.push('- `raw-internal-error` — literal `internal_error` or similar surfaced to user');
md.push('- `english-technical-leak` — English tech text in a customer-visible response');
md.push('- `english-in-user-text` — majority-English string in a user-facing category');
md.push('- `technical-leak` — Node/Python stack/error codes bleeding through (ENOTFOUND, traceback, etc.)');
md.push('- `inline-ltr-in-rtl` — phone/URL/email embedded in Hebrew copy without an explicit `dir="ltr"` wrap');
md.push('');
md.push('---');
md.push('');

for (const cat of Object.keys(grouped).sort()) {
  const rows = grouped[cat];
  md.push(`## ${cat} (${rows.length})`);
  md.push('');
  md.push('| id | channel | trigger | text | source | issues |');
  md.push('|---|---|---|---|---|---|');
  for (const e of rows) {
    md.push(`| ${e.id} | ${e.channel} | ${esc(e.trigger)} | ${esc(e.text)} | \`${e.source}\` | ${e.issues.join(', ')} |`);
  }
  md.push('');
}

// GAPS section — heuristic
md.push('## Known gaps');
md.push('');
md.push('- Any backend endpoint that returns `{"error":"internal_error"}` **without** a client-side handler surfacing a friendly Hebrew message is a gap. Grep for `internal_error` in the FE to check coverage.');
md.push('- Any page with a data fetch but no explicit empty-state copy — grep for `.length === 0` in the FE and cross-reference `EmptyState` / `StateCard` usage.');
md.push('- Notification templates flagged `english-in-user-text` are candidates for translation review.');
md.push('');

writeFileSync(join(OUT_DIR, 'messages-map.md'), md.join('\n'), 'utf8');

// CSV — always the same columns
const csvLines = ['id,category,channel,trigger,text,source,issues'];
for (const e of entries) {
  csvLines.push([
    csvCell(e.id), csvCell(e.category), csvCell(e.channel),
    csvCell(e.trigger), csvCell(e.text), csvCell(e.source),
    csvCell(e.issues.join(';')),
  ].join(','));
}
writeFileSync(join(OUT_DIR, 'messages-map.csv'), csvLines.join('\n'), 'utf8');

// Summary
const issueCounts = {};
for (const e of entries) for (const i of e.issues) issueCounts[i] = (issueCounts[i] || 0) + 1;
console.log(`\nWrote ${entries.length} entries →`);
console.log(`  ${relative(REPO_ROOT, join(OUT_DIR, 'messages-map.md'))}`);
console.log(`  ${relative(REPO_ROOT, join(OUT_DIR, 'messages-map.csv'))}`);
console.log('\nBy category:');
for (const [cat, rows] of Object.entries(grouped).sort()) console.log(`  ${cat.padEnd(14)} ${rows.length}`);
console.log('\nFlagged issues:');
for (const [issue, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${issue.padEnd(24)} ${count}`);
}
