// L10 · /accessibility — data-driven with FILE fallback.
//
// Israeli law makes an accessibility statement mandatory; if the DB
// row goes missing we still render docs/accessibility_statement.md
// (per spec §2 resolver: DB → file → 404). Only accessibility gets
// this second layer because it's the only one with a bundled file
// to fall back to.
//
// R14 §2 · coordinator block now lives INSIDE section 4 of the doc
// (via a {{a11y_coordinator_block}} placeholder in body_md, filled
// by legal-render.ts from site_settings). Same completeness rule:
// name AND (phone OR email) — anything less produces an empty
// substitution so section 4 renders without half a contact.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { legalApi, type SiteSettings } from '@/lib/api/legal';
import { renderLegalMarkdown } from '@/lib/legal-render';
import { readAccessibilityMdFallback } from '@/lib/legal-fallback';

// U5 build-fix — force per-request SSR. At build time the Nixpacks
// container has no gateway to fetch legal_documents from, so
// `apiFetch('/legal/accessibility')` hangs → Turbopack times out at
// 60s × 3 retries → whole build fails and Railway can't ship. Making
// this page dynamic skips the build-time prerender attempt entirely;
// at request time the frontend Node process reaches the gateway
// normally. If the fetch still fails at runtime, legalApi.doc()
// returns null and the file-fallback branch renders instead.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title:       'הצהרת נגישות · TagidAI',
  description: 'הצהרת נגישות לפי תקנות שוויון זכויות לאנשים עם מוגבלות',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

export default async function AccessibilityPage() {
  const [doc, settings] = await Promise.all([
    legalApi.doc('accessibility'),
    legalApi.settings().catch((): SiteSettings => ({})),
  ]);

  // DB → file → 404
  let bodyMd: string;
  let stamp: string;
  let title: string;
  let isDraft = false;

  if (doc) {
    bodyMd = doc.body_md;
    // R24 §4b · the label reads "עודכן לאחרונה" — that is
    // updated_at (edit time), not effective_at (a separate legal
    // authorship concept that gets set manually and often lags
    // behind edits). Previously we preferred effective_at, which
    // is why the accessibility page kept saying 12.09 after the
    // R14 §2 rewrite on 20.09. If Yulian later wants a separate
    // "בתוקף מ־" line, add it distinctly — don't repurpose this.
    stamp  = fmtDate(doc.updated_at);
    title  = doc.title_he;
    isDraft = doc.is_draft;
  } else {
    const fileBody = await readAccessibilityMdFallback();
    if (!fileBody) return notFound();
    bodyMd = fileBody;
    stamp  = '';
    title  = 'הצהרת נגישות';
  }

  // R14 §2 · build the coordinator markdown block from site_settings.
  // Emits a small markdown table so section 4 lands with the same
  // list-under-heading feel as the rest of the declaration. Whole
  // block is empty when incomplete — the placeholder in body_md then
  // collapses to nothing, and section 4 renders without half a
  // contact. The `tel:` and `mailto:` schemes are both in
  // legal-render.ts's ALLOWED_URI_REGEXP so the anchors survive
  // sanitisation.
  const cName  = settings.a11y_coordinator_name?.trim() || null;
  const cPhone = settings.a11y_coordinator_phone?.trim() || null;
  const cEmail = settings.a11y_coordinator_email?.trim() || null;
  const coordBlock = buildCoordinatorMarkdown(cName, cPhone, cEmail);

  const html = renderLegalMarkdown(bodyMd, { a11y_coordinator_block: coordBlock });

  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-6 text-slate-800 leading-relaxed">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{title}</h1>
        {stamp && (
          <p className="text-sm text-slate-500 mt-1">עודכן לאחרונה: <time>{stamp}</time></p>
        )}
        {isDraft && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <b>טיוטה.</b> המסמך בהכנה.
          </p>
        )}
      </header>
      <article
        className="legal-content prose prose-slate max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}

// R14 §2 · Coordinator block builder — returns markdown embedded in
// section 4 via the {{a11y_coordinator_block}} placeholder. Returns
// '' whenever name is missing or both phone AND email are missing,
// so an incomplete row in site_settings never surfaces to visitors.
// Phone rendered LTR so a Hebrew RTL document doesn't mangle the
// digits; email uses plain mailto. Both anchor schemes are in the
// legal-render.ts sanitiser allow-list.
function buildCoordinatorMarkdown(
  name: string | null,
  phone: string | null,
  email: string | null,
): string {
  if (!name) return '';
  if (!phone && !email) return '';
  const lines: string[] = ['**רכז הנגישות**', ''];
  lines.push(`- **שם:** ${name}`);
  if (phone) {
    // strip non-digits for the tel: URI so `052-527-8625` clicks
    // through as `tel:0525278625` on iOS + Android without the dash
    // confusing a legacy dialler. The `‪ ... ‬` bidi
    // isolate wraps the visible digits in an LRE block so the phone
    // stays visually LTR inside the surrounding RTL sentence — no
    // <span dir="ltr"> needed (span isn't in legal-render.ts's
    // ALLOWED_TAGS allow-list, so a raw span would render as text).
    const telDigits = phone.replace(/\D/g, '');
    lines.push(`- **טלפון:** [‪${phone}‬](tel:${telDigits})`);
  }
  if (email) {
    lines.push(`- **דוא"ל:** [${email}](mailto:${email})`);
  }
  return lines.join('\n');
}
