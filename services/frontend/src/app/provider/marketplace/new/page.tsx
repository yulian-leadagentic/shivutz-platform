'use client';

// R34 §4a · the provider's own listing form.
//
// This route used to re-export the corporation page, which branched on
// entityType. The two had already pulled apart in ways a branch did not
// cover: after publishing, the shared form sent everyone to
// /corporation/marketplace, a route the guard closes to a provider; its
// default category was housing, which the server refuses a provider; and
// its max-w-2xl was sized for the space beside the corporation sidebar.
// Everything still to come for this form in R34 (plan-gated categories,
// per-category fields) is provider-only as well, so each item would have
// added another branch to a file whose corporation half must not move.
//
// The corporation form keeps the housing-only "מרוהטת" flag; a provider
// cannot publish housing, so the flag is not offered here.
//
// R34 §4b · the category choice follows the plans. A provider publishes
// only where it has a running plan (R33 B), so those categories are the
// picker; the rest are listed as locked, each with the way to open it.
// One category with a plan is shown as a fixed chip. Housing is never
// offered, and ?category=housing is dropped.
//
// R34 §4c · what the form asks follows the category. Every category
// gets the common fields: title, description, the regions served,
// contact name and phone, photos. Under them come the category's own
// questions, drawn from its field_schema (data on the category row, in
// the catalog). The housing-style fields this form inherited (city, one
// region, a monthly price, capacity, "available from") are gone: a
// category that has a price asks for it in its own terms.

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, Lock, Plus } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { type ListingAudience, marketplaceApi } from '@/lib/api/marketplace';
import {
  marketplaceSubscriptionsApi,
  type CatalogCategory,
  type CategoryFieldSchema,
} from '@/lib/api/marketplaceSubscriptions';
import { isProviderCategory } from '@/lib/providerCategories';
import { useEnums } from '@/features/enums/EnumsContext';
import CategoryFields, { toAttributes, type FieldValues } from '@/components/marketplace/CategoryFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ImageUploader from '@/components/marketplace/ImageUploader';

// A category the provider has a running plan in, with the plan's size
// and how much of it is in use.
type OpenCategory   = { value: string; label: string; used: number; total: number };
// An active category with no running plan: shown, not selectable.
type LockedCategory = { value: string; label: string };

const ADD_PLAN = '/provider/marketplace/subscribe';
const BILLING  = '/provider/billing';

// R38 3a · who the listing is for. The labels are the ones the prompt
// gives; the values are the server's (services/visibility.py).
const AUDIENCE_OPTIONS: { value: ListingAudience; label: string }[] = [
  { value: 'contractors',  label: 'קבלנים' },
  { value: 'corporations', label: 'תאגידי כוח אדם' },
  { value: 'both',         label: 'שניהם' },
];

// The regions catalogue's code for "the whole country".
const ANYWHERE = 'national';

// Input.tsx's look for the two controls it does not cover, so a select
// beside an Input in a two-column row lines up with it.
const CONTROL = 'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 hover:border-slate-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
const LABEL   = 'text-start text-sm font-medium text-slate-700';
// One column on a phone, two from sm up, for fields short enough to share a row.
const PAIR    = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
const PILL    = 'inline-flex min-h-11 items-center rounded-full border px-4 text-sm';

