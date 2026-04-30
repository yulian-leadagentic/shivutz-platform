'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CATEGORIES = [
  { value: 'housing',   label: 'דיור' },
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

export default function NewListingPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    category:      'housing',
    title:         '',
    description:   '',
    city:          '',
    region:        '',
    price:         '',
    price_unit:    'per_month',
    capacity:      '',
    is_furnished:  false,
    available_from:'',
    contact_phone: '',
    contact_name:  '',
  });
  const [saving, setSaving]  = useState(false);
  const [error, setError]    = useState('');

  function update(field: string, value: unknown) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('כותרת היא שדה חובה'); return; }
    setSaving(true); setError('');
    try {
      const { id } = await marketplaceApi.create({
        category:       form.category,
        title:          form.title.trim(),
        description:    form.description || undefined,
        city:           form.city || undefined,
        region:         form.region || undefined,
        price:          form.price ? parseFloat(form.price) : undefined,
        price_unit:     form.price_unit || undefined,
        capacity:       form.capacity ? parseInt(form.capacity) : undefined,
        is_furnished:   form.is_furnished,
        available_from: form.available_from || undefined,
        contact_phone:  form.contact_phone || undefined,
        contact_name:   form.contact_name || undefined,
      });
      router.push('/corporation/marketplace');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בפרסום');
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-700"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">מודעה חדשה</h1>
          <p className="text-sm text-slate-500">פרסום ללא עלות למנויים</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">פרטי המודעה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Category */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">קטגוריה *</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => update('category', c.value)}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                      form.category === c.value
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'border-slate-200 text-slate-600 hover:border-brand-300'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">כותרת *</label>
              <Input
                placeholder="לדוגמה: דירה ל-7 עובדים בנתניה — מרוהטת"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">תיאור</label>
              <textarea
                rows={3}
                placeholder="פרטים נוספים על הנכס..."
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            {/* City + Region */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">עיר</label>
                <Input placeholder="תל אביב" value={form.city} onChange={(e) => update('city', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">אזור</label>
                <Input placeholder="מרכז" value={form.region} onChange={(e) => update('region', e.target.value)} />
              </div>
            </div>

            {/* Price */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">מחיר (₪)</label>
                <Input type="number" min={0} placeholder="3500" value={form.price} onChange={(e) => update('price', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">יחידת תמחור</label>
                <select
                  value={form.price_unit}
                  onChange={(e) => update('price_unit', e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {PRICE_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Capacity + furnished */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">קיבולת (מספר עובדים)</label>
                <Input type="number" min={1} placeholder="7" value={form.capacity} onChange={(e) => update('capacity', e.target.value)} />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  id="furnished"
                  checked={form.is_furnished}
                  onChange={(e) => update('is_furnished', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="furnished" className="text-sm font-medium text-slate-700">מרוהטת</label>
              </div>
            </div>

            {/* Available from */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">פנוי מתאריך</label>
              <Input type="date" value={form.available_from} onChange={(e) => update('available_from', e.target.value)} className="max-w-xs" />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">שם איש קשר</label>
                <Input placeholder="משה לוי" value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">טלפון ליצירת קשר</label>
                <Input type="tel" dir="ltr" placeholder="050-1234567" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin me-2" />מפרסם...</> : 'פרסם מודעה'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>ביטול</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
