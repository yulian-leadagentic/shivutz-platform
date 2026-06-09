/**
 * POST /api/coming-soon-bypass
 *
 * Validates a `key` against the server-side env var
 * COMING_SOON_PREVIEW_KEY. If it matches, sets the
 * `coming_soon_bypass=1` cookie so subsequent requests bypass the
 * middleware's gate.
 *
 * Why server-side and not just compare on the client: the preview key
 * must NEVER be bundled into the client JS (would defeat the purpose).
 * Validation happens here so the key only lives in the frontend
 * service's runtime env vars.
 *
 * Cookie config:
 *   - 30-day expiry: long enough that the team doesn't need to re-key
 *     every preview session
 *   - httpOnly: middleware reads it, no need for client-side JS access
 *   - sameSite=lax: works across same-origin + most navigations
 *   - secure on prod (when behind https)
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const PREVIEW_KEY = process.env.COMING_SOON_PREVIEW_KEY;
  if (!PREVIEW_KEY) {
    // Gate is enforced but no preview key configured — fail closed.
    // Caller stays on /coming-soon.
    return NextResponse.json({ ok: false, error: 'no_preview_key_configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const submitted = typeof body === 'object' && body !== null && 'key' in body
    ? String((body as { key: unknown }).key ?? '')
    : '';

  if (submitted !== PREVIEW_KEY) {
    return NextResponse.json({ ok: false, error: 'wrong_key' }, { status: 401 });
  }

  // Match accepted — set the bypass cookie. The middleware lets through
  // every request that carries `coming_soon_bypass=1`.
  const res = NextResponse.json({ ok: true });
  res.cookies.set('coming_soon_bypass', '1', {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
