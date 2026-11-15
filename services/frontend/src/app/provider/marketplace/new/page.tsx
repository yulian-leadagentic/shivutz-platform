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

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { marketplaceApi } from '@/lib/api/marketplace';
import { marketplaceSubscriptionsApi } from '@/lib/api/marketplaceSubscriptions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ImageUploader from '@/components/marketplace/ImageUploader';

type Category = { value: string; label: string };

// Housing rides on a corporation's licence and is published from the
// corporation area only. The server answers a provider's housing listing
// with 403 provider_category_forbidden; leaving it out of the picker
// just spares the provider that round trip.
const CORPORATION_ONLY_CATEGORY = 'housing';

// Shown only when the catalog request fails or has nothing a provider
// may use, because an empty picker reads as a broken page. The real
// list is GET /marketplace/subscriptions/catalog; add categories in
// /admin/marketplace, not here.
const FALLBACK_CATEGORIES: Category[] = [
  { value: 'equipment', label: 'ציוד' },
  { value: 'services',  label: 'שירותים' },
  { value: 'other',     label: 'אחר' },
];

const PRICE_UNITS = [
  { value: 'per_month',  label: 'לחודש' },
  { value: 'per_night',  label: 'ללילה' },
  { value: 'fixed',      label: 'מחיר קבוע' },
  { value: 'negotiable', label: 'למשא ומתן' },
];

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
  const priceUnitId   = useId();

  // R5 §2b · the dashboard button and the welcome email pass
  // ?category=<code>. R10 §4 · /register/provider also passes the
  // contact name, phone and city the provider typed a minute earlier,
  // so the very next screen does not ask for them again. All of it is a
  // first draft the provider can still edit.
  //
  // A housing hint is dropped rather than honoured. '' means "nothing
  // chosen yet"; the catalog effect below replaces it, and any hint the
  // catalog does not list, with the first category a provider may use.
  const hint = searchParams?.get('category') || '';

  const [form, setForm] = useState({
    category:       hint === CORPORATION_ONLY_CATEGORY ? '' : hint,
    title:          '',
    description:    '',
    city:           searchParams?.get('city') || '',
    region:         '',
    price:          '',
    price_unit:     'per_month',
    capacity:       '',
    available_from: '',
    contact_name:   searchParams?.get('contact_name')  || '',
    contact_phone:  searchParams?.get('contact_phone') || '',
  });
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  // R33 B.1 · set when the server refused the listing for want of a
  // plan (402): where to add one, shown as a link under the message.
  const [buyUrl, setBuyUrl] = useState<string | null>(null);

  const [categories,  setCategories]  = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);

  // Once, on mount: the catalog changes rarely and writing an ad is a
  // short session.
  useEffect(() => {
    let cancelled = false;
    marketplaceSubscriptionsApi
      .catalog()
      .then((rows): Category[] => rows.map((c) => ({ value: c.code, label: c.name_he })))
      .catch((): Category[] => [])
      .then((rows) => {
        if (cancelled) return;
        const allowed = rows.filter((c) => c.value !== CORPORATION_ONLY_CATEGORY);
        const list    = allowed.length > 0 ? allowed : FALLBACK_CATEGORIES;
        setCategories(list);
        // Runs once, when the list arrives, so it can never undo a
        // category the provider picked by hand afterwards.
        setForm((f) => (list.some((c) => c.value === f.category) ? f : { ...f, category: list[0].value }));
        setCatsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('כותרת היא שדה חובה'); return; }
    setSaving(true); setError(''); setBuyUrl(null);
    try {
      await marketplaceApi.create({
        category:       form.category,
        title:          form.title.trim(),
        description:    form.description || undefined,
        city:           form.city || undefined,
        region:         form.region || undefined,
        price:          form.price ? parseFloat(form.price) : undefined,
        price_unit:     form.price_unit || undefined,
        capacity:       form.capacity ? parseInt(form.capacity) : undefined,
        available_from: form.available_from || undefined,
        contact_phone:  form.contact_phone || undefined,
        contact_name:   form.contact_name || undefined,
        images_json:    images.length > 0 ? images : undefined,
      });
      router.push('/provider/dashboard#my-listings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בפרסום');
      // No plan in this category, or the plan is full. The server
      // sends the page that fixes it; anything else has no link.
      if (err instanceof ApiError && err.cause.status === 402) {
        const details = err.cause.details as { buy_url?: string | null } | undefined;
        setBuyUrl(details?.buy_url || `/provider/marketplace/subscribe?category=${encodeURIComponent(form.category)}`);
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
                ) : categories.length === 1 ? (
                  // A picker with a single option reads like a load bug.
                  <span className={`${PILL} border-brand-200 bg-brand-50 font-semibold text-brand-800`}>
                    {categories[0].label}
                  </span>
                ) : (
                  categories.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={form.category === c.value}
                      onClick={() => update('category', c.value)}
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

            <div className={PAIR}>
              <Input label="עיר" placeholder="תל אביב" value={form.city} onChange={(e) => update('city', e.target.value)} />
              <Input label="אזור" placeholder="מרכז" value={form.region} onChange={(e) => update('region', e.target.value)} />
            </div>

            <div className={PAIR}>
              <Input label="מחיר (₪)" type="number" min={0} placeholder="3500" value={form.price} onChange={(e) => update('price', e.target.value)} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={priceUnitId} className={LABEL}>יחידת תמחור</label>
                <select
                  id={priceUnitId}
                  value={form.price_unit}
                  onChange={(e) => update('price_unit', e.target.value)}
                  className={`${CONTROL} h-9`}
                >
                  {PRICE_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={PAIR}>
              <Input label="קיבולת (מספר עובדים)" type="number" min={1} placeholder="7" value={form.capacity} onChange={(e) => update('capacity', e.target.value)} />
              <Input label="פנוי מתאריך" type="date" value={form.available_from} onChange={(e) => update('available_from', e.target.value)} />
            </div>

            <div className={PAIR}>
              <Input label="שם איש קשר" placeholder="משה לוי" value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
              <Input label="טלפון ליצירת קשר" type="tel" dir="ltr" placeholder="050-1234567" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
            </div>

            <ImageUploader value={images} onChange={setImages} />

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
                {buyUrl && (
                  <>
                    {' '}
                    <Link href={buyUrl} className="font-semibold underline underline-offset-2">
                      הוספת מסלול בקטגוריה
                    </Link>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" size="lg" disabled={saving || !form.category} className="flex-1 sm:flex-none">
                {saving ? <><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />מפרסם…</> : 'פרסם מודעה'}
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/provider/dashboard">ביטול</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
