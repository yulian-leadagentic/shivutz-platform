'use client';

// Pivot/v2 — inline sponsored slot rendered between search results.
// Injected every 5 result cards. Standard "מודעה ממומנת" disclosure —
// Israeli law requires clear ad marking (Consumer Protection Act 2010
// + IAB Israel guidelines), and the pattern is what Google/Yad2 use.

import { Megaphone } from 'lucide-react';

export function InlineSponsoredAd({
  title = 'מקום פרסום זמין',
  body  = 'מודעתך תופיע כאן כאשר קבלנים ותאגידים מחפשים בפלטפורמה.',
  href  = 'mailto:ads@buildupai.net?subject=%D7%A4%D7%A8%D7%A1%D7%95%D7%9D%20%D7%91%D7%AA%D7%95%D7%A6%D7%90%D7%95%D7%AA%20%D7%97%D7%99%D7%A4%D7%95%D7%A9',
}: {
  title?: string;
  body?:  string;
  href?:  string;
}) {
  return (
    <li aria-label="פרסומת ממומנת">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">מודעה ממומנת</div>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{body}</p>
          <a
            href={href}
            className="mt-2 inline-flex items-center bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg"
          >
            פרסום כאן
          </a>
        </div>
      </div>
    </li>
  );
}