export default function NewProviderListingPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const descriptionId = useId();
  const { regions: regionOptions } = useEnums();

  // R5 §2b · the dashboard button and the welcome email pass
  // ?category=<code>. R10 §4 · /register/provider also passes the
  // contact name and phone the provider typed a minute earlier, so the
  // very next screen does not ask for them again. All of it is a first
  // draft the provider can still edit. (It passes the city too; the
  // form asks for regions now, so the city is not read.)
  //
  // A housing hint is dropped rather than honoured. '' means "nothing
  // chosen yet"; the effect below replaces it, and any hint the provider
  // has no plan in, with the first category it can publish in.
  const hint = searchParams?.get('category') || '';

  const [form, setForm] = useState({
    category:       isProviderCategory(hint) ? hint : '',
    title:          '',
    description:    '',
    contact_name:   searchParams?.get('contact_name')  || '',
    contact_phone:  searchParams?.get('contact_phone') || '',
  });
  // Region codes the listing serves. 'national' stands for all of them.
  const [regions, setRegions] = useState<string[]>([]);
  // R38 3a · who the listing is for. No answer is chosen for the
  // provider: it is a required question, not a default to overlook.
  const [audience, setAudience] = useState<ListingAudience | ''>('');
  // The answers to the chosen category's questions, as typed, and the
  // server's complaint about each, when it has one.
  const [answers,     setAnswers]     = useState<FieldValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [schemas,     setSchemas]     = useState<Record<string, CategoryFieldSchema | null>>({});
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  // R33 B.1 · set when the server refused the listing for want of room
  // in a plan (402): the page that fixes it, as a link under the message.
  const [fix, setFix] = useState<{ href: string; label: string } | null>(null);

  const [open,        setOpen]        = useState<OpenCategory[]>([]);
  const [locked,      setLocked]      = useState<LockedCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [catsFailed,  setCatsFailed]  = useState(false);

  // The provider's plans decide the picker; the catalog only adds the
  // locked categories and the display order. So a catalog failure costs
  // the locked list, and a plans failure is an error with a retry: a
  // guessed list would offer categories the server then refuses.
  const loadCategories = useCallback(async () => {
    setCatsLoading(true); setCatsFailed(false);
    try {
      const [plans, catalog] = await Promise.all([
        marketplaceSubscriptionsApi.mine(),
        marketplaceSubscriptionsApi.catalog().catch((): CatalogCategory[] => []),
      ]);
      const order = new Map(catalog.map((c, i) => [c.code, i]));
      setSchemas(Object.fromEntries(catalog.map((c) => [c.code, c.field_schema ?? null])));
      const withPlan: OpenCategory[] = plans
        .filter((s) => s.is_current && isProviderCategory(s.category_code))
        .map((s) => ({
          value: s.category_code,
          label: s.category_name_he || s.category_code,
          used:  s.slots_used ?? 0,
          total: s.slot_count,
        }))
        .sort((a, b) => (order.get(a.value) ?? Infinity) - (order.get(b.value) ?? Infinity));
      setOpen(withPlan);
      setLocked(
        catalog
          .filter((c) => isProviderCategory(c.code) && !withPlan.some((o) => o.value === c.code))
          .map((c) => ({ value: c.code, label: c.name_he })),
      );
      // Only replaces a category the provider cannot publish in, so it
      // never undoes one picked by hand.
      setForm((f) => (withPlan.some((c) => c.value === f.category) ? f : { ...f, category: withPlan[0]?.value ?? '' }));
    } catch {
      setCatsFailed(true);
    } finally {
      setCatsLoading(false);
    }
  }, []);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const selected     = open.find((c) => c.value === form.category);
  const selectedFull = !!selected && selected.used >= selected.total;
  const noPlan       = !catsLoading && !catsFailed && open.length === 0;

  const schema = schemas[form.category] ?? null;

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Another category asks other questions: the answers start over.
  function pickCategory(code: string) {
    if (code === form.category) return;
    update('category', code);
    setAnswers({}); setFieldErrors({});
  }

  function answer(key: string, value: string | boolean | string[]) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  }

  // "כל הארץ" and a list of regions are two different answers; picking
  // one clears the other.
  function toggleRegion(code: string) {
    setRegions((r) => {
      if (code === ANYWHERE) return r.includes(ANYWHERE) ? [] : [ANYWHERE];
      const rest = r.filter((x) => x !== ANYWHERE);
      return rest.includes(code) ? rest.filter((x) => x !== code) : [...rest, code];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('כותרת היא שדה חובה'); return; }
    if (!audience) {
      setFieldErrors({ audience: 'יש לבחור קהל יעד' });
      setError('יש לבחור קהל יעד למודעה.');
      document.getElementById('audience-group')?.focus();
      return;
    }
    setSaving(true); setError(''); setFix(null); setFieldErrors({});
    try {
      await marketplaceApi.create({
        category:       form.category,
        title:          form.title.trim(),
        description:    form.description || undefined,
        regions:        regions.length > 0 ? regions : undefined,
        audience,
        attributes:     schema ? toAttributes(schema, answers) : undefined,
        contact_phone:  form.contact_phone || undefined,
        contact_name:   form.contact_name || undefined,
        images_json:    images.length > 0 ? images : undefined,
      });
      router.push('/provider/dashboard#my-listings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בפרסום');
      // The server checks the answers against the category's schema and
      // names each one it will not take.
      if (err instanceof ApiError && err.cause.status === 400) {
        const details = err.cause.details as { fields?: Record<string, string> } | undefined;
        if (details?.fields) setFieldErrors(details.fields);
      }
      // No plan in this category, or the plan is full. The picker
      // above already keeps both from happening, so this is a plan that
      // changed while the form was open. The server sends the page that
      // fixes it; anything else has no link.
      if (err instanceof ApiError && err.cause.status === 402) {
        const details = err.cause.details as { code?: string; buy_url?: string | null } | undefined;
        const category = encodeURIComponent(form.category);
        setFix(details?.code === 'no_slots_available'
          ? { href: details.buy_url || `${BILLING}?category=${category}`, label: 'מנוי ותשלום' }
          : { href: details?.buy_url || `${ADD_PLAN}?category=${category}`, label: 'הוספת מסלול בקטגוריה' });
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        {/* A link to the dashboard, not router.back(): a provider who
            arrives here straight from registration would be sent back
            into the registration form. */}
        <Link
          href="/provider/dashboard"
          aria-label="חזרה ללוח הבקרה"
          className="-ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:rounded-lg"
        >
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">מודעה חדשה</h1>
          <p className="text-sm text-slate-500">המודעה נכללת במסלול שלך בקטגוריה</p>
        </div>
      </div>

      {noPlan ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-base font-semibold text-slate-900">אין לך מסלול פעיל</p>
            <p className="text-sm text-slate-600">כדי לפרסם מודעה יש להוסיף מסלול בקטגוריה.</p>
            <Button asChild size="lg">
              <Link href={isProviderCategory(hint) && hint ? `${ADD_PLAN}?category=${encodeURIComponent(hint)}` : ADD_PLAN}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                הוספת מסלול
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">פרטי המודעה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="min-w-0 space-y-2">
              <legend className={LABEL}>קטגוריה *</legend>
              <div className="flex flex-wrap gap-2">
                {catsLoading ? (
                  // Pill-sized placeholders so the form does not jump
                  // when the real list arrives.
                  Array.from({ length: 3 }).map((_, i) => (
                    <span
                      key={i}
                      aria-hidden="true"
                      className={`${PILL} select-none border-slate-200 bg-slate-100 text-transparent`}
                    >
                      טוען
                    </span>
                  ))
                ) : catsFailed ? (
                  <div role="alert" className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      לא הצלחנו לטעון את המסלולים שלך.
                    </span>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadCategories()}>
                      נסו שוב
                    </Button>
                  </div>
                ) : open.length === 1 ? (
                  // A picker with a single option reads like a load bug.
                  <span className={`${PILL} border-brand-200 bg-brand-50 font-semibold text-brand-800`}>
                    {open[0].label}
                  </span>
                ) : (
                  open.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={form.category === c.value}
                      onClick={() => pickCategory(c.value)}
                      className={`${PILL} font-medium focus-visible:rounded-full ${
                        form.category === c.value
                          ? 'border-brand-600 bg-brand-600 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-brand-300'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))
                )}
              </div>

              {selected && (
                <p className={`text-xs ${selectedFull ? 'text-amber-800' : 'text-slate-500'}`}>
                  {selected.used} מתוך {selected.total} מודעות בשימוש במסלול.
                  {selectedFull && (
                    <>
                      {' '}כדי לפרסם מודעה נוספת יש לשדרג את המסלול או להשהות מודעה קיימת.{' '}
                      <Link
                        href={`${BILLING}?category=${encodeURIComponent(selected.value)}`}
                        className="font-semibold underline underline-offset-2"
                      >
                        מנוי ותשלום
                      </Link>
                    </>
                  )}
                </p>
              )}

              {locked.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-slate-500">קטגוריות ללא מסלול פעיל</p>
                  <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-dashed border-slate-300">
                    {locked.map((c) => (
                      <li key={c.value} className="flex flex-wrap items-center justify-between gap-x-3 px-3">
                        <span className="flex items-center gap-2 text-sm text-slate-500">
                          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {c.label}
                        </span>
                        <Link
                          href={`${ADD_PLAN}?category=${encodeURIComponent(c.value)}`}
                          aria-label={`הוספת מסלול בקטגוריה ${c.label}`}
                          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-800 underline underline-offset-2 focus-visible:rounded"
                        >
                          הוספת מסלול בקטגוריה
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </fieldset>

            <Input
              label="כותרת *"
              placeholder="כותרת קצרה שמתארת את השירות"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              required
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor={descriptionId} className={LABEL}>תיאור</label>
              <textarea
                id={descriptionId}
                rows={3}
                placeholder="פרטים נוספים על השירות..."
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                className={`${CONTROL} resize-none py-2`}
              />
            </div>

            <fieldset className="min-w-0 space-y-2">
              <legend className={LABEL}>אזורי שירות</legend>
              <div className="flex flex-wrap gap-2">
                {regionOptions.map((r) => {
                  const on = regions.includes(r.code);
                  return (
                    <button
                      key={r.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleRegion(r.code)}
                      className={`${PILL} font-medium focus-visible:rounded-full ${
                        on
                          ? 'border-brand-600 bg-brand-600 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-brand-300'
                      }`}
                    >
                      {r.name_he}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset
              id="audience-group"
              tabIndex={-1}
              className="min-w-0 space-y-2 focus:outline-none"
              aria-describedby={fieldErrors.audience ? 'audience-error' : undefined}
            >
              <legend className={LABEL}>קהל יעד *</legend>
              <div role="radiogroup" aria-required="true" className="flex flex-wrap gap-2">
                {AUDIENCE_OPTIONS.map((o) => {
                  const on = audience === o.value;
                  return (
                    <label
                      key={o.value}
                      className={`${PILL} inline-flex cursor-pointer items-center gap-2 font-medium focus-within:ring-2 focus-within:ring-brand-500 ${
                        on
                          ? 'border-brand-600 bg-brand-600 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-brand-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value={o.value}
                        checked={on}
                        onChange={() => {
                          setAudience(o.value);
                          setFieldErrors(({ audience: _gone, ...rest }) => rest);
                        }}
                        className="sr-only"
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">מי יראה את המודעה בחיפוש ובעמוד השירותים הנלווים.</p>
              {fieldErrors.audience && (
                <p id="audience-error" role="alert" className="text-xs font-medium text-red-700">{fieldErrors.audience}</p>
              )}
            </fieldset>

            {schema && (
              <CategoryFields schema={schema} values={answers} errors={fieldErrors} onChange={answer} />
            )}

            <div className={PAIR}>
              <Input label="שם איש קשר" placeholder="משה לוי" value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
              <Input label="טלפון ליצירת קשר" type="tel" dir="ltr" placeholder="050-1234567" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
            </div>

            <ImageUploader value={images} onChange={setImages} />

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
                {fix && (
                  <>
                    {' '}
                    <Link href={fix.href} className="font-semibold underline underline-offset-2">
                      {fix.label}
                    </Link>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" size="lg" disabled={saving || !selected || selectedFull} className="flex-1 sm:flex-none">
                {saving ? <><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />מפרסם…</> : 'פרסם מודעה'}
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/provider/dashboard">ביטול</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
      )}
    </div>
  );
}
