'use client';

// R21 · /admin/sponsors — the missing operator surface.
//
// Two tabs:
//   * מודעות — full CRUD for sponsor_ads (R21 §2a). Before this
//     screen, every sponsor_ads row was born in a migration.
//   * סלוטים — bookkeeping against sponsor_ads_slots via the
//     existing adminApi (R21 §2b), no new backend written.
//
// Also: sponsor_carousel_limit editor at the top (R21 §3), the
// admin knob that MarketplaceSponsors reads on the public site.
//
// Semantics the form explains inline, because these are the traps:
//   - `target_*` NULL ≡ shown to EVERYONE. Not "no one".
//   - `placements` NULL ≡ search results only. Not "everywhere".
//   - `active=TRUE + ends_at<now` reads as "הסתיימה", not "פעילה".

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Loader2, X, Upload, Info, Pencil, Eye } from 'lucide-react';
import {
  adminApi,
  type SponsorAd,
  type SponsorSlot,
} from '@/lib/adminApi';
import { legalAdminApi, type LegalSettingAdmin } from '@/lib/api/legal';
import { apiFetch } from '@/lib/api/client';
import { enumApi } from '@/lib/api/enums';
import type { Profession } from '@/types';

// ── placement / ad_type dictionaries ────────────────────────────

const PLACEMENTS: { code: string; label_he: string; hint_he: string }[] = [
  { code: 'search_inline',        label_he: 'תוצאות חיפוש',    hint_he: 'מוטמעת בין תוצאות חיפוש' },
  { code: 'marketplace_banner',   label_he: 'באנר קניון',      hint_he: 'רצועה רחבה מעל התוצאות' },
  { code: 'marketplace_carousel', label_he: 'קרוסלת קניון',    hint_he: 'קבוצת כרטיסים בקניון' },
  { code: 'home_banner',          label_he: 'באנר עמוד הבית',  hint_he: 'רצועה רחבה בעמוד הבית' },
  { code: 'home_carousel',        label_he: 'קרוסלת עמוד הבית', hint_he: 'קבוצת כרטיסים בעמוד הבית' },
];

const AD_TYPES: { code: string; label_he: string }[] = [
  { code: 'worker',  label_he: 'פועלים' },
  { code: 'housing', label_he: 'דיור' },
];

// ── format presets — R20 §3 aspect gates ─────────────────────────

const BANNER_ASPECT = 1200 / 628;    // marketplace_banner + home_banner
const CARD_ASPECT   = 1;             // 1080×1080 for carousel + inline

interface CloudinarySig {
  cloud_name: string;
  api_key:    string;
  timestamp:  number;
  signature:  string;
  folder:     string;
  upload_url: string;
}

interface CloudinaryUploadResult {
  secure_url: string;
  width:      number;
  height:     number;
}

// ── page ────────────────────────────────────────────────────────

type Tab = 'ads' | 'slots';

