'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload, X, ImagePlus, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';

const MAX_IMAGES = 12;
const ACCEPT     = 'image/jpeg,image/png,image/webp';

interface CloudinarySignature {
  cloud_name: string;
  api_key:    string;
  timestamp:  number;
  folder:     string;
  public_id:  string;
  signature:  string;
  upload_url: string;
}

interface CloudinaryUploadResult {
  secure_url: string;
  public_id:  string;
  format:     string;
  width:      number;
  height:     number;
  bytes:      number;
}

interface ImageUploaderProps {
  /** Current image URLs (controlled). */
  value:    string[];
  /** Called with the new full list whenever uploads finish or a removal happens. */
  onChange: (next: string[]) => void;
  /** Set false to render read-only. */
  disabled?: boolean;
}

/**
 * Drag-and-drop / click image uploader. Browser uploads files DIRECTLY
 * to Cloudinary using a signed upload set issued by user-org's
 * /marketplace/uploads/signature endpoint — no file ever flows through
 * our backend, which keeps the API tier light and lets Cloudinary's
 * CDN front the public marketplace images.
 *
 * Capped at MAX_IMAGES per listing (matches the backend cap).
 */
export default function ImageUploader({ value, onChange, disabled }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const remaining = Math.max(0, MAX_IMAGES - value.length);

  async function uploadOne(file: File): Promise<string> {
    const sig = await apiFetch<CloudinarySignature>(
      '/marketplace/uploads/signature',
      { method: 'POST' },
    );

    // Cloudinary's upload endpoint takes multipart/form-data — DON'T set
    // Content-Type explicitly; the browser builds the right boundary.
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key',   sig.api_key);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('folder',    sig.folder);
    fd.append('public_id', sig.public_id);
    fd.append('signature', sig.signature);

    const res = await fetch(sig.upload_url, { method: 'POST', body: fd });
    if (!res.ok) {
      // User-facing message in Hebrew. Status logged to console for
      // debugging.
      const txt = await res.text().catch(() => '');
      console.error('Cloudinary upload failed', res.status, txt.slice(0, 200));
      throw new Error('שגיאה בהעלאת התמונה. נסה שוב או בחר תמונה אחרת.');
    }
    const result = await res.json() as CloudinaryUploadResult;
    return result.secure_url;
  }

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files).slice(0, remaining);
    if (list.length === 0) return;

    setUploadingCount((n) => n + list.length);
    const accepted: string[] = [];
    for (const f of list) {
      try {
        const url = await uploadOne(f);
        accepted.push(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה בהעלאת התמונה');
        // Stop on first failure — partial uploads still get committed
        // via the surrounding setState below.
        break;
      }
    }
    setUploadingCount((n) => Math.max(0, n - list.length));
    if (accepted.length > 0) {
      onChange([...value, ...accepted]);
    }
  }

  function handleRemove(idx: number) {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">תמונות</label>
        <span className="text-xs text-slate-400">
          {value.length}/{MAX_IMAGES}
        </span>
      </div>

      {/* Image grid */}
      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {value.map((url, idx) => (
            <div key={url + idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  aria-label="הסר תמונה"
                  className="absolute top-1 end-1 inline-flex items-center justify-center h-6 w-6 rounded-full bg-black/55 text-white hover:bg-black/75 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {!disabled && remaining > 0 && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-xl p-4 sm:p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-brand-400 bg-brand-50/40' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
          />
          {uploadingCount > 0 ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              מעלה {uploadingCount} תמונות...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <ImagePlus className="h-6 w-6 text-slate-400" />
              <p className="text-sm text-slate-600">גרור תמונות לכאן או לחץ לבחירה</p>
              <p className="text-xs text-slate-400">JPG · PNG · WebP · עד {remaining} תמונות נוספות</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div className="min-w-0 break-words">{error}</div>
        </div>
      )}
    </div>
  );
}
