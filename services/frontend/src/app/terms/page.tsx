// L10 · /terms is now data-driven. Body comes from legal_documents
// (server-rendered, sanitized). If the DB row disappears we return
// 404 rather than a stale hardcoded copy — the reader must know when
// content is missing.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { legalApi } from '@/lib/api/legal';
import { renderLegalMarkdown } from '@/lib/legal-render';

export const revalidate = 60;  // page is cached for 60s between edits

export const metadata: Metadata = {
  title:       'תנאי שימוש · TagidAI',
  description: 'תנאי השימוש בפלטפורמת TagidAI',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

export default async function TermsPage() {
  const doc = await legalApi.doc('terms');
  if (!doc) return notFound();
  const html = renderLegalMarkdown(doc.body_md);
  const stamp = fmtDate(doc.effective_at ?? doc.updated_at);
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
