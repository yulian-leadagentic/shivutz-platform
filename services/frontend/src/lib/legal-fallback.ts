// L10 §2 · file fallback for accessibility only.
//
// Spec: 'DB → file → 404'. If someone accidentally drops the
// legal_documents.accessibility row, the accessibility statement
// (a legal requirement in Israel) must still render. terms + privacy
// don't ship with a file — a deleted row for those returns 404 so
// the reader knows to refresh, not a stale copy.
//
// The file lives at docs/accessibility_statement.md in the repo. It
// was written by hand alongside L6 and is the source of truth for
// the coordinator's contact details.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readAccessibilityMdFallback(): Promise<string | null> {
  // Search a few candidate paths — the Next.js runtime cwd varies
  // between dev (services/frontend) and prod (Railway image root).
  const candidates = [
    path.resolve(process.cwd(), '../../docs/accessibility_statement.md'),
    path.resolve(process.cwd(), '../../../docs/accessibility_statement.md'),
    path.resolve(process.cwd(), 'docs/accessibility_statement.md'),
    '/docs/accessibility_statement.md',
  ];
  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p, 'utf8');
      if (buf && buf.length > 100) return buf;
    } catch { /* keep trying next candidate */ }
  }
  return null;
}
