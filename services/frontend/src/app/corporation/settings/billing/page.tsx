'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CreditCard, Loader2, Trash2, Star, ShieldCheck,
  AlertTriangle, CheckCircle2, ExternalLink, Plus,
} from 'lucide-react';
import { paymentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PaymentMethod } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BRAND_LABELS: Record<string, string> = {
  visa:       'Visa',
  mastercard: 'Mastercard',
  amex:       'American Express',
  isracard:   'ישראכארט',
};

function brandLabel(brand: string | null) {
  if (!brand) return 'כרטיס אשראי';
  return BRAND_LABELS[brand.toLowerCase()] ?? brand;
}

function expiryLabel(month: number, year: number) {
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

function isExpired(month: number, year: number): boolean {
  const now = new Date();
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
}

function isExpiringSoon(month: number, year: number): boolean {
  const now = new Date();
  const threeMonthsLater = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  const expiry = new Date(year, month - 1, 1);
  return !isExpired(month, year) && expiry <= threeMonthsLater;
}

// ─── Card chip ────────────────────────────────────────────────────────────────

function CardChip({ pm, onDelete, onSetDefault, loading }: {
  pm: PaymentMethod;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  loading: boolean;
}) {
  const expired     = isExpired(pm.expiry_month, pm.expiry_year);
  const expireSoon  = isExpiringSoon(pm.expiry_month, pm.expiry_year);

  return (
    <div className={`relative flex items-start gap-4 p-4 rounded-2xl border-2 transition-all
      ${pm.is_default
        ? 'border-brand-500 bg-brand-50/30'
        : 'border-slate-200 bg-white hover:border-slate-300'
      }
      ${expired ? 'opacity-60' : ''}
    `}>
      {/* Default star */}
      {pm.is_default && (
        <span className="absolute top-3 start-3 inline-flex items-center gap-1 text-[10px] font-bold text-brand-600 bg-brand-100 rounded-full px-2 py-0.5">
          <Star className="h-2.5 w-2.5 fill-brand-500 text-brand-500" />
          ברירת מחדל
        </span>
      )}

      {/* Card icon */}
      <div className={`mt-5 shrink-0 h-12 w-16 rounded-xl flex items-center justify-center shadow-sm
        ${expired ? 'bg-slate-100' : 'bg-gradient-to-br from-slate-700 to-slate-900'}`}>
        <CreditCard className={`h-6 w-6 ${expired ? 'text-slate-400' : 'text-white'}`} />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 pt-5">
        <p className="text-sm font-bold text-slate-900">
          {brandLabel(pm.card_brand)} •••• {pm.last_4_digits}
        </p>
        {pm.card_holder_name && (
          <p className="text-xs text-slate-500 mt-0.5">{pm.card_holder_name}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className={`text-xs font-medium ${
            expired      ? 'text-red-600' :
            expireSoon   ? 'text-amber-600' :
                           'text-slate-500'
          }`}>
            {expired      ? '⚠ פג תוקף — ' : expireSoon ? '⚡ תוקף קרוב — ' : ''}
            {expiryLabel(pm.expiry_month, pm.expiry_year)}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium
            ${pm.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {pm.status === 'active' ? 'פעיל' : pm.status}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-5 shrink-0">
        {!pm.is_default && pm.status === 'active' && !expired && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSetDefault(pm.id)}
            disabled={loading}
            className="text-xs h-7 px-2 text-slate-500 hover:text-brand-700"
          >
            <Star className="h-3 w-3 me-1" />
            הגדר כברירת מחדל
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(pm.id)}
          disabled={loading}
          className="text-xs h-7 px-2 text-red-400 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-3 w-3 me-1" />
          הסר
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function BillingPageContent() {
  const searchParams = useSearchParams();

  const [methods, setMethods]     = useState<PaymentMethod[]>([]);
  const [loading, setLoading]     = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError]         = useState('');
  const [addingCard, setAddingCard] = useState(false);
  const [cardAdded, setCardAdded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pms = await paymentApi.methods();
      setMethods(pms);
    } catch {
      setError('שגיאה בטעינת אמצעי התשלום');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Check if we just returned from Cardcom
    if (searchParams.get('cardAdded') === '1') {
      setCardAdded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddCard() {
    setAddingCard(true);
    setError('');
    try {
      const { url } = await paymentApi.cardcomInit();
      // Redirect to Cardcom hosted form
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת טופס כרטיס');
      setAddingCard(false);
    }
  }

  async function handleDelete(pmId: string) {
    if (!confirm('להסיר את אמצעי התשלום הזה?')) return;
    setActionLoading(true);
    try {
      await paymentApi.deleteMethod(pmId);
      setMethods((prev) => prev.filter((p) => p.id !== pmId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהסרת הכרטיס');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetDefault(pmId: string) {
    setActionLoading(true);
    try {
      await paymentApi.setDefault(pmId);
      setMethods((prev) => prev.map((p) => ({ ...p, is_default: p.id === pmId })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setActionLoading(false);
    }
  }

  const activeDefault = methods.find((m) => m.is_default && m.status === 'active');
  const hasActive     = methods.some((m) => m.status === 'active');

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">חיוב ותשלום</h1>
        <p className="text-sm text-slate-500 mt-1">
          ניהול אמצעי תשלום לחיוב עמלות שיבוץ עובדים
        </p>
      </div>

      {/* Success notice after Cardcom return */}
      {cardAdded && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">הכרטיס נשמר בהצלחה</p>
            <p className="text-xs text-emerald-700 mt-0.5">אמצעי התשלום נרשם ומוכן לחיוב</p>
          </div>
        </div>
      )}

      {/* No active PM warning */}
      {!loading && !hasActive && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">אין אמצעי תשלום פעיל</p>
            <p className="text-xs text-amber-700 mt-0.5">
              לא תוכל לאשר הצעות עובדים ולהתחייב לעסקאות ללא כרטיס אשראי פעיל
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Cards */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-brand-600" />
              כרטיסי אשראי שמורים
            </CardTitle>
            <Button
              size="sm"
              onClick={handleAddCard}
              disabled={addingCard}
            >
              {addingCard
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />מנתב לקארדקום...</>
                : <><Plus className="h-3.5 w-3.5" />הוסף כרטיס</>
              }
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="animate-spin h-5 w-5 me-2" />טוען...
            </div>
          ) : methods.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <CreditCard className="h-12 w-12 text-slate-200 mx-auto" />
              <div>
                <p className="text-slate-600 font-medium">אין כרטיסים שמורים</p>
                <p className="text-slate-400 text-sm mt-1">הוסף כרטיס אשראי כדי לאפשר חיוב אוטומטי</p>
              </div>
              <Button onClick={handleAddCard} disabled={addingCard}>
                {addingCard
                  ? <><Loader2 className="h-4 w-4 animate-spin me-2" />מנתב...</>
                  : <><Plus className="h-4 w-4 me-2" />הוסף כרטיס ראשון</>
                }
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {methods.map((pm) => (
                <CardChip
                  key={pm.id}
                  pm={pm}
                  onDelete={handleDelete}
                  onSetDefault={handleSetDefault}
                  loading={actionLoading}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-600">
            <ShieldCheck className="h-4 w-4 text-slate-400" />
            איך פועל החיוב?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-bold text-brand-600 w-5 text-center">1</span>
            <p>בעת לחיצה על <strong>אשר ושבץ</strong>, מתחיל מונה של 48 שעות עד לחיוב</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-bold text-brand-600 w-5 text-center">2</span>
            <p>ניתן לבטל את ההתחייבות בתוך 48 השעות ללא חיוב</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-bold text-brand-600 w-5 text-center">3</span>
            <p>לאחר 48 שעות מבוצע חיוב אוטומטי בכרטיס ברירת המחדל</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0 font-bold text-brand-600 w-5 text-center">4</span>
            <p>חשבונית תישלח לדוא״ל לאחר החיוב המוצלח</p>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
            <ExternalLink className="h-3 w-3" />
            <span>הכרטיס מאובטח ומוצפן על ידי קארדקום — מספרי כרטיס לא נשמרים אצלנו</span>
          </div>
        </CardContent>
      </Card>

      {/* Active default summary */}
      {activeDefault && (
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shrink-0">
            <CreditCard className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {brandLabel(activeDefault.card_brand)} •••• {activeDefault.last_4_digits}
            </p>
            <p className="text-xs text-slate-500">
              כרטיס ברירת מחדל · תוקף {expiryLabel(activeDefault.expiry_month, activeDefault.expiry_year)}
            </p>
          </div>
          <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
            ✓ מוכן לחיוב
          </span>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="h-5 w-5 animate-spin me-2" />טוען...</div>}>
      <BillingPageContent />
    </Suspense>
  );
}