export default function AdminSponsorsPage() {
  const [tab, setTab] = useState<Tab>('ads');

  return (
    <div className="space-y-4 max-w-6xl">
      <CarouselLimitCard />

      <div className="flex gap-2 border-b border-slate-200">
        <TabButton active={tab === 'ads'}   onClick={() => setTab('ads')}>מודעות</TabButton>
        <TabButton active={tab === 'slots'} onClick={() => setTab('slots')}>סלוטים בלעדיים</TabButton>
      </div>

      {tab === 'ads'   ? <AdsTab />   : <SlotsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }:{ active:boolean; onClick:()=>void; children:React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ' +
        (active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-700')
      }
    >
      {children}
    </button>
  );
}

// ── carousel_limit editor ────────────────────────────────────────

function CarouselLimitCard() {
  const [val, setVal]     = useState<string>('');
  const [row, setRow]     = useState<LegalSettingAdmin | null>(null);
  const [saving, setSave] = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  useEffect(() => {
    legalAdminApi.listSettings()
      .then(rows => {
        const r = rows.find(x => x.setting_key === 'sponsor_carousel_limit')
                  ?? { setting_key: 'sponsor_carousel_limit', setting_val: '4', label_he: 'מספר כרטיסים בקרוסלת חסויות', updated_at: '' };
        setRow(r);
        setVal(r.setting_val ?? '4');
      })
      .catch(() => setErr('טעינת ההגדרה נכשלה'));
  }, []);

  async function save() {
    setErr(null);
    setSave(true);
    try {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n) || n < 1) throw new Error('הזן מספר שלם חיובי');
      const clamped = String(Math.min(12, Math.max(1, n)));
      const r = await legalAdminApi.updateSetting('sponsor_carousel_limit', clamped);
      setRow(r);
      setVal(clamped);
    } catch (e) {
      setErr((e as Error).message ?? 'שמירה נכשלה');
    } finally {
      setSave(false);
    }
  }

  if (!row) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-end gap-3">
      <div className="flex-1">
        <label className="block text-xs font-semibold text-slate-600 mb-1">כמות כרטיסים בקרוסלת חסויות</label>
        <input
          type="number"
          min={1} max={12} step={1}
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500 flex items-start gap-1">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          תקרת השרת: 12. מעל 6 — במובייל הקרוסלה נגללת אופקית, וסביר שהאחרונים לא ייראו כמעט אף פעם.
        </p>
      </div>
      <button
        type="button" onClick={save} disabled={saving}
        className="bg-brand-600 hover:bg-brand-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-2"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        שמור
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </section>
  );
}

// ── ads tab ──────────────────────────────────────────────────────

function AdsTab() {
  const [rows, setRows]   = useState<SponsorAd[] | null>(null);
  const [err, setErr]     = useState<string | null>(null);
  const [editing, setEditing] = useState<SponsorAd | null>(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setErr(null);
    try {
      const r = await adminApi.listSponsors();
      setRows(r);
    } catch (e) {
      setErr((e as Error).message ?? 'טעינה נכשלה');
    }
  }
  useEffect(() => { reload(); }, []);

  async function del(id: string) {
    if (!confirm('למחוק את המודעה? הפעולה בלתי הפיכה. כל סלוט שהוזמן למודעה זו יתפנה.')) return;
    await adminApi.deleteSponsor(id);
    await reload();
  }

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-slate-700">
          {rows == null ? 'טוען…' : `${rows.length} מודעות`}
        </h2>
        <button
          onClick={() => setCreating(true)}
          className="bg-brand-600 hover:bg-brand-800 text-white text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> מודעה חדשה
        </button>
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {rows == null ? (
        <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          עדיין אין מודעות. לחץ ״מודעה חדשה״ להוספה.
        </div>
      ) : (
        <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {rows.map(ad => (
            <AdRow key={ad.id} ad={ad} onEdit={() => setEditing(ad)} onDelete={() => del(ad.id)} />
          ))}
        </ul>
      )}

      {(editing || creating) && (
        <AdEditor
          initial={editing}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await reload(); }}
        />
      )}
    </section>
  );
}

function AdRow({ ad, onEdit, onDelete }: { ad: SponsorAd; onEdit: ()=>void; onDelete: ()=>void }) {
  const status = adLifecycleStatus(ad);
  const placements = ad.placements && ad.placements.length > 0
    ? ad.placements
    : ['search_inline'];
  const thumbnail = ad.creative_url ?? ad.logo_url;

  return (
    <li className="p-4 flex items-start gap-4 flex-wrap">
      <div className="w-24 h-16 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="text-[10px] text-slate-400">אין תמונה</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 truncate">{ad.advertiser_name}</span>
          <StatusPill status={status} />
        </div>
        <div className="text-sm text-slate-600 truncate mt-0.5">{ad.headline_he}</div>
        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2">
          <span>מיקומים: {placements.map(p => PLACEMENTS.find(x=>x.code===p)?.label_he ?? p).join(' · ')}</span>
          <TargetSummary ad={ad} />
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={onEdit}  className="p-2 hover:bg-slate-100 rounded-lg" aria-label="ערוך"><Pencil className="w-4 h-4 text-slate-600" /></button>
        <button onClick={onDelete} className="p-2 hover:bg-red-50 rounded-lg" aria-label="מחק"><Trash2 className="w-4 h-4 text-red-600" /></button>
      </div>
    </li>
  );
}

