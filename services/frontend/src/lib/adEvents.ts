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
// R34 5c · marketplace listings are counted through the same pipe, so
// a service provider can be shown numbers about its own listings.
// `listing_impression` is a result card on screen, `listing_open` is
// the detail panel opening. There is no reveal event on purpose: the
// reveal endpoint already records one row per viewer in
// marketplace_reveals, and a second copy here would count it twice.
export type ListingEventType = 'listing_impression' | 'listing_open';
export type AdTargetType  = 'sponsor_ad' | 'marketplace_listing';
// R30 §12b · `listing_rail` / `listing_inline` are their own buckets.
// Without them both listing slots fell to the catch-all 'inline' and
// admin CTR could not tell them apart — or tell either from side_rail,
// which was ALSO landing on 'inline' even though 'sidebar' existed
// here unused. Rail-shaped units now bucket as 'sidebar'.
export type AdPlacement =
  | 'inline' | 'carousel' | 'sidebar' | 'featured' | 'marketplace' | 'trustbar'
  | 'listing_rail' | 'listing_inline';

// Two shapes, so a listing event cannot be filed against an ad or the
// other way round. events.py refuses a crossed pair anyway; this makes
// it a compile error first.
type PostArgs = {
  target_id:   string;
  placement?:  AdPlacement;
  category?:   string;
} & (
  | { event_type: AdEventType;      target_type: 'sponsor_ad' }
  | { event_type: ListingEventType; target_type: 'marketplace_listing' }
);

function toWireEvent(args: PostArgs) {
  return {
    event_type:  args.event_type,
    target_type: args.target_type,
    target_id:   args.target_id,
    session_id:  getSessionId() || undefined,
    metadata: (args.placement || args.category) ? {
      ...(args.placement ? { placement: args.placement } : {}),
      ...(args.category  ? { category:  args.category  } : {}),
    } : undefined,
  };
}

// ── R30 §26 · impression coalescing ─────────────────────────────────
//
// The home page mounts four sponsor surfaces and each one fired its
// own POST /events the moment it scrolled into view. The gateway
// gives an anonymous visitor 30 requests per minute
// (services/gateway/src/rateLimit.js), so telemetry alone was
// spending four of them — and because side_rail's fetch is issued
// last, it was the request that got 429'd when the budget ran out.
// The visitor lost the paid ad so we could count the other three.
//
// Impressions now queue and flush together on the next tick. Nothing
// is dropped: the events still reach promo_events, they just arrive
// as one request to /events/batch.
//
// ad_click is deliberately NOT queued — it fires during the
// navigation it triggers, so it keeps its own sendBeacon path. An
// impression queued behind it would never flush.
const _BATCH_WINDOW_MS = 300;
const _BATCH_MAX = 20;           // mirrors _BATCH_MAX in events.py

// R34 5c · listing events wait longer for company. A results grid
// scrolls into view a row at a time, so at 300ms every row would be
// its own request, and those requests share one per-IP budget in
// events.py with the sponsor impressions. Twenty cards must not be
// able to spend the budget the paid slots are counted with. Two
// seconds lets a scroll's worth of cards leave together; nothing is
// lost by waiting, because pagehide and visibilitychange flush
// whatever is queued. A sponsor impression arriving in the meantime
// pulls the flush forward to its own 300ms (see `enqueue`), so the ads
// are never held back by the listings.
const _LISTING_BATCH_WINDOW_MS = 2000;

let _queue: ReturnType<typeof toWireEvent>[] = [];
let _timer: ReturnType<typeof setTimeout> | null = null;
let _timerDue = 0;

function flushQueue(): void {
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
  if (_queue.length === 0) return;
  const events = _queue.splice(0, _queue.length);
  const body = JSON.stringify({ events });
  try {
    // A flush triggered by pagehide/visibilitychange races the tab
    // closing, so prefer sendBeacon there; it is the only transport
    // the browser guarantees to deliver after unload. Falls back to
    // keepalive fetch when sendBeacon is missing or refuses the blob.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(`${API_BASE}/events/batch`, blob)) return;
    }
    void fetch(`${API_BASE}/events/batch`, {
      method:      'POST',
      headers:     { 'content-type': 'application/json' },
      body,
      keepalive:   true,
      credentials: 'include',
    }).catch(() => {});
  } catch {
    // Ad blocker / private mode → silent, same as the single path.
  }
}

function enqueue(args: PostArgs, windowMs: number = _BATCH_WINDOW_MS): void {
  _queue.push(toWireEvent(args));
  // Never let the queue outgrow what the endpoint accepts.
  if (_queue.length >= _BATCH_MAX) { flushQueue(); return; }
  // One timer, due at the earliest deadline anything queued asked for.
  const due = Date.now() + windowMs;
  if (_timer !== null && due >= _timerDue) return;
  if (_timer !== null) clearTimeout(_timer);
  _timerDue = due;
  _timer = setTimeout(flushQueue, windowMs);
}

if (typeof document !== 'undefined') {
  // A visitor who scrolls an ad into view and immediately closes the
  // tab would otherwise lose the impression inside the 300ms window.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQueue();
  });
  window.addEventListener('pagehide', flushQueue);
}

export function postAdEvent(args: PostArgs): void {
  if (!args.target_id) return;

  // R30 §26 · impressions coalesce; clicks and inquiries go straight
  // out. An inquiry is a conversion — it is rare and worth its own
  // request rather than sitting in a queue that may never flush.
  if (args.event_type === 'impression') {
    enqueue(args);
    return;
  }
  // R34 5c · both listing events queue. Neither starts a navigation
  // (the panel opens in place), so neither needs the sendBeacon path
  // a click does.
  if (args.target_type === 'marketplace_listing') {
    enqueue(args, _LISTING_BATCH_WINDOW_MS);
    return;
  }

  const body = JSON.stringify(toWireEvent(args));

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
