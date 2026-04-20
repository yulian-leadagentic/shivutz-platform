'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import {
  Loader2, FilePlus, FileCheck, FileX, ExternalLink, Trash2,
  UploadCloud, Link2, FileText, ShieldCheck, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { documentApi, type OrgDocument, DOC_TYPE_LABELS } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CONTRACTOR_LICENSE = 'contractor_license';
const OTHER_DOC_TYPES = Object.entries(DOC_TYPE_LABELS).filter(([k]) => k !== CONTRACTOR_LICENSE);
const DEFAULT_OTHER_TYPE = OTHER_DOC_TYPES[0]?.[0] ?? 'other';

type AddMode = 'file' | 'url';

function formatSize(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validBadge(doc: OrgDocument) {
  if (doc.is_valid === true)  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700"><FileCheck className="h-3 w-3" />מאושר</span>;
  if (doc.is_valid === false) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700"><FileX className="h-3 w-3" />נדחה</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">ממתין לאישור</span>;
}

// ─── Contractor license section (single slot) ──────────────────────────────

function LicenseSection({
  license, entityId, loading, onChanged,
}: {
  license: OrgDocument | undefined;
  entityId: string | null | undefined;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen]         = useState(false);
  const [addMode, setAddMode]   = useState<AddMode>('file');
  const [file, setFile]         = useState<File | null>(null);
  const [url, setUrl]           = useState('');
  const [fname, setFname]       = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null); setUrl(''); setFname(''); setNotes(''); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    setError('');
    setSaving(true);
    try {
      if (addMode === 'file') {
        if (!file) { setError('יש לבחור קובץ להעלאה'); setSaving(false); return; }
        await documentApi.upload('contractors', entityId, file, CONTRACTOR_LICENSE, notes || undefined);
      } else {
        if (!url.trim())   { setError('יש להזין קישור לקובץ'); setSaving(false); return; }
        if (!fname.trim()) { setError('יש להזין שם קובץ'); setSaving(false); return; }
        await documentApi.create('contractors', entityId, {
          doc_type: CONTRACTOR_LICENSE,
          file_url: url.trim(),
          file_name: fname.trim(),
          notes: notes || undefined,
        });
      }
      // Replace: delete the old license after a successful upload
      if (license) {
        await documentApi.delete('contractors', entityId, license.doc_id).catch(() => {});
      }
      reset();
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהעלאה');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!license || !entityId) return;
    if (!window.confirm('למחוק את רישיון הקבלן? נדרש רישיון מעודכן לפעילות.')) return;
    setDeleting(true);
    try {
      await documentApi.delete('contractors', entityId, license.doc_id);
      await onChanged();
    } catch { /* ignore */ } finally { setDeleting(false); }
  }

  return (
    <Card className="border-brand-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-brand-600" />
          תעודת קבלן מורשה
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : license ? (
          /* ── Existing license ── */
          <div className="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <FileText className="h-4 w-4 text-brand-600 shrink-0" />
                <span className="font-medium text-sm text-slate-900 truncate">{license.file_name}</span>
                {validBadge(license)}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                <span>הועלה: {new Date(license.uploaded_at).toLocaleDateString('he-IL')}</span>
                {license.file_size && <span>{formatSize(license.file_size)}</span>}
              </div>
              {license.notes && <p className="text-xs text-slate-500">{license.notes}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <a href={license.file_url} target="_blank" rel="noopener noreferrer"
                className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-brand-600 transition-colors"
                title="צפייה">
                <ExternalLink className="h-4 w-4" />
              </a>
              <button onClick={() => setOpen((p) => !p)}
                className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-brand-600 transition-colors"
                title="החלפה">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                title="מחיקה">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          /* ── No license — required CTA ── */
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-amber-800">לא הועלה רישיון קבלן מורשה</p>
              <p className="text-xs text-amber-700">נדרש רישיון מאושר לפני תחילת פעילות. העלה עכשיו.</p>
            </div>
            {!open && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <FilePlus className="h-4 w-4" />
                העלאה
              </Button>
            )}
          </div>
        )}

        {/* ── Upload / replace form ── */}
        {open && (
          <div className="space-y-3 pt-1">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
              <button type="button" onClick={() => setAddMode('file')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 transition-colors ${addMode === 'file' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <UploadCloud className="h-4 w-4" />
                העלאת קובץ
              </button>
              <button type="button" onClick={() => setAddMode('url')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 transition-colors ${addMode === 'url' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Link2 className="h-4 w-4" />
                קישור חיצוני
              </button>
            </div>

            {addMode === 'file' ? (
              <div
                onClick={() => fileRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  file ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'
                }`}
              >
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
                {file ? (
                  <div className="flex flex-col items-center gap-1">
                    <FileText className="h-7 w-7 text-green-500" />
                    <p className="text-sm font-medium text-green-700 break-all">{file.name}</p>
                    <p className="text-xs text-green-600">{formatSize(file.size)}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <UploadCloud className="h-7 w-7 text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">לחץ לבחירת רישיון</p>
                    <p className="text-xs text-slate-400">PDF, JPEG, PNG, Word · עד 20MB</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Input label="קישור לקובץ" type="url" placeholder="https://drive.google.com/..." dir="ltr"
                  value={url} onChange={(e) => setUrl(e.target.value)} />
                <Input label="שם הקובץ" placeholder="רישיון קבלן 2025.pdf"
                  value={fname} onChange={(e) => setFname(e.target.value)} />
              </div>
            )}

            <Input label="הערות (אופציונלי)" placeholder="..."
              value={notes} onChange={(e) => setNotes(e.target.value)} />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button type="button" onClick={handleUpload} disabled={saving} className="flex-1 h-10">
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {addMode === 'file' ? 'מעלה...' : 'שומר...'}</>
                  : license ? 'החלף רישיון' : 'העלה רישיון'}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }} className="h-10">
                ביטול
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Other documents section ──────────────────────────────────────────────

function OtherDocsSection({
  docs, entityId, loading, onChanged,
}: {
  docs: OrgDocument[];
  entityId: string | null | undefined;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [addMode, setAddMode]   = useState<AddMode>('file');
  const [docType, setDocType]   = useState<string>(DEFAULT_OTHER_TYPE);
  const [file, setFile]         = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl]           = useState('');
  const [fname, setFname]       = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null); setUrl(''); setFname(''); setNotes('');
    setDocType(DEFAULT_OTHER_TYPE); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    setError('');
    setSaving(true);
    try {
      if (addMode === 'file') {
        if (!file) { setError('יש לבחור קובץ להעלאה'); setSaving(false); return; }
        await documentApi.upload('contractors', entityId, file, docType, notes || undefined);
      } else {
        if (!url.trim())   { setError('יש להזין קישור לקובץ'); setSaving(false); return; }
        if (!fname.trim()) { setError('יש להזין שם קובץ'); setSaving(false); return; }
        await documentApi.create('contractors', entityId, {
          doc_type: docType,
          file_url: url.trim(),
          file_name: fname.trim(),
          notes: notes || undefined,
        });
      }
      reset();
      setShowForm(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהעלאה');
    } finally { setSaving(false); }
  }

  async function handleDelete(docId: string) {
    if (!entityId) return;
    setDeleting(docId);
    try {
      await documentApi.delete('contractors', entityId, docId);
      await onChanged();
    } catch { /* ignore */ } finally { setDeleting(null); }
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">מסמכים נוספים</CardTitle>
        <Button onClick={() => { setShowForm((p) => !p); if (showForm) reset(); }}
          variant={showForm ? 'outline' : 'default'} size="sm">
          <FilePlus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'הוסף מסמך'}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {showForm && (
          <div className="p-4 space-y-4 border-b border-slate-100">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
              <button type="button" onClick={() => setAddMode('file')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 transition-colors ${addMode === 'file' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <UploadCloud className="h-4 w-4" />
                העלאת קובץ
              </button>
              <button type="button" onClick={() => setAddMode('url')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 transition-colors ${addMode === 'url' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Link2 className="h-4 w-4" />
                קישור חיצוני
              </button>
            </div>

            {/* Doc type selector */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">סוג מסמך</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                className="flex h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {OTHER_DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {addMode === 'file' ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) setFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-brand-400 bg-brand-50' : file ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'
                }`}
              >
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 text-green-500" />
                    <p className="text-sm font-medium text-green-700 break-all">{file.name}</p>
                    <p className="text-xs text-green-600">{formatSize(file.size)}</p>
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                      className="text-xs text-slate-500 hover:text-red-600 underline mt-1">
                      הסר
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <UploadCloud className="h-8 w-8 text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">גרור קובץ לכאן, או לחץ לבחירה</p>
                    <p className="text-xs text-slate-400">PDF, JPEG, PNG, Word, Excel · עד 20MB</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Input label="קישור לקובץ" type="url" placeholder="https://drive.google.com/..." dir="ltr"
                  value={url} onChange={(e) => setUrl(e.target.value)} />
                <Input label="שם הקובץ" placeholder="חוזה התקשרות 2025.pdf"
                  value={fname} onChange={(e) => setFname(e.target.value)} />
              </div>
            )}

            <Input label="הערות (אופציונלי)" placeholder="..."
              value={notes} onChange={(e) => setNotes(e.target.value)} />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full h-11">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {addMode === 'file' ? 'מעלה...' : 'שומר...'}</>
                : addMode === 'file' ? 'העלה מסמך' : 'הוסף קישור'}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : docs.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <FileText className="h-10 w-10 text-slate-200 mx-auto" />
            <p className="text-slate-400 text-sm">אין מסמכים נוספים. הוסף לפי הצורך.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {docs.map((d) => (
              <div key={d.doc_id} className="flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-900 truncate max-w-[200px]">{d.file_name}</span>
                    {validBadge(d)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                    <span>{DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}</span>
                    <span>{new Date(d.uploaded_at).toLocaleDateString('he-IL')}</span>
                    {d.file_size && <span>{formatSize(d.file_size)}</span>}
                  </div>
                  {d.notes && <p className="text-xs text-slate-400">{d.notes}</p>}
                </div>
                <div className="flex items-center gap-1 ms-3 shrink-0">
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                    className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-brand-600 transition-colors">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button onClick={() => handleDelete(d.doc_id)} disabled={deleting === d.doc_id}
                    className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50">
                    {deleting === d.doc_id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ContractorDocumentsPage() {
  const { entityId } = useAuth();
  const [docs, setDocs]     = useState<OrgDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityId) { setLoading(false); return; }
    documentApi.list('contractors', entityId)
      .then(setDocs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entityId]);

  async function reload() {
    if (!entityId) return;
    const updated = await documentApi.list('contractors', entityId);
    setDocs(updated);
  }

  const license   = docs.find((d) => d.doc_type === CONTRACTOR_LICENSE);
  const otherDocs = docs.filter((d) => d.doc_type !== CONTRACTOR_LICENSE);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900">מסמכים</h2>
        <p className="text-sm text-slate-500 mt-1">
          רישיון קבלן מורשה בנפרד — הוא המסמך הבסיסי הנדרש. שאר המסמכים נוספים לפי הצורך.
        </p>
      </div>

      <LicenseSection license={license} entityId={entityId} loading={loading} onChanged={reload} />
      <OtherDocsSection docs={otherDocs} entityId={entityId} loading={loading} onChanged={reload} />
    </div>
  );
}
