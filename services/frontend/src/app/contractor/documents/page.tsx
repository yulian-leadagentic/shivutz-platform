'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, FilePlus, FileCheck, FileX, ExternalLink, Trash2 } from 'lucide-react';
import { documentApi, type OrgDocument, DOC_TYPE_LABELS } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS);

export default function ContractorDocumentsPage() {
  const { entityId } = useAuth();
  const [docs, setDocs]         = useState<OrgDocument[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // form
  const [docType, setDocType]   = useState('registration_cert');
  const [fileUrl, setFileUrl]   = useState('');
  const [fileName, setFileName] = useState('');
  const [notes, setNotes]       = useState('');

  useEffect(() => {
    if (!entityId) return;
    documentApi.list('contractors', entityId)
      .then(setDocs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entityId]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!fileUrl.trim())  { setError('יש להזין כתובת קישור לקובץ'); return; }
    if (!fileName.trim()) { setError('יש להזין שם קובץ'); return; }
    if (!entityId) return;
    setSaving(true);
    try {
      await documentApi.create('contractors', entityId, { doc_type: docType, file_url: fileUrl.trim(), file_name: fileName.trim(), notes: notes || undefined });
      const updated = await documentApi.list('contractors', entityId);
      setDocs(updated);
      setFileUrl(''); setFileName(''); setNotes(''); setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
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

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">מסמכים</h2>
        <Button onClick={() => setShowForm((p) => !p)} variant={showForm ? 'outline' : 'default'} size="sm">
          <FilePlus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'הוסף מסמך'}
        </Button>
      </div>

      <p className="text-sm text-slate-500">
        העלה קישורים למסמכים עסקיים (Google Drive, Dropbox וכו׳). המנהל יאשר אותם.
      </p>

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="font-semibold text-slate-800 text-sm">הוספת מסמך</h3>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">סוג מסמך</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <Input label="קישור לקובץ" type="url" placeholder="https://drive.google.com/..." dir="ltr"
              value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
            <Input label="שם הקובץ" placeholder="רישיון קבלן 2025.pdf"
              value={fileName} onChange={(e) => setFileName(e.target.value)} />
            <Input label="הערות (אופציונלי)" placeholder="..."
              value={notes} onChange={(e) => setNotes(e.target.value)} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</> : 'הוסף'}
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
            <p className="text-center text-slate-400 py-8 text-sm">אין מסמכים. הוסף מסמך כדי לקבל אישור מנהל</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {docs.map((d) => (
                <div key={d.doc_id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-slate-900 truncate">{d.file_name}</span>
                      {validBadge(d)}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-slate-400">{DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(d.uploaded_at).toLocaleDateString('he-IL')}
                      </span>
                    </div>
                    {d.notes && <p className="text-xs text-slate-400 mt-0.5">{d.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 ms-3 shrink-0">
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-brand-600 transition-colors">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <button onClick={() => handleDelete(d.doc_id)} disabled={deleting === d.doc_id}
                      className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50">
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
