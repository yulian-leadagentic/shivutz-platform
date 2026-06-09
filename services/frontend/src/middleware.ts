import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Coming-soon gate ─────────────────────────────────────────────────
//
// When `COMING_SOON_MODE=1` is set on the frontend service, every
// request to a page route is rewritten to `/coming-soon` so visitors
// see the pre-launch marketing landing instead of the real platform.
//
// Toggle scope:
//   - Prod:   set COMING_SOON_MODE=1 (gated)
//   - Staging: leave unset (full app accessible — internal testing)
//
// Bypass mechanism — for our own team to QA prod behind the gate:
//   1. Visit https://www.buildupai.net/coming-soon?key=<PREVIEW_KEY>
//   2. The coming-soon page sees `?key=` matching `COMING_SOON_PREVIEW_KEY`
//      env var and sets a `coming_soon_bypass=1` cookie (handled in the
//      page component).
//   3. The middleware below honours that cookie and lets the request
//      through to the real app.
//
// Routes that are NEVER gated (always accessible regardless of mode):
//   - /coming-soon                 — the gate page itself
//   - /_next/*                     — Next.js framework assets
//   - /brand/*                     — static brand assets (logo, fonts)
//   - /api/*                       — API calls (lead capture must work)
//   - /favicon.ico, /manifest, etc — browser metadata
//
// The matcher config at the bottom of the file is the SECOND layer that
// excludes these — the function body has an extra safety check for
// good measure.

const GATE_ENABLED = process.env.COMING_SOON_MODE === '1';

export function middleware(req: NextRequest) {
  if (!GATE_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Always-accessible paths (also covered by matcher config but kept
  // explicit so a future matcher tweak doesn't silently break access).
  if (
    pathname.startsWith('/coming-soon') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/brand') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // Bypass cookie — set by the /coming-soon page when ?key= matches the
  // server-side COMING_SOON_PREVIEW_KEY. Lets the team preview prod
  // without disabling the gate for the whole world.
  if (req.cookies.get('coming_soon_bypass')?.value === '1') {
    return NextResponse.next();
  }

  // Rewrite (not redirect) — the URL stays the same in the browser,
  // but the page rendered is /coming-soon. Better UX than a 301 because
  // the user can still bookmark / share /login etc.; they just see the
  // gate until launch.
  const url = req.nextUrl.clone();
  url.pathname = '/coming-soon';
  return NextResponse.rewrite(url);
}

export const config = {
  // Match all routes except: api, _next/static, _next/image, favicon,
  // manifest, robots, brand assets, profession icons.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|robots\\.txt|brand/|profession-icons/).*)',
  ],
};
