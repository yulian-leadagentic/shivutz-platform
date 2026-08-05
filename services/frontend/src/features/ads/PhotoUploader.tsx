'use client';

// Pivot/v2 — Cloudinary photo uploader with graceful fallback.
//
// Behavior:
//  1. On mount, GET /uploads/cloudinary-signature.
//  2. If 200, render a file input + drag-drop zone. Selected images
//     upload straight to Cloudinary using the signed params, and the
//     returned secure_url is appended to `value`.
//  3. If 501 not_configured, render a plain textarea for pasting
//     image URLs (previous MVP behavior). This keeps the form usable
//     until CLOUDINARY_* env vars are set.

import { useEffect, useRef, useState } from 'react';
import { Upload, X, Loader2, Image as ImageIcon, Info } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface CloudinarySig {
  cloud_name: string;
  api_key:    string;
  timestamp:  number;
  signature:  string;
  folder:     string;
  upload_url: string;
}

export function PhotoUploader({
  value,
  onChange,
  maxPhotos = 6,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  maxPhotos?: number;
}) {
  const [sig, setSig]         = useState<CloudinarySig | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [pastedText, setText] = useState('');
  const fileRef               = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<CloudinarySig>('/uploads/cloudinary-signature')
      .then(setSig)
      .catch(() => setSig(null))
      .finally(() => setChecked(true));
  }, []);

  async function uploadOne(file: File): Promise<string> {
    if (!sig) throw new Error('Cloudinary not configured');
    const form = new FormData();
    form.append('file',      file);
    form.append('api_key',   sig.api_key);
    form.append('timestamp', String(sig.timestamp));
    form.append('signature', sig.signature);
    form.append('folder',    sig.folder);
    const r = await fetch(sig.upload_url, { method: 'POST', body: form });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Cloudinary ${r.status}: ${t.slice(0, 120)}`);
    }
    const data = await r.json() as { secure_url?: string };
    if (!data.secure_url) throw new Error('Cloudinary returned no URL');
    return data.secure_url;
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const room = maxPhotos - value.length;
      const list = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const f of list) urls.push(await uploadOne(f));
      onChange([...value, ...urls]);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בהעלאה');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, n) => n !== i));
  }

  function applyPasted() {
    const list = pastedText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    onChange([...value, ...list].slice(0, maxPhotos));
    setText('');
  }

  return (
    <div className="space-y-3">
      {/* Existing photos */}
      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {value.map((url, i) => (
            <div key={url + i} className="relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-50">
              {/* CP5 — alt derived from ordinal so screen-readers get
                  "תמונה 2 מתוך 4" instead of a silent skip. Persistent
                  per-photo alt input needs a schema change (photos
                  moves from string[] to {url, alt}[]) — deferred. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`תמונה ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`הסר תמונה ${i + 1}`}
                className="absolute top-1 end-1 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-slate-900"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Uploader */}
      {!checked ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> טוען אפשרויות העלאה…
        </div>
      ) : sig ? (
        value.length >= maxPhotos ? (
          <p className="text-xs text-slate-500">הגעת למקסימום {maxPhotos} תמונות. הסר כדי להוסיף אחרות.</p>
        ) : (
          <label className="block cursor-pointer">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
              className="border-2 border-dashed border-slate-300 rounded-xl p-4 sm:p-6 text-center hover:border-brand-400 hover:bg-brand-50/30 transition"
            >
              {busy ? (
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" />
              ) : (
                <>
                  <Upload className="w-6 h-6 mx-auto text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700 mt-2">
                    גרור תמונות לכאן או לחץ לבחירה
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    JPG / PNG / WebP · עד {maxPhotos - value.length} תמונות
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        )
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            העלאה מהמחשב תופעל כשמנהל המערכת יגדיר Cloudinary. בינתיים תוכל להדביק
            כתובות של תמונות המתארחות במקום אחר.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={pastedText}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://... , https://..."
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={applyPasted}
              disabled={!pastedText.trim()}
              className="bg-brand-800 hover:bg-brand-900 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-1"
            >
              <ImageIcon className="w-3.5 h-3.5" /> הוסף
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
    </div>
  );
}
