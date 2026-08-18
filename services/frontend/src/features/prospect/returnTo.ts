'use client';

// O1 — reveal→register funnel returnTo resilience.
//
// The RevealModal (features/advertising/RevealModal.tsx) links to
//   /register/contractor?returnTo=%2F%3Freveal%3D<adId>
// so a successful register can hand the user back to the ad they
// were trying to reveal. If the URL param is lost mid-flow (OTP
// resend hard-refresh, wizard back/forward, tab reopened from a
// crash) the user lands on a bare dashboard and the highest-intent
// moment on the funnel is wasted.
//
// This helper mirrors the URL param into sessionStorage on entry
// so the register page can recover it on any step, and validates
// the value so an attacker can't smuggle in an external URL for
// an open-redirect.
//
// Trust model: sessionStorage is per-tab and cleared on tab close.
// TTL guards against a stale intent hijacking a later, unrelated
// session in the same tab.

// RT — pendingReveal is the second-tier fallback (URL param lost AND
// sessionStorage cleared, e.g. OTP restart in a different tab). It's
// written by RevealModal:41 to LOCAL storage (not session), so it
// survives tab close/reopen for 30 min. Imported lazily inside
// resolveDestination so the top-level module stays server-safe.
import { readPendingReveal } from './state';

const RETURN_TO_KEY = 'return_to';
const RETURN_TO_TTL_MS = 30 * 60_000; // 30 min, matches PENDING_REVEAL

interface StoredReturnTo {
  path: string;      // sanitized internal path, e.g. '/?reveal=abc123'
  expires_at: string;
}

/**
 * Accepts a URL-decoded path from the returnTo query param and
 * returns it iff it is a safe internal path. Rejects:
 *   - anything not starting with '/'
 *   - protocol-relative URLs ('//evil.com', '/\\evil.com')
 *   - absolute URLs ('http://', 'https://', 'javascript:', 'data:')
 *   - backslash-normalised evasions ('\/evil.com')
 *   - empty / whitespace-only strings
 *
 * The strictest safe form is what RevealModal writes:
 *   /?reveal=<adId>
 * but the guard is intentionally general so future callers can
 * point at any internal route without a helper change.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Must start with '/' and NOT with '//', '/\\', '/%2F', or '/%5C'.
  // The %2F / %5C forms would decode to '//' or '/\' after the
  // browser or Next's router unescapes them once — belt+braces.
  if (!trimmed.startsWith('/')) return null;
  const second = trimmed.charAt(1);
  if (second === '/' || second === '\\') return null;
  const lowerPrefix = trimmed.slice(0, 8).toLowerCase();
  if (lowerPrefix.startsWith('/%2f') || lowerPrefix.startsWith('/%5c')) return null;
  // Reject any control chars — a stray newline would let a
  // downstream `router.push` inject headers on some polyfills.
  if (/[\x00-\x1f]/.test(trimmed)) return null;
  // Belt+braces: no scheme-like prefix even after a leading slash
  // (defensive; browsers reject 'javascript:' relative URLs, but
  // some libraries have parsed it wrong historically).
  if (/^\/[a-z]+:/i.test(trimmed)) return null;
  return trimmed;
}

export function writeReturnTo(path: string): void {
  if (typeof window === 'undefined') return;
  const safe = sanitizeReturnTo(path);
  if (!safe) return;
  const payload: StoredReturnTo = {
    path: safe,
    expires_at: new Date(Date.now() + RETURN_TO_TTL_MS).toISOString(),
  };
  try { window.sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(payload)); }
  catch { /* private-mode / quota — best effort */ }
}

export function readReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(RETURN_TO_KEY); }
  catch { return null; }
  if (!raw) return null;
  let parsed: StoredReturnTo;
  try { parsed = JSON.parse(raw) as StoredReturnTo; }
  catch { return null; }
  if (!parsed || typeof parsed.path !== 'string') return null;
  if (new Date(parsed.expires_at).getTime() < Date.now()) {
    clearReturnTo();
    return null;
  }
  // Re-validate on read — a rogue script could have poked
  // sessionStorage between write and read.
  return sanitizeReturnTo(parsed.path);
}

export function clearReturnTo(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(RETURN_TO_KEY); }
  catch { /* best effort */ }
}

/**
 * Resolve the effective returnTo for a redirect:
 *  1. URL param wins when present + valid (visible source of truth)
 *  2. Falls back to sessionStorage (survived a lost URL param)
 *  3. Returns `fallback` otherwise
 * Never returns an unsafe path.
 */
export function resolveReturnTo(fromQuery: string | null, fallback: string): string {
  const fromUrl = sanitizeReturnTo(fromQuery);
  if (fromUrl) return fromUrl;
  const fromStore = readReturnTo();
  if (fromStore) return fromStore;
  return fallback;
}

/**
 * RT — full post-auth destination resolver, shared by /login,
 * /select-entity, /register/contractor, /register/corporation. One
 * priority chain across every surface that decides "where does the
 * user land after auth?" so the reveal-intent contract can't drift
 * per page.
 *
 * Priority (docs/cc-prompts/cc_prompt_return_to_reveal.md §2):
 *   1. `?next=`      — RT-prompt contract param
 *   2. `?returnTo=`  — legacy param used by RevealModal + register
 *                      wizards already in the wild
 *   3. readReturnTo() — sessionStorage mirror (URL param that has
 *                      survived an OTP restart within the tab)
 *   4. readPendingReveal() — localStorage reveal intent (survives
 *                      tab close for 30 min; last-resort recovery)
 *   5. `fallback`    — role-appropriate dashboard
 *
 * Every stored/queried string is re-validated by sanitizeReturnTo,
 * so an attacker who pokes sessionStorage still can't smuggle in an
 * `http://…` for open-redirect.
 */
export function resolveDestination(
  nextParam: string | null | undefined,
  returnToParam: string | null | undefined,
  fallback: string,
): string {
  const fromNext = sanitizeReturnTo(nextParam);
  if (fromNext) return fromNext;
  const fromReturn = sanitizeReturnTo(returnToParam);
  if (fromReturn) return fromReturn;
  const fromStore = readReturnTo();
  if (fromStore) return fromStore;
  const pending = readPendingReveal();
  if (pending) return `/?reveal=${encodeURIComponent(pending.adId)}`;
  return fallback;
}
