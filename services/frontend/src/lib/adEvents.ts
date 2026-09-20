// R6 §1a + §1c · ad-event sender.
//
// Fire-and-forget POSTs to `/api/events`. The backend endpoint
// (services/user-org/app/routes/events.py) validates event_type +
// target_type + target_id, rate-limits by IP, and returns 204 on
// success. Every input rides through the frontend api base
// (NEXT_PUBLIC_API_URL) so localhost dev + Railway staging + prod
// all resolve the same way.
//
// Two failure modes are ALWAYS tolerated:
//   1. Network / gateway 5xx — the ad is already on screen, we
//      don't rerender it or block the user.
//   2. Ad blocker intercepts the request — same story.
// Everything is wrapped in try/catch and the console noise is one
// low-severity warn (`console.debug`) so a debugging session can
// see events but the browser's default console stays clean.
//
// R6 §1c · `ad_click` fires DURING navigation — we use sendBeacon
// so the browser flushes the request even after the page unloads.
// Impressions use plain fetch because the user isn't leaving.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

// R6 §1b · sessionStorage, NOT cookie / localStorage. Per-tab,
// wiped on tab close — same GDPR/privacy profile as a search
// history the browser forgets. Guarded because SSR / private
// windows / storage-blocked contexts throw.
const SESSION_KEY = 'ad_events_session';

function getSessionId(): string {
  try {
    if (typeof window === 'undefined') return '';
    let sid = window.sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      // 12 random hex chars — enough for dedup, small enough that
      // a network-log with 50 events is still readable.
      sid = Math.random().toString(36).slice(2, 8) +
            Math.random().toString(36).slice(2, 8);
      window.sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return '';
  }
}

export type AdEventType   = 'impression' | 'ad_click' | 'inquiry';
export type AdTargetType  = 'sponsor_ad';
export type AdPlacement   = 'inline' | 'carousel' | 'sidebar' | 'featured' | 'marketplace' | 'trustbar';

interface PostArgs {
  event_type:  AdEventType;
  target_type: AdTargetType;
  target_id:   string;
  placement?:  AdPlacement;
  category?:   string;
}

export function postAdEvent(args: PostArgs): void {
  if (!args.target_id) return;
  const body = JSON.stringify({
    event_type:  args.event_type,
    target_type: args.target_type,
    target_id:   args.target_id,
    session_id:  getSessionId() || undefined,
    metadata: (args.placement || args.category) ? {
      ...(args.placement ? { placement: args.placement } : {}),
      ...(args.category  ? { category:  args.category  } : {}),
    } : undefined,
  });

  try {
    // R6 §1c · ad_click uses sendBeacon so the request survives the
    // navigation the click starts. fetch(keepalive: true) would work
    // in modern Chrome/Firefox but Safari's support is patchy;
    // sendBeacon is the cross-browser guarantee.
    if (args.event_type === 'ad_click' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`${API_BASE}/events`, blob);
      return;
    }
    // Impression + inquiry — plain fetch. `keepalive: true` covers
    // the impression-during-tab-close edge case (a batched impression
    // fires on visibilitychange). Never block the page — no await
    // required by callers.
    void fetch(`${API_BASE}/events`, {
      method:      'POST',
      headers:     { 'content-type': 'application/json' },
      body,
      keepalive:   true,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    // Ad blocker / private mode / broken sendBeacon → silent.
  }
}
