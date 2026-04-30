'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ArrowRight, AlertCircle, Save } from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CATEGORIES = [
  { value: 'housing',   label: '🏠 דיור' },
  { value: 'equipment', label: '🔧 ציוד' },
  { value: 'services',  label: '💼 שירותים' },
  { value: 'other',     label: '⋯ אחר' },
];

const PRICE_UNITS = [
  { value: 'per_month',  label: 'לחודש' },
  { value: 'per_night',  label: 'ללילה' },
  { value: 'fixed',      label: 'מחיר קבוע' },
  { value: 'negotiable', label: 'למשא ומתן' },
];

const STATUSES = [
  { value: 'active', label: 'פעיל' },
  { value: 'rented', label: 'מושכר' },
  { value: 'sold',   label: 'נמכר' },
  { value: 'paused', label: 'מושהה' },
];

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);

  const [form, setForm] = useState({
    title:          '',
    description:    '',
    category:       'housing',
    subcategory:    '',
    city:           '',
    region:         '',
    price:          '',
    price_unit:     'per_month',
    capacity:       '',
    is_furnished:   false,
    available_from: '',
    contact_phone:  '',
    contact_name:   '',
    status:         'active',
  });

  useEffect(() => {
    marketplaceApi.get(id).then((l: MarketplaceListing) => {
      setForm({
        title:          l.title          || '',
        description:    l.description    || '',
        category:       l.category       || 'housing',
        subcategory:    l.subcategory    || '',
        city:           l.city           || '',
        region:         l.region         || '',
        price:          l.price != null  ? String(l.price) : '',
        price_unit:     l.price_unit     || 'per_month',
        capacity:       l.capacity != null ? String(l.capacity) : '',
        is_furnished:   l.is_furnished   ?? false,
        available_from: l.available_from ? l.available_from.slice(0, 10) : '',
        contact_phone:  l.contact_phone  || '',
        contact_name:   l.contact_name   || '',
        status:         l.status         || 'active',
      });
    }).catch(() => setError('המודעה לא נמצאה')).finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('יש למלא כותרת'); return; }
    setError('');
    setSaving(true);
    try {
      await marketplaceApi.update(id, {
        title:          form.title.trim(),
        description:    form.description.trim() || undefined,
        city:           form.city.trim() || undefined,
        region:         form.region.trim() || undefined,
        price:          form.price ? parseFloat(form.price) : undefined,
        price_unit:     form.price_unit || undefined,
        capacity:       form.capacity ? parseInt(form.capacity) : undefined,
        is_furnished:   form.is_furnished,
        available_from: form.available_from || undefined,
        contact_phone:  form.contact_phone.trim() || undefined,
        contact_name:   form.contact_name.trim() || undefined,
        status:         form.status,
      });
      setSuccess(true);
      setTimeout(() => router.push('/corporation/marketplace'), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin me-2" />טוען...
      </div>
    );
  }

  if (error && !form.title) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-slate-500">
        <AlertCircle className="h-8 w-8 text-slate-300" />
        <p>{error}</p>
        <Button variant="outline" onClick={() => router.back()}>חזור</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowRight className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">עריכת מודעה</h1>
          <p className="text-sm text-slate-500 mt-0.5">עדכן את פרטי המודעה</p>
        </div>
      </div>

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">
          ✓ המודעה עודכנה בהצלחה — מעביר לרשימה...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Category + status */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-5">
          <h2 className="text-base font-bold text-slate-900">פרטי מודעה</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-slate-700 mb-1.5 block">קטגוריה</Label>
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-sm font-semibold text-slate-700 mb-1.5 block">סטטוס</Label>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="title" className="text-sm font-semibold text-slate-700 mb-1.5 block">כותרת *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="תיאור קצר ומושך של מה שאתה מציע"
              required
            />
          </div>

          <div>
            <Label htmlFor="description" className="text-sm font-semibold text-slate-700 mb-1.5 block">תיאור מפורט</Label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="פרט את המאפיינים, הכללות, מיקום מדויק וכל מה שחשוב לדעת..."
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {/* Location */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">מיקום</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="city" className="text-sm font-semibold text-slate-700 mb-1.5 block">עיר</Label>
              <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="תל אביב" />
            </div>
            <div>
              <Label htmlFor="region" className="text-sm font-semibold text-slate-700 mb-1.5 block">אזור</Label>
              <Input id="region" value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="מרכז" />
            </div>
          </div>
        </div>

        {/* Price + capacity */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">מחיר וקיבולת</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price" className="text-sm font-semibold text-slate-700 mb-1.5 block">מחיר (₪)</Label>
              <Input id="price" type="number" min={0} value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="1800" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-slate-700 mb-1.5 block">יחידת מחיר</Label>
              <select
                value={form.price_unit}
                onChange={(e) => set('price_unit', e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {PRICE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            {form.category === 'housing' && (
              <>
                <div>
                  <Label htmlFor="capacity" className="text-sm font-semibold text-slate-700 mb-1.5 block">קיבולת (עובדים)</Label>
                  <Input id="capacity" type="number" min={1} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="6" />
                </div>
                <div>
                  <Label htmlFor="available_from" className="text-sm font-semibold text-slate-700 mb-1.5 block">זמין מתאריך</Label>
                  <Input id="available_from" type="date" value={form.available_from} onChange={(e) => set('available_from', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.is_furnished}
                      onChange={(e) => set('is_furnished', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600"
                    />
                    <span className="text-sm font-medium text-slate-700">הדירה מרוהטת</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
          <h2 className="text-base font-bold text-slate-900">פרטי קשר</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contact_name" className="text-sm font-semibold text-slate-700 mb-1.5 block">שם איש קשר</Label>
              <Input id="contact_name" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} placeholder="ישראל ישראלי" />
            </div>
            <div>
              <Label htmlFor="contact_phone" className="text-sm font-semibold text-slate-700 mb-1.5 block">טלפון</Label>
              <Input id="contact_phone" type="tel" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} placeholder="050-0000000" dir="ltr" />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving || success} className="bg-brand-600 hover:bg-brand-700 text-white px-6">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin me-2" />שומר...</> : <><Save className="h-4 w-4 me-2" />שמור שינויים</>}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={saving}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
