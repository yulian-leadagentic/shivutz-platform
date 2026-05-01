'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Save, Power, PowerOff } from 'lucide-react';
import {
  marketplaceAdminApi,
  type MarketplaceCategory,
  type MarketplaceTier,
  type TierInput,
} from '@/lib/api/marketplaceAdmin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

// ── Empty-row helper ────────────────────────────────────────────────────

function emptyTierInput(): TierInput {
  return {
    name_he: '',
    name_en: '',
    slot_count: 5,
    duration_days: 30,
    price_nis: 0,
    sort_order: 100,
    is_active: true,
  };
}

// ── Page ────────────────────────────────────────────────────────────────

export default function MarketplaceAdminPage() {
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tiers, setTiers] = useState<MarketplaceTier[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCategories() {
    setLoadingCats(true);
    setError(null);
    try {
      const list = await marketplaceAdminApi.listCategories();
      setCategories(list);
      if (!selectedCode && list.length > 0) setSelectedCode(list[0].code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoadingCats(false);
    }
  }

  async function loadTiers(code: string) {
    setLoadingTiers(true);
    try {
      const list = await marketplaceAdminApi.listTiers(code);
      setTiers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoadingTiers(false);
    }
  }

  useEffect(() => { loadCategories(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (selectedCode) loadTiers(selectedCode); }, [selectedCode]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ניהול קטגוריות שוק</h1>
        <p className="text-sm text-slate-500 mt-1">
          הקטגוריות מוצגות לבעלי המנוי בעת רכישה. כל קטגוריה כוללת מסלולי מנוי משלה (כמות מודעות וזמן פרסום).
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* ── Categories list ─────────────────────────────────────── */}
        <CategoriesPanel
          categories={categories}
          loading={loadingCats}
          selectedCode={selectedCode}
          onSelect={setSelectedCode}
          onChange={loadCategories}
        />

        {/* ── Tiers for the selected category ─────────────────────── */}
        <TiersPanel
          categoryCode={selectedCode}
          tiers={tiers}
          loading={loadingTiers}
          onChange={() => selectedCode && loadTiers(selectedCode)}
        />
      </div>
    </div>
  );
}

// ── Categories panel ───────────────────────────────────────────────────

function CategoriesPanel({
  categories, loading, selectedCode, onSelect, onChange,
}: {
  categories: MarketplaceCategory[];
  loading: boolean;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newHe, setNewHe] = useState('');
  const [newEn, setNewEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true); setErr(null);
    try {
      await marketplaceAdminApi.createCategory({
        code: newCode.trim(),
        name_he: newHe.trim(),
        name_en: newEn.trim(),
        sort_order: (categories[categories.length - 1]?.sort_order ?? 0) + 10,
        is_active: true,
      });
      setNewCode(''); setNewHe(''); setNewEn(''); setCreating(false);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: MarketplaceCategory) {
    try {
      await marketplaceAdminApi.updateCategory(c.code, { is_active: !c.is_active });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">קטגוריות</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setCreating(v => !v)}>
          <Plus className="h-3.5 w-3.5" />
          חדשה
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {creating && (
          <div className="px-4 py-3 border-y border-slate-100 bg-slate-50/60 space-y-2">
            <Input placeholder="code (e.g. vehicles)" value={newCode} onChange={e => setNewCode(e.target.value)} dir="ltr" />
            <Input placeholder="שם בעברית" value={newHe} onChange={e => setNewHe(e.target.value)} />
            <Input placeholder="Name (English)" value={newEn} onChange={e => setNewEn(e.target.value)} dir="ltr" />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={saving || !newCode || !newHe || !newEn}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                שמור
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>בטל</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <ul>
            {categories.map((c) => {
              const active = c.code === selectedCode;
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.code)}
                    className={`w-full text-start px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors flex items-center justify-between gap-2 ${active ? 'bg-brand-50/60' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{c.name_he}</p>
                      <p className="text-xs text-slate-500 font-mono truncate" dir="ltr">{c.code}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!c.is_active && <Badge variant="secondary">מושבת</Badge>}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); toggleActive(c); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleActive(c); } }}
                        className="p-1 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                        aria-label={c.is_active ? 'השבת קטגוריה' : 'הפעל קטגוריה'}
                      >
                        {c.is_active ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tiers panel ────────────────────────────────────────────────────────

function TiersPanel({
  categoryCode, tiers, loading, onChange,
}: {
  categoryCode: string | null;
  tiers: MarketplaceTier[];
  loading: boolean;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TierInput>(emptyTierInput());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleAdd() {
    if (!categoryCode) return;
    setSavingId('new'); setErr(null);
    try {
      await marketplaceAdminApi.createTier(categoryCode, draft);
      setDraft(emptyTierInput()); setAdding(false);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSavingId(null);
    }
  }

  async function handleUpdate(t: MarketplaceTier, patch: Partial<TierInput>) {
    setSavingId(t.id); setErr(null);
    try {
      await marketplaceAdminApi.updateTier(t.id, patch);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(t: MarketplaceTier) {
    if (!confirm(`למחוק את המסלול "${t.name_he}"?`)) return;
    setSavingId(t.id); setErr(null);
    try {
      await marketplaceAdminApi.deleteTier(t.id);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete_failed');
    } finally {
      setSavingId(null);
    }
  }

  if (!categoryCode) {
    return (
      <Card>
        <CardContent className="text-center text-slate-400 py-12">בחר קטגוריה כדי לערוך מסלולים</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">
          מסלולי מנוי — <span className="font-mono text-sm text-slate-500" dir="ltr">{categoryCode}</span>
        </CardTitle>
        <Button size="sm" onClick={() => setAdding(v => !v)}>
          <Plus className="h-3.5 w-3.5" />
          מסלול חדש
        </Button>
      </CardHeader>
      <CardContent>
        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {err}
          </div>
        )}

        {adding && (
          <TierEditor
            categoryCode={categoryCode}
            value={draft}
            onChange={setDraft}
            onSave={handleAdd}
            onCancel={() => { setAdding(false); setDraft(emptyTierInput()); }}
            saving={savingId === 'new'}
            isNew
          />
        )}

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : tiers.length === 0 ? (
          <p className="text-center text-slate-400 py-8">אין מסלולים בקטגוריה זו עדיין</p>
        ) : (
          <div className="space-y-3">
            {tiers.map(t => (
              <TierRow
                key={t.id}
                tier={t}
                saving={savingId === t.id}
                onUpdate={(patch) => handleUpdate(t, patch)}
                onDelete={() => handleDelete(t)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tier row (display + inline edit) ───────────────────────────────────

function TierRow({
  tier, saving, onUpdate, onDelete,
}: {
  tier: MarketplaceTier;
  saving: boolean;
  onUpdate: (patch: Partial<TierInput>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TierInput>({
    name_he: tier.name_he, name_en: tier.name_en,
    slot_count: tier.slot_count, duration_days: tier.duration_days,
    price_nis: tier.price_nis, sort_order: tier.sort_order, is_active: tier.is_active,
  });

  if (editing) {
    return (
      <TierEditor
        categoryCode={tier.category_code}
        value={draft}
        onChange={setDraft}
        onSave={() => { onUpdate(draft); setEditing(false); }}
        onCancel={() => setEditing(false)}
        saving={saving}
      />
    );
  }

  return (
    <div className={`border border-slate-200 rounded-lg p-4 ${!tier.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900">{tier.name_he}</span>
            <span className="text-xs text-slate-500" dir="ltr">{tier.name_en}</span>
            {!tier.is_active && <Badge variant="secondary">מושבת</Badge>}
          </div>
          <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
            <span>{tier.slot_count} מודעות</span>
            <span>{tier.duration_days} ימים</span>
            <span dir="ltr">₪{tier.price_nis.toLocaleString('he-IL')}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>ערוך</Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="מחק" className="text-red-600 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Tier editor (used for both new and inline edit) ────────────────────

function TierEditor({
  value, onChange, onSave, onCancel, saving, isNew = false,
}: {
  categoryCode: string;
  value: TierInput;
  onChange: (next: TierInput) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
}) {
  function set<K extends keyof TierInput>(key: K, v: TierInput[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className={`border ${isNew ? 'border-brand-300 bg-brand-50/40' : 'border-slate-300 bg-slate-50/40'} rounded-lg p-4 mb-3 space-y-3`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>שם בעברית</Label>
          <Input value={value.name_he} onChange={e => set('name_he', e.target.value)} placeholder="בסיסי" />
        </div>
        <div className="space-y-1">
          <Label>Name (English)</Label>
          <Input value={value.name_en} onChange={e => set('name_en', e.target.value)} placeholder="Basic" dir="ltr" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>כמות מודעות</Label>
          <Input type="number" min={1} max={999} value={value.slot_count}
                 onChange={e => set('slot_count', Math.max(1, parseInt(e.target.value) || 1))} dir="ltr" />
        </div>
        <div className="space-y-1">
          <Label>ימי פרסום</Label>
          <Input type="number" min={1} max={3650} value={value.duration_days}
                 onChange={e => set('duration_days', Math.max(1, parseInt(e.target.value) || 1))} dir="ltr" />
        </div>
        <div className="space-y-1">
          <Label>מחיר (₪)</Label>
          <Input type="number" min={0} step="0.01" value={value.price_nis}
                 onChange={e => set('price_nis', Math.max(0, parseFloat(e.target.value) || 0))} dir="ltr" />
        </div>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value.is_active} onChange={e => set('is_active', e.target.checked)} className="h-4 w-4" />
          פעיל
        </label>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Label className="text-sm">סדר תצוגה</Label>
          <Input type="number" value={value.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)}
                 className="w-20" dir="ltr" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button size="sm" onClick={onSave} disabled={saving || !value.name_he || !value.name_en}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          שמור
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>בטל</Button>
      </div>
    </div>
  );
}
