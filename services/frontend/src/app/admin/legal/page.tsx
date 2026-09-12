'use client';

// L10 §4 · admin legal editor. Two tabs: documents + settings.
//
// Documents: three rows (terms / privacy / accessibility). Each edit
// bumps version + writes a history row on save (backend handles both,
// see admin/routes/legal.py). is_draft toggle removes the amber
// disclaimer on the public page. Live preview reuses the SAME
// renderLegalMarkdown from the public page — the same sanitisation
// runs before whatever an admin types is shown back to them.
//
// Settings: seven keyed rows shown by label_he, empty saved as NULL.
// A warning banner fires when a11y_coordinator lacks contact info
// (spec §2b — the public page also hides the section in that state).

import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Save, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  legalAdminApi,
  type LegalDocAdmin,
  type LegalSettingAdmin,
  type LegalSlug,
} from '@/lib/api/legal';
import { renderLegalMarkdown } from '@/lib/legal-render';
import { mapApiError } from '@/lib/api/errors';

const SLUG_LABEL: Record<LegalSlug, string> = {
  terms:         'תנאי שימוש',
  privacy:       'מדיניות פרטיות',
  accessibility: 'הצהרת נגישות',
};

export default function AdminLegalPage() {
  const [tab, setTab] = useState<'docs' | 'settings'>('docs');
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4" dir="rtl">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">תוכן משפטי</h1>
        <p className="text-sm text-slate-500">עריכת דפי /terms, /privacy ו-/accessibility וההגדרות שמושכות למקומות מרובים באתר.</p>
      </header>
      <div className="flex gap-2 border-b border-slate-200">
        <button type="button" onClick={() => setTab('docs')}
                className={`px-4 py-2 text-sm font-medium border-b-2 ${tab==='docs' ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          מסמכים
        </button>
        <button type="button" onClick={() => setTab('settings')}
                className={`px-4 py-2 text-sm font-medium border-b-2 ${tab==='settings' ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          הגדרות
        </button>
      </div>
      {tab === 'docs' ? <DocsTab /> : <SettingsTab />}
    </div>
  );
}

// ── Documents tab ────────────────────────────────────────────────────

function DocsTab() {
  const [docs, setDocs] = useState<LegalDocAdmin[]>([]);
  const [selected, setSelected] = useState<LegalSlug | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const rows = await legalAdminApi.listDocs();
      setDocs(rows);
      if (!selected && rows[0]) setSelected(rows[0].slug);
    } catch (e) { setError(mapApiError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const current = docs.find((d) => d.slug === selected) || null;

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;
  if (error)   return <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
      <aside className="space-y-1">
        {docs.map((d) => (
          <button key={d.slug} type="button" onClick={() => setSelected(d.slug)}
                  className={`w-full text-start rounded-lg px-3 py-2 text-sm border ${selected===d.slug ? 'bg-brand-50 border-brand-300 text-brand-800' : 'bg-white border-slate-200 hover:border-brand-300 text-slate-700'}`}>
            <div className="font-semibold">{SLUG_LABEL[d.slug]}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              גרסה {d.version} · {d.is_draft ? <span className="text-amber-700 font-medium">טיוטה</span> : <span className="text-emerald-700 font-medium">מאושר</span>}
            </div>
          </button>
        ))}
      </aside>
      {current && <DocEditor key={current.slug} doc={current} onSaved={refresh} />}
    </div>
  );
}

function DocEditor({ doc, onSaved }: { doc: LegalDocAdmin; onSaved: () => void }) {
  const [body, setBody] = useState(doc.body_md);
  const [title, setTitle] = useState(doc.title_he);
  const [effectiveAt, setEffectiveAt] = useState(doc.effective_at ?? '');
  const [isDraft, setIsDraft] = useState(doc.is_draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Live-preview HTML — reuses the exact renderer used by the public
  // page, so what an admin sees under 'תצוגה מקדימה' is bit-identical
  // to what a visitor will see after save.
  const previewHtml = useMemo(() => renderLegalMarkdown(body), [body]);

  async function save() {
    setSaving(true); setError('');
    try {
      await legalAdminApi.updateDoc(doc.slug, {
        title_he:     title,
        body_md:      body,
        effective_at: effectiveAt || undefined,
        is_draft:     isDraft,
      });
      onSaved();
    } catch (e) { setError(mapApiError(e)); }
    finally { setSaving(false); }
  }

  return (
    <section className="space-y-3">
      {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600 flex-1 min-w-[200px]">
          כותרת
          <input value={title} onChange={(e) => setTitle(e.target.value)}
                 className="mt-1 block w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          תאריך תוקף (עודכן לאחרונה)
          <input type="date" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)}
                 className="mt-1 block border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600 inline-flex items-center gap-2 h-9 pt-4">
          <input type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} />
          <span>טיוטה — מציג באנר טיוטה בעמוד הציבורי</span>
        </label>
        <button type="button" onClick={save} disabled={saving}
                className="h-9 inline-flex items-center gap-1 text-sm font-semibold text-slate-900 bg-brand-600 hover:bg-brand-500 rounded px-4 disabled:bg-slate-300">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          שמור
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">Markdown</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
                    className="w-full h-[520px] border border-slate-300 rounded p-3 text-sm font-mono leading-relaxed"
                    spellCheck={false} />
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">תצוגה מקדימה</div>
          <div className="border border-slate-200 rounded p-3 h-[520px] overflow-y-auto legal-content prose prose-slate max-w-none"
               dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
      <p className="text-xs text-slate-500">שמירה מגדילה את מספר הגרסה ב-1 ורושמת את הגרסה הקודמת ל-history. אין שחזור בסבב הזה.</p>
    </section>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────

function SettingsTab() {
  const [rows, setRows] = useState<LegalSettingAdmin[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function refresh() {
    setLoading(true); setError('');
    try {
      const list = await legalAdminApi.listSettings();
      setRows(list);
      const d: Record<string, string> = {};
      for (const r of list) d[r.setting_key] = r.setting_val ?? '';
      setDrafts(d);
    } catch (e) { setError(mapApiError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // §2b · admin warning when a11y coordinator lacks contact info
  const cName  = rows.find((r) => r.setting_key === 'a11y_coordinator_name')?.setting_val?.trim() || '';
  const cPhone = rows.find((r) => r.setting_key === 'a11y_coordinator_phone')?.setting_val?.trim() || '';
  const cEmail = rows.find((r) => r.setting_key === 'a11y_coordinator_email')?.setting_val?.trim() || '';
  const showA11yWarn = !!cName && !cPhone && !cEmail;

  async function save(key: string) {
    setSavingKey(key); setError('');
    try {
      await legalAdminApi.updateSetting(key, drafts[key] || null);
      await refresh();
    } catch (e) { setError(mapApiError(e)); }
    finally { setSavingKey(null); }
  }

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;

  return (
    <div className="space-y-3">
      {showA11yWarn && (
        <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            הצהרת הנגישות אינה מלאה — חסרים פרטי התקשרות לרכז הנגישות (טלפון או מייל). המקטע אינו מוצג לציבור עד שיושלמו.
          </div>
        </div>
      )}
      {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-start px-3 py-2 font-semibold">שדה</th>
              <th className="text-start px-3 py-2 font-semibold">ערך</th>
              <th className="text-start px-3 py-2 font-semibold">פעולה</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((r) => (
              <tr key={r.setting_key}>
                <td className="px-3 py-2 text-slate-800 whitespace-nowrap">
                  <div className="font-medium">{r.label_he}</div>
                  <div className="text-xs text-slate-500">{r.setting_key}</div>
                </td>
                <td className="px-3 py-2">
                  <input value={drafts[r.setting_key] ?? ''}
                         onChange={(e) => setDrafts({ ...drafts, [r.setting_key]: e.target.value })}
                         placeholder="לא הוגדר (יישמר NULL)"
                         className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
                </td>
                <td className="px-3 py-2">
                  <button type="button" disabled={savingKey === r.setting_key} onClick={() => save(r.setting_key)}
                          className="h-8 inline-flex items-center gap-1 text-xs font-semibold text-slate-900 bg-brand-600 hover:bg-brand-500 rounded px-3 disabled:bg-slate-300">
                    {savingKey === r.setting_key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    שמור
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">שדה ריק נשמר כ-NULL, לא כמחרוזת ריקה. פרטים חסרים גורמים למקטעים באתר להישאר לא-מוצגים במקום להציג ערך חלקי.</p>
    </div>
  );
}
