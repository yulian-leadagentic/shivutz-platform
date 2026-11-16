'use client';

// R38 · which of a user's accounts the WhatsApp chat searches as.
//
// A message to the business number carries only a phone number. One
// active membership is used as it is, so the card shows nothing for it.
// With several, the user picks one here; until he does, the chat
// answers with a link to this card (/billing#whatsapp) and no search.
//
// Without `userId` the card is the logged-in user's own. With it, a
// platform admin reads and sets another user's (admin users page).

import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';

import { whatsappEntityApi, type WhatsAppEntityState } from '@/lib/api/whatsappEntity';
import { mapApiError } from '@/lib/api/errors';
import { ENTITY_TYPE_HE } from '@/lib/labels';

export const WHATSAPP_ENTITY_ANCHOR = 'whatsapp';

type Notice = { kind: 'ok' | 'error'; text: string };

export function WhatsAppEntityCard({ userId }: { userId?: string }) {
  const forAdmin = !!userId;
  const titleId  = useId();
  const box      = useRef<HTMLElement>(null);

  const [state, setState]     = useState<WhatsAppEntityState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving]   = useState<string | null>(null);
  const [notice, setNotice]   = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    (userId ? whatsappEntityApi.ofUser(userId) : whatsappEntityApi.mine())
      .then((s) => { if (!cancelled) setState(s); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [userId]);

  const many = (state?.memberships.length ?? 0) > 1;

  // The chat's link lands here before the data has, so the browser's
  // own jump to the anchor finds nothing. Jump once the card is drawn.
  useEffect(() => {
    if (forAdmin || !many) return;
    if (window.location.hash === `#${WHATSAPP_ENTITY_ANCHOR}`) {
      box.current?.scrollIntoView({ block: 'start' });
    }
  }, [forAdmin, many]);

  async function choose(membershipId: string) {
    if (!state || membershipId === state.default_membership_id) return;
    setSaving(membershipId);
    setNotice(null);
    try {
      const next = userId
        ? await whatsappEntityApi.setForUser(userId, membershipId)
        : await whatsappEntityApi.setMine(membershipId);
      setState(next);
      setNotice({ kind: 'ok', text: 'נשמר' });
    } catch (e) {
      setNotice({ kind: 'error', text: mapApiError(e) });
    } finally {
      setSaving(null);
    }
  }

  if (loadFailed) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        לא הצלחנו לטעון את החשבונות לוואטסאפ
      </p>
    );
  }
  if (!state) return null;

  const only = state.memberships.length === 1 ? state.memberships[0] : null;
  if (!many && !(forAdmin && only)) return null;

  const nameOf = (m: WhatsAppEntityState['memberships'][number]) =>
    m.entity_name || ENTITY_TYPE_HE[m.entity_type] || m.entity_type;

  return (
    <section
      ref={box}
      id={forAdmin ? undefined : WHATSAPP_ENTITY_ANCHOR}
      aria-labelledby={titleId}
      className={forAdmin
        ? 'rounded-lg border border-slate-200 bg-white p-3'
        : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5 scroll-mt-24'}
    >
      <h2 id={titleId} className={`flex items-center gap-2 font-bold text-slate-900 ${forAdmin ? 'text-sm' : 'text-lg'}`}>
        <MessageCircle className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        היישות לוואטסאפ
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {forAdmin ? 'החשבון שישמש כשהמשתמש פונה אלינו בוואטסאפ' : 'החשבון שישמש כשתפנו אלינו בוואטסאפ'}
      </p>

      {only ? (
        <p className="mt-3 text-sm text-slate-700">חשבון יחיד: {nameOf(only)}</p>
      ) : (
        <>
          {state.choice_needed && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              עדיין לא נבחר חשבון, ולכן אי אפשר לחפש בוואטסאפ.
            </p>
          )}
          <div role="radiogroup" aria-labelledby={titleId} className="mt-3 space-y-2">
            {state.memberships.map((m) => {
              const checked = m.membership_id === state.default_membership_id;
              return (
                <label
                  key={m.membership_id}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-start transition-colors ${
                    checked ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${titleId}-entity`}
                    value={m.membership_id}
                    checked={checked}
                    disabled={saving !== null}
                    onChange={() => choose(m.membership_id)}
                    className="h-4 w-4 shrink-0 accent-emerald-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{nameOf(m)}</span>
                    <span className="block text-xs text-slate-500">{ENTITY_TYPE_HE[m.entity_type] ?? m.entity_type}</span>
                  </span>
                  {saving === m.membership_id && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden="true" />
                  )}
                </label>
              );
            })}
          </div>
        </>
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-center gap-2 text-sm ${notice.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
        >
          {notice.kind === 'error'
            ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {notice.text}
        </p>
      )}
    </section>
  );
}
