'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { Loader2, FilePlus, FileCheck, FileX, ExternalLink, Trash2, UploadCloud, Link2, FileText } from 'lucide-react';
import { documentApi, type OrgDocument, DOC_TYPE_LABELS } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS);

type AddMode = 'file' | 'url';

export default function ContractorDocumentsPage() {
  const { entityId } = useAuth();
  const [docs, setDocs]         = useState<OrgDocument[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [addMode, setAddMode]   = useState<AddMode>('file');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // file upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver]         = useState(false);

  // url state
  const [fileUrl, setFileUrl]   = useState('');
  const [fileName, setFileName] = useState('');

  // shared
  const [docType, setDocType] = useState('registration_cert');
  const [notes, setNotes]     = useState('');

  useEffect(() => {
    if (!entityId) return;
    documentApi.list('contractors', entityId)
      .then(setDocs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entityId]);

  function resetForm() {
    setSelectedFile(null);
    setFileUrl(''); setFileName(''); setNotes('');
    setDocType('registration_cert');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!entityId) return;
    setSaving(true);
    try {
      if (addMode === 'file') {
        if (!selectedFile) { setError('יש לבחור קובץ להעלאה'); setSaving(false); return; }
        await documentApi.upload('contractors', entityId, selectedFile, docType, notes || undefined);
      } else {
        if (!fileUrl.trim())  { setError('יש להזין קישור לקובץ'); setSaving(false); return; }
        if (!fileName.trim()) { setError('יש להזין שם קובץ'); setSaving(false); return; }
        await documentApi.create('contractors', entityId, { doc_type: docType, file_url: fileUrl.trim(), file_name: fileName.trim(), notes: notes || undefined });
      }
      const updated = await documentApi.list('contractors', entityId);
      setDocs(updated);
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהעלאה');
    } finally { setSaving(false); }
  }

  async function handleDelete(docId: string) {
    if (!entityId) return;
    setDeleting(docId);
    try {
      await documentApi.delete('contractors', entityId, docId);
      setDocs((p) => p.filter((d) => d.doc_id !== docId));
    } catch { /* ignore */ } finally { setDeleting(null); }
  }

  function validBadge(doc: OrgDocument) {
    if (doc.is_valid === true)  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700"><FileCheck className="h-3 w-3" />מאושר</span>;
    if (doc.is_valid === false) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700"><FileX className="h-3 w-3" />נדחה</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">ממתין לאישור</span>;
  }

  function formatSize(bytes?: number | null) {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">מסמכים</h2>
        <Button onClick={() => { setShowForm((p) => !p); if (showForm) resetForm(); }} variant={showForm ? 'outline' : 'default'} size="sm">
          <FilePlus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'הוסף מסמך'}
        </Button>
      </div>

      <p className="text-sm text-slate-500">
        העלה מסמכים עסקיים ישירות מהמכשיר שלך, או הזן קישור קיים. המנהל יאשר אותם.
      </p>

      {showForm && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            <h3 className="font-semibold text-slate-800 text-sm">הוספת מסמך</h3>

            {/* Mode toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
              <button
                type="button"
                onClick={() => setAddMode('file')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 transition-colors ${addMode === 'file' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <UploadCloud className="h-4 w-4" />
                העלאת קובץ
              </button>
              <button
                type="button"
                onClick={() => setAddMode('url')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 transition-colors ${addMode === 'url' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <Link2 className="h-4 w-4" />
                קישור חיצוני
              </button>
            </div>

            {/* Doc type selector */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">סוג מסמך</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                className="flex h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {addMode === 'file' ? (
              /* ── File drop zone ── */
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) setSelectedFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-brand-400 bg-brand-50' : selectedFile ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }}
                />
                {selectedFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 text-green-500" />
                    <p className="text-sm font-medium text-green-700 break-all">{selectedFile.name}</p>
                    <p className="text-xs text-green-600">{formatSize(selectedFile.size)}</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                      className="text-xs text-slate-500 hover:text-red-600 underline mt-1"
                    >
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
              /* ── URL inputs ── */
              <div className="space-y-3">
                <Input label="קישור לקובץ" type="url" placeholder="https://drive.google.com/..." dir="ltr"
                  value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
                <Input label="שם הקובץ" placeholder="רישיון קבלן 2025.pdf"
                  value={fileName} onChange={(e) => setFileName(e.target.value)} />
              </div>
            )}

            <Input label="הערות (אופציונלי)" placeholder="..."
              value={notes} onChange={(e) => setNotes(e.target.value)} />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full h-11">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> {addMode === 'file' ? 'מעלה...' : 'שומר...'}</> : addMode === 'file' ? 'העלה מסמך' : 'הוסף קישור'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${docs.length} מסמכים`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : docs.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <FileText className="h-10 w-10 text-slate-200 mx-auto" />
              <p className="text-slate-400 text-sm">אין מסמכים. הוסף מסמך כדי לקבל אישור מנהל.</p>
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
    </div>
  );
}