function TargetSummary({ ad }: { ad: SponsorAd }) {
  const parts: string[] = [];
  if (ad.target_ad_types?.length)    parts.push(`סוג: ${ad.target_ad_types.join(', ')}`);
  if (ad.target_professions?.length) parts.push(`מקצועות: ${ad.target_professions.length}`);
  if (ad.target_regions?.length)     parts.push(`אזורים: ${ad.target_regions.length}`);
  if (parts.length === 0) return <span className="text-slate-400">ללא טירגוט (מוצג לכולם)</span>;
  return <span>{parts.join(' · ')}</span>;
}

// active + starts/ends interplay — matches the SQL predicate in
// ads.py:634-635 so the label doesn't lie.
type Lifecycle = 'live' | 'scheduled' | 'ended' | 'off';
function adLifecycleStatus(ad: SponsorAd): Lifecycle {
  if (!ad.active) return 'off';
  const now = Date.now();
  const startsAt = ad.starts_at ? Date.parse(ad.starts_at) : null;
  const endsAt   = ad.ends_at   ? Date.parse(ad.ends_at)   : null;
  if (startsAt && startsAt > now) return 'scheduled';
  if (endsAt   && endsAt   <= now) return 'ended';
  return 'live';
}
function StatusPill({ status }: { status: Lifecycle }) {
  const map: Record<Lifecycle, { label: string; cls: string }> = {
    live:      { label: 'פעילה',    cls: 'bg-emerald-100 text-emerald-700' },
    scheduled: { label: 'מתוזמנת',  cls: 'bg-amber-100 text-amber-700'    },
    ended:     { label: 'הסתיימה',  cls: 'bg-slate-200 text-slate-600'    },
    off:       { label: 'כבויה',    cls: 'bg-slate-100 text-slate-500'    },
  };
  const s = map[status];
  return <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ' + s.cls}>{s.label}</span>;
}

// ── ad editor modal ──────────────────────────────────────────────

interface FormState {
  advertiser_name:    string;
  headline_he:        string;
  body_he:            string;
  cta_label_he:       string;
  cta_url:            string;
  logo_url:           string;
  creative_url:       string;
  creative_w:         string;
  creative_h:         string;
  brand_bg:           string;
  brand_fg:           string;
  target_professions: string[];
  target_ad_types:    string[];
  target_regions:     string[];
  placements:         string[];
  active:             boolean;
  starts_at:          string;      // datetime-local
  ends_at:            string;
  sort_order:         string;
}

function toForm(ad: SponsorAd | null): FormState {
  const dt = (s: string | null) => (s ? s.slice(0, 16) : '');   // to datetime-local shape
  return {
    advertiser_name:    ad?.advertiser_name ?? '',
    headline_he:        ad?.headline_he ?? '',
    body_he:            ad?.body_he ?? '',
    cta_label_he:       ad?.cta_label_he ?? 'למידע נוסף',
    cta_url:            ad?.cta_url ?? '',
    logo_url:           ad?.logo_url ?? '',
    creative_url:       ad?.creative_url ?? '',
    creative_w:         ad?.creative_w != null ? String(ad.creative_w) : '',
    creative_h:         ad?.creative_h != null ? String(ad.creative_h) : '',
    brand_bg:           ad?.brand_bg ?? '',
    brand_fg:           ad?.brand_fg ?? '',
    target_professions: ad?.target_professions ?? [],
    target_ad_types:    ad?.target_ad_types ?? [],
    target_regions:     ad?.target_regions ?? [],
    placements:         ad?.placements ?? [],
    active:             ad?.active ?? false,
    starts_at:          dt(ad?.starts_at ?? null),
    ends_at:            dt(ad?.ends_at ?? null),
    sort_order:         String(ad?.sort_order ?? 0),
  };
}

