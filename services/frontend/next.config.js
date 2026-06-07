/** @type {import('next').NextConfig} */
//
// rewrites() proxies /api/* through the Next.js server to the gateway,
// so the browser only ever talks to its own origin. Removes the need
// for a separate `api.<env>.buildupai.net` subdomain plus DNS plus cert
// per environment — one server-side env var on the frontend service
// (GATEWAY_URL) is enough.
//
// How to wire it on Railway (per env):
//   1. On the frontend service, set `GATEWAY_URL` to the gateway's URL.
//      Easiest is a Railway reference: `https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}`
//      (assuming the gateway service is named `gateway`). Or hard-code the
//      gateway's *.up.railway.app domain — either works at runtime.
//   2. On the frontend service, set `NEXT_PUBLIC_API_URL=/api` so the
//      browser issues same-origin requests; the rewrite below forwards
//      them. (If NEXT_PUBLIC_API_URL is absent, the client falls back to
//      http://localhost:3000/api which is wrong in prod.)
//
// GATEWAY_URL is a SERVER-SIDE env var — Railway doesn't bake it into
// the build, so changing it doesn't require a frontend rebuild.

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // Resolution order:
    //   1. GATEWAY_URL  — explicit override (set this when the gateway
    //      lives outside the Railway project or on a different network).
    //   2. http://gateway.railway.internal:3000 — Railway's internal DNS
    //      between services in the same project, IF the gateway service
    //      is named `gateway`. Works without any env var, no public URL
    //      needed. Falls back silently if the service is named something
    //      else (you'll see 502s on /api/*).
    const gateway = (process.env.GATEWAY_URL
      || 'http://gateway.railway.internal:3000').replace(/\/+$/, '');
    return [
      { source: '/api/:path*', destination: `${gateway}/api/:path*` },
    ];
  },
};
module.exports = nextConfig;
