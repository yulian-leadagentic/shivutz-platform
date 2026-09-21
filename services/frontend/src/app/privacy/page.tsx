// L10 · /privacy — same data-driven shape as /terms.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { legalApi } from '@/lib/api/legal';
import { renderLegalMarkdown } from '@/lib/legal-render';

// U5 build-fix — see accessibility/page.tsx for the reason.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title:       'מדיניות פרטיות · TagidAI',
  description: 'מדיניות פרטיות של פלטפורמת TagidAI',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

export default async function PrivacyPage() {
  const doc = await legalApi.doc('privacy');
  if (!doc) return notFound();
  const html = renderLegalMarkdown(doc.body_md);
  // R24 §4b · label says "עודכן לאחרונה" — use updated_at, not
  // effective_at (which is a manual authorship date that often
  // lags edits). Same fix as accessibility/page.tsx.
  const stamp = fmtDate(doc.updated_at);
  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-6 text-slate-800 leading-relaxed">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{doc.title_he}</h1>
        {stamp && (
          <p className="text-sm text-slate-500 mt-1">עודכן לאחרונה: <time>{stamp}</time></p>
        )}
        {doc.is_draft && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <b>טיוטה.</b> המסמך בהכנה וטרם עבר בדיקה משפטית סופית. הנוסח המחייב יפורסם בהמשך.
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
