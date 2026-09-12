// L10 · /accessibility — data-driven with FILE fallback.
//
// Israeli law makes an accessibility statement mandatory; if the DB
// row goes missing we still render docs/accessibility_statement.md
// (per spec §2 resolver: DB → file → 404). Only accessibility gets
// this second layer because it's the only one with a bundled file
// to fall back to.
//
// §2b · coordinator section is rendered ONLY if we have a name AND
// (a phone OR an email). The rule ships client-side by wrapping the
// rendered body so the standard doc content still shows even when
// site_settings hasn't been populated.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { legalApi, type SiteSettings } from '@/lib/api/legal';
import { renderLegalMarkdown } from '@/lib/legal-render';
import { readAccessibilityMdFallback } from '@/lib/legal-fallback';

export const revalidate = 60;

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
    stamp  = fmtDate(doc.effective_at ?? doc.updated_at);
    title  = doc.title_he;
    isDraft = doc.is_draft;
  } else {
    const fileBody = await readAccessibilityMdFallback();
    if (!fileBody) return notFound();
    bodyMd = fileBody;
    stamp  = '';
    title  = 'הצהרת נגישות';
  }

  const html = renderLegalMarkdown(bodyMd);

  // §2b · coordinator section is conditional on having a contact
  // method beyond a name. NULL/empty phone AND email → the block
  // is omitted so the reader isn't shown half a contact.
  const cName  = settings.a11y_coordinator_name?.trim() || null;
  const cPhone = settings.a11y_coordinator_phone?.trim() || null;
  const cEmail = settings.a11y_coordinator_email?.trim() || null;
  const showCoord = cName && (cPhone || cEmail);

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
      {showCoord && (
        <section className="space-y-3 border-t border-slate-200 pt-6">
          <h2 className="text-xl font-semibold text-slate-900">רכז הנגישות</h2>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-y-1 gap-x-3 text-sm">
            <div className="font-semibold">שם</div><div>{cName}</div>
            {cPhone && (<><div className="font-semibold">טלפון</div>
              <div><a href={`tel:${cPhone}`} dir="ltr" className="text-brand-700 hover:underline">{cPhone}</a></div></>)}
            {cEmail && (<><div className="font-semibold">דוא&quot;ל</div>
              <div><a href={`mailto:${cEmail}`} className="text-brand-700 hover:underline">{cEmail}</a></div></>)}
          </div>
        </section>
      )}
      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}
