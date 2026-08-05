'use client';

// Pivot/v2 — IAB Medium Rectangle 300x250 sidebar.
// Renders on all breakpoints; placement decisions are the caller's job.
// Placeholder mode with a static "מקום פרסום זמין" slate; swap for a
// real ad feed later.

import { Megaphone } from 'lucide-react';

export function AdSidebar({
  title = 'מקום פרסום זמין',
  body  = 'פרסום ממוקד לקהל שמחפש עובדים ודיור בישראל.',
  cta   = 'לפרטים',
  href  = 'mailto:ads@buildupai.net?subject=%D7%A4%D7%A8%D7%A1%D7%95%D7%9D%20%D7%91%D7%A1%D7%99%D7%99%D7%93%D7%91%D7%A8',
}: {
  title?: string;
  body?:  string;
  cta?:   string;
  href?:  string;
}) {
  return (
    <aside aria-label="פרסומת">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">פרסומת</div>
      <div className="w-full max-w-[300px] rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
        <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center mb-3">
          <Megaphone className="w-5 h-5" />
        </div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{body}</p>
        <a
          href={href}
          className="mt-3 inline-flex items-center bg-brand-800 hover:bg-brand-900 text-white text-xs font-semibold px-3.5 py-2 rounded-lg"
        >
          {cta}
        </a>
      </div>
    </aside>
  );
}