function AdEditor({
  initial, onCancel, onSaved,
}: { initial: SponsorAd | null; onCancel: ()=>void; onSaved: ()=>Promise<void> }) {
  const [f, setF] = useState<FormState>(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [profs, setProfs] = useState<Profession[]>([]);
  const [regions, setRegions] = useState<{code: string; name_he: string}[]>([]);

  useEffect(() => {
    enumApi.professions().then(setProfs).catch(() => setProfs([]));
    enumApi.regions().then(setRegions).catch(() => setRegions([]));
  }, []);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF(prev => ({ ...prev, [k]: v }));
  }

  async function save() {
    setErr(null);
    // Client-side gates that mirror the backend + the R21 §2a
    // decisions Yulian locked in.
    if (!f.advertiser_name.trim()) return setErr('שם מפרסם חובה');
    if (!f.headline_he.trim())     return setErr('כותרת חובה');
    if (!f.cta_label_he.trim())    return setErr('תווית קריאה לפעולה חובה');
    if (!f.cta_url.trim())         return setErr('קישור CTA חובה (R20 §3c)');

    const creativeSet = [f.creative_url, f.creative_w, f.creative_h].filter(x => x.trim() !== '');
    if (creativeSet.length > 0 && creativeSet.length !== 3) {
      return setErr('כשמעלים תמונה חייבים גם רוחב וגם גובה. השתמש בכפתור ההעלאה.');
    }

    const body: Record<string, unknown> = {
      advertiser_name: f.advertiser_name.trim(),
      headline_he:     f.headline_he.trim(),
      body_he:         f.body_he.trim() || null,
      cta_label_he:    f.cta_label_he.trim(),
      cta_url:         f.cta_url.trim(),
      logo_url:        f.logo_url.trim() || null,
      creative_url:    f.creative_url.trim() || null,
      creative_w:      f.creative_w ? parseInt(f.creative_w, 10) : null,
      creative_h:      f.creative_h ? parseInt(f.creative_h, 10) : null,
      brand_bg:        f.brand_bg.trim() || null,
      brand_fg:        f.brand_fg.trim() || null,
      target_professions: f.target_professions.length ? f.target_professions : null,
      target_ad_types:    f.target_ad_types.length    ? f.target_ad_types    : null,
      target_regions:     f.target_regions.length     ? f.target_regions     : null,
      placements:      f.placements.length ? f.placements : null,
      active:          f.active,
      starts_at:       f.starts_at || null,
      ends_at:         f.ends_at   || null,
      sort_order:      parseInt(f.sort_order || '0', 10) || 0,
    };

    setBusy(true);
    try {
      if (initial) {
        await adminApi.updateSponsor(initial.id, {
          ...body,
          clear_creative: !f.creative_url,
          clear_dates:    !f.starts_at && !f.ends_at,
        });
      } else {
        await adminApi.createSponsor(body);
      }
      await onSaved();
    } catch (e) {
      setErr((e as Error).message ?? 'שמירה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-base font-semibold">
            {initial ? 'עריכת מודעה' : 'מודעה חדשה'}
          </h3>
          <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg" aria-label="סגור"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

          {/* identity */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500">זהות</legend>
            <TextField label="שם מפרסם *" value={f.advertiser_name} onChange={v => set('advertiser_name', v)} />
            <TextField label="כותרת *"     value={f.headline_he}     onChange={v => set('headline_he', v)} />
            <TextField label="גוף (רשות)"   value={f.body_he}         onChange={v => set('body_he', v)} />
            <TextField label="תווית CTA *" value={f.cta_label_he}    onChange={v => set('cta_label_he', v)} />
            <TextField label="קישור CTA *" value={f.cta_url} onChange={v => set('cta_url', v)}
                       hint="הקישור לאתר המפרסם — נדרש (R20 §3c)." />
          </fieldset>

          {/* creative */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500">תמונה</legend>
            <CreativeUploader
              creativeUrl={f.creative_url}
              creativeW={f.creative_w ? parseInt(f.creative_w,10) : null}
              creativeH={f.creative_h ? parseInt(f.creative_h,10) : null}
              placements={f.placements}
              onChange={(url, w, h) => {
                set('creative_url', url ?? '');
                set('creative_w',   w != null ? String(w) : '');
                set('creative_h',   h != null ? String(h) : '');
              }}
            />
            <TextField label="לוגו (אופציונלי — לתצוגת ברירת מחדל בלי תמונה)"
                       value={f.logo_url} onChange={v => set('logo_url', v)} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="רקע מותג (#RRGGBB)" value={f.brand_bg} onChange={v => set('brand_bg', v)} placeholder="#0f172a" />
              <TextField label="טקסט מותג (#RRGGBB)" value={f.brand_fg} onChange={v => set('brand_fg', v)} placeholder="#ffffff" />
            </div>
          </fieldset>

          {/* placements */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500">מיקומים</legend>
            <MultiPicker
              options={PLACEMENTS.map(p => ({ code: p.code, label: p.label_he }))}
              value={f.placements}
              onChange={v => set('placements', v)}
            />
            <p className="text-xs text-slate-500 flex items-start gap-1">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              ריק = תוצאות חיפוש בלבד. לא ״כל המיקומים״.
            </p>
          </fieldset>

          {/* targeting */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500">טירגוט</legend>
            <div>
              <div className="text-xs text-slate-600 mb-1">סוג מודעה</div>
              <MultiPicker
                options={AD_TYPES.map(a => ({ code: a.code, label: a.label_he }))}
                value={f.target_ad_types}
                onChange={v => set('target_ad_types', v)}
              />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">מקצועות ({f.target_professions.length}/{profs.length})</div>
              <MultiPicker
                options={profs.map(p => ({ code: p.code, label: p.name_he || p.code }))}
                value={f.target_professions}
                onChange={v => set('target_professions', v)}
                compact
              />
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-1">אזורים ({f.target_regions.length}/{regions.length})</div>
              <MultiPicker
                options={regions.map(r => ({ code: r.code, label: r.name_he || r.code }))}
                value={f.target_regions}
                onChange={v => set('target_regions', v)}
                compact
              />
            </div>
            <p className="text-xs text-slate-500 flex items-start gap-1">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              ריק = מוצג לכולם. שדה טירגוט ריק דווקא פותח לכל הקהל, לא סוגר.
            </p>
          </fieldset>

          {/* lifecycle */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500">חלון תאריכים ומצב</legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">מתאריך (רשות)</label>
                <input type="datetime-local" value={f.starts_at} onChange={e => set('starts_at', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">עד תאריך (רשות)</label>
                <input type="datetime-local" value={f.ends_at}   onChange={e => set('ends_at', e.target.value)}   className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} />
                מודעה פעילה
              </label>
              <div>
                <label className="block text-xs text-slate-600 mb-1">סדר</label>
                <input type="number" value={f.sort_order} onChange={e => set('sort_order', e.target.value)} className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </fieldset>

          {/* where will this ad appear preview */}
          <WillAppearPreview form={f} />
        </div>

        <div className="p-4 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">ביטול</button>
          <button onClick={save} disabled={busy}
                  className="bg-brand-600 hover:bg-brand-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            שמור
          </button>
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, hint, placeholder }: {
  label: string; value: string; onChange:(v:string)=>void; hint?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      <input type="text" value={value} placeholder={placeholder}
             onChange={e => onChange(e.target.value)}
             className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function MultiPicker({ options, value, onChange, compact }:{
  options: { code: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
}) {
  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  }
  return (
    <div className={'flex flex-wrap gap-1.5 ' + (compact ? 'max-h-32 overflow-y-auto p-1 border border-slate-200 rounded-lg' : '')}>
      {options.map(o => (
        <button key={o.code} type="button" onClick={() => toggle(o.code)}
                className={
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ' +
                  (value.includes(o.code)
                    ? 'bg-brand-100 border-brand-400 text-brand-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
                }>
          {o.label}
        </button>
      ))}
      {options.length === 0 && <span className="text-xs text-slate-400 px-2">— אין —</span>}
    </div>
  );
}

// ── creative uploader with preview ──────────────────────────────

function CreativeUploader({ creativeUrl, creativeW, creativeH, placements, onChange }:{
  creativeUrl: string;
  creativeW:   number | null;
  creativeH:   number | null;
  placements:  string[];
  onChange: (url: string | null, w: number | null, h: number | null) => void;
}) {
  const [sig, setSig]     = useState<CloudinarySig | null>(null);
  const [checked, setChk] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);
  const fileRef           = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<CloudinarySig>('/uploads/cloudinary-signature')
      .then(setSig).catch(() => setSig(null))
      .finally(() => setChk(true));
  }, []);

  const expectsBanner = placements.some(p => p === 'marketplace_banner' || p === 'home_banner');
  const expectsCard   = placements.some(p => p === 'marketplace_carousel' || p === 'home_carousel');
  const hint = expectsBanner && expectsCard
    ? 'המודעה משמשת גם בבאנר (1200×628) וגם בקרוסלה (1080×1080). בחר אחד ותכין נכס נפרד לשני.'
    : expectsBanner
      ? 'מומלץ 1200×628 (יחס באנר).'
      : expectsCard
        ? 'מומלץ 1080×1080 (יחס ריבועי).'
        : 'ריק (חיפוש בלבד) — כל יחס יעבוד; רצוי 1080×1080.';

  async function upload(file: File) {
    setErr(null);
    // Client-side gate: jpg/png/webp, no svg (spec §2a).
    const ok = ['image/jpeg','image/png','image/webp'].includes(file.type);
    if (!ok) return setErr('רק JPG / PNG / WebP. SVG לא נתמך.');
    if (!sig) return setErr('Cloudinary לא מוגדר. הדבק כתובת ידנית.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file',      file);
      form.append('api_key',   sig.api_key);
      form.append('timestamp', String(sig.timestamp));
      form.append('signature', sig.signature);
      form.append('folder',    sig.folder);
      const r = await fetch(sig.upload_url, { method: 'POST', body: form });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Cloudinary ${r.status}: ${t.slice(0,120)}`);
      }
      const data = await r.json() as CloudinaryUploadResult;
      onChange(data.secure_url, data.width, data.height);
    } catch (e) {
      setErr((e as Error).message ?? 'העלאה נכשלה');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {creativeUrl ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>
              נטענה תמונה{creativeW && creativeH ? ` · ${creativeW}×${creativeH}px (יחס ${(creativeW/creativeH).toFixed(2)})` : ''}
            </span>
            <button type="button" onClick={() => onChange(null, null, null)} className="text-red-600 hover:text-red-800 text-xs font-medium">הסר</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-slate-500 mb-1">מובייל (~380px רוחב)</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50" style={{ width: 200 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={creativeUrl} alt="" className="w-full h-auto object-contain" />
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">דסקטופ</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50" style={{ width: 380 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={creativeUrl} alt="" className="w-full h-auto object-contain" />
              </div>
            </div>
          </div>
        </div>
      ) : !checked ? (
        <div className="text-xs text-slate-400 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> בודק תצורת העלאה…</div>
      ) : sig ? (
        <label className="block cursor-pointer">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-brand-400 hover:bg-brand-50/30 transition">
            {busy ? <Loader2 className="w-6 h-6 mx-auto animate-spin text-slate-400" /> : (
              <>
                <Upload className="w-6 h-6 mx-auto text-slate-400" />
                <p className="text-sm font-semibold text-slate-700 mt-2">העלה תמונה</p>
                <p className="text-xs text-slate-500 mt-1">JPG / PNG / WebP · {hint}</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                 onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      ) : (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Cloudinary לא מוגדר בשרת. הדבק כתובת תמונה ידנית.
        </div>
      )}
      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
    </div>
  );
}

// ── "where will this ad appear" preview ─────────────────────────

function WillAppearPreview({ form }: { form: FormState }) {
  const parts: string[] = [];
  const placements = form.placements.length > 0 ? form.placements : ['search_inline'];
  parts.push('מיקומים: ' + placements.map(p => PLACEMENTS.find(x => x.code === p)?.label_he ?? p).join(' · '));
  if (form.target_ad_types.length) {
    parts.push('סוג: ' + form.target_ad_types.map(c => AD_TYPES.find(x=>x.code===c)?.label_he ?? c).join(' / '));
  }
  if (form.target_professions.length) {
    parts.push(`מקצועות: ${form.target_professions.length} מסומנים`);
  }
  if (form.target_regions.length) {
    parts.push(`אזורים: ${form.target_regions.length} מסומנים`);
  }
  if (!form.target_ad_types.length && !form.target_professions.length && !form.target_regions.length) {
    parts.push('טירגוט: לכל הקהל');
  }
  return (
    <div className="rounded-lg bg-brand-50 border border-brand-200 p-3 flex items-start gap-2">
      <Eye className="w-4 h-4 text-brand-700 mt-0.5 shrink-0" />
      <div className="text-xs text-brand-800">
        <div className="font-semibold mb-0.5">איפה המודעה הזו תופיע</div>
        <div>{parts.join(' · ')}</div>
      </div>
    </div>
  );
}

// ── slots tab ────────────────────────────────────────────────────

function SlotsTab() {
  const [rows, setRows]  = useState<SponsorSlot[] | null>(null);
  const [err, setErr]    = useState<string | null>(null);

  useEffect(() => {
    adminApi.listSponsorSlots()
      .then(setRows)
      .catch(e => setErr((e as Error).message ?? 'טעינה נכשלה'));
  }, []);

  return (
    <section className="space-y-4">
      <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
        <div>
          <div className="font-semibold text-amber-900">סלוט מוזמן הוא בלעדי</div>
          כל עוד החלון פתוח, רק המודעה שמוזמנת לסלוט תופיע ב-(קטגוריה, מיקום) הזה,
          והמאגר הרגיל של המודעות מדולג. מי שמזמין סלוט משתיק את כל שאר המפרסמים
          במיקום הזה.
        </div>
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {rows == null ? (
        <div className="text-sm text-slate-400 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          אין סלוטים מוגדרים. מסך יצירת סלוטים ייבנה בשלב R6-slots-admin.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-start px-3 py-2">מיקום</th>
                <th className="text-start px-3 py-2">קטגוריה</th>
                <th className="text-start px-3 py-2">מ־</th>
                <th className="text-start px-3 py-2">עד</th>
                <th className="text-start px-3 py-2">מחיר</th>
                <th className="text-start px-3 py-2">מודעה מוזמנת</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{PLACEMENTS.find(p => p.code === r.placement)?.label_he ?? r.placement}</td>
                  <td className="px-3 py-2 text-slate-500">{r.category_code ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtDate(r.starts_at)}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtDate(r.ends_at)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.price_nis} ₪</td>
                  <td className="px-3 py-2">{r.advertiser_name ?? <span className="text-slate-400">— לא הוזמן —</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', {
      dateStyle: 'short', timeStyle: 'short',
    });
  } catch { return iso; }
}
