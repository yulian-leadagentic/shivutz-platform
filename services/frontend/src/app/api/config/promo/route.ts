/**
 * GET /api/config/promo
 *
 * R19 §2b · reflect NEXT_PUBLIC_FREE_LAUNCH_UNTIL so the smoke-test
 * consistency suite can compare it against the three other holders
 * of the same date (site_settings.launch_promo_end · payment env ·
 * notification env).
 *
 * Why an API route and not a page: the value is baked into the
 * client bundle at build time (that's what NEXT_PUBLIC_* means), so
 * a fresh server process reflects the SAME string bit-for-bit — we
 * don't need SSR, we just need one endpoint that returns the value
 * without secrets. `null` means the env var was unset at build,
 * which is a legitimate answer and a suite-failing one per §2b.
 *
 * No auth — no secrets in the payload, only the promo date.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const raw = (process.env.NEXT_PUBLIC_FREE_LAUNCH_UNTIL || '').trim();
  return Response.json({
    service:           'frontend',
    free_launch_until: raw || null,
  });
}
