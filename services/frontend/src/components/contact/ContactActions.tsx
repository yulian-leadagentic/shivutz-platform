'use client';

// R38 item 7 · a revealed phone: the number, and the two ways to use it.
//
// Follows what Israeli listing sites do (yad2, Madlan): the number in
// local form with a copy button, a "התקשר" button (tel:), and for an
// Israeli mobile number a green "וואטסאפ" button that opens wa.me with
// a message naming the ad. A landline gets "התקשר" only.
//
// One component for every place a phone is revealed: the worker and
// housing result rows, the listing drawer, the ad screen and the
// "החשיפות שלי" pages.
//
// Each click is an event, contact_call / contact_whatsapp, through the
// same endpoint and gates as the listing events (R34 5c). The event
// carries the ad, never the number.

import { useState } from 'react';
import { Check, Copy, Phone } from 'lucide-react';

import { postAdEvent, type ContactTargetType } from '@/lib/adEvents';

/** 0525900200 / +972525900200 / 972-52-590-0200 -> the digits after 972, or the local digits. */
function localDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  return digits;
}

/** 052-590-0200 for a mobile, 03-123-4567 for a landline; as typed otherwise. */
export function formatIsraeliPhone(raw: string): string {
  const d = localDigits(raw);
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (/^0[2-489]\d{7}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (/^07\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

/** Israeli mobile numbers only: 05X followed by seven digits. */
export function isIsraeliMobile(raw: string): boolean {
  return /^05\d{8}$/.test(localDigits(raw));
}

/** https://wa.me/972XXXXXXXXX?text=... for an Israeli mobile, else null. */
export function whatsappLink(raw: string, adTitle?: string | null): string | null {
  if (!isIsraeliMobile(raw)) return null;
  const intl = '972' + localDigits(raw).slice(1);
  const title = (adTitle || '').trim();
  const text = title
    ? `שלום, ראיתי ב-TagidAI את המודעה '${title}' ואשמח לפרטים`
    : 'שלום, ראיתי את המודעה שלך ב-TagidAI ואשמח לפרטים';
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.73-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  );
}

export function ContactActions({
  phone,
  adTitle,
  target,
  name,
}: {
  phone: string;
  adTitle?: string | null;
  /** The ad or listing the number was revealed from, for the click events. */
  target?: { type: ContactTargetType; id: string };
  /** Who answers, when the reveal gave a name. */
  name?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const shown = formatIsraeliPhone(phone);
  const tel = `tel:${localDigits(phone) || phone}`;
  const wa = whatsappLink(phone, adTitle);

  function record(event_type: 'contact_call' | 'contact_whatsapp') {
    if (target) postAdEvent({ event_type, target_type: target.type, target_id: target.id });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the number is on screen to select by hand.
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {name && <span className="text-sm font-semibold text-slate-900">{name}</span>}
        <span dir="ltr" className="font-mono text-base font-semibold tracking-wide text-slate-900">{shown}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? 'המספר הועתק' : 'העתקת המספר'}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
        <span role="status" className="sr-only">{copied ? 'המספר הועתק' : ''}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={tel}
          onClick={() => record('contact_call')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          התקשר
        </a>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => record('contact_whatsapp')}
            // #128C7E on white text: 4.5:1. WhatsApp's own lighter green
            // (#25D366) does not reach the contrast a label needs.
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#128C7E] px-4 text-sm font-semibold text-white hover:bg-[#0f7a6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#128C7E] focus-visible:ring-offset-2"
          >
            <WhatsAppIcon className="h-4 w-4" />
            וואטסאפ
            <span className="sr-only">(נפתח בחלון חדש)</span>
          </a>
        )}
      </div>
    </div>
  );
}
