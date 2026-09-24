// R30 §30c · the gateway must strip caller-supplied identity headers.
//
// visibility.py trusts `x_user_role` on its own — deliberately, and
// correctly: the trust boundary belongs at the edge, and re-validating
// the JWT in every service would duplicate it. Its docstring says so
// outright ("The gateway already projects entity_type || role into
// x-user-role").
//
// That makes the gateway's strip load-bearing. Before R30 it did not
// exist, and the limiter ran before auth, so a request could arrive
// with `x-user-role: admin` and no Authorization header at all: on a
// public route NEITHER attachUserHeaders branch runs, so the forged
// value would have reached viewer_scope_wheres() and taken the admin
// bypass — `return ([], [])`, no WHERE clauses, full visibility.
//
// Yulian's call (§30c): the window needs nothing beyond the fix, but
// the fix needs a lock. Without this test a future gateway refactor
// reopens it silently, and by then it is production rather than
// staging.
//
// Covers the three headers named in §30c: x-user-id, x-user-role,
// x-org-id.

// Built-ins only — no express, no install step.
const http = require('http');

// THE REAL MIDDLEWARE, not a copy of it.
//
// The first version of this test reimplemented the strip inside
// buildServer() and asserted against that. It passed with the
// gateway's own strip deleted — it was proving that its own two lines
// worked. The strip now lives in its own module precisely so this
// test can require it; index.js requires the same one, and the
// wiring assertion at the bottom proves index.js still mounts it.
const {
  CLIENT_FORBIDDEN_HEADERS,
  stripIdentityHeaders,
} = require('../src/stripIdentityHeaders');

function buildServer() {
  return http.createServer((req, res) => {
    // The gateway's actual strip, imported.
    stripIdentityHeaders(req.headers);
    // Stand-in for a public route: echoes whatever identity headers
    // survived, which is exactly what a downstream service reads.
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      seen_user_id:   req.headers['x-user-id']   ?? null,
      seen_user_role: req.headers['x-user-role'] ?? null,
      seen_org_id:    req.headers['x-org-id']    ?? null,
    }));
  });
}

function get(server, headers) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ port, path: '/api/search', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  const failures = [];
  const server = buildServer().listen(0);
  await new Promise((r) => server.once('listening', r));

  try {
    // The attack: full admin identity, no Authorization header.
    const forged = await get(server, {
      'x-user-role': 'admin',
      'x-user-id':   '00000000-0000-0000-0000-000000000001',
      'x-org-id':    '00000000-0000-0000-0000-000000000002',
    });

    for (const [key, label] of [
      ['seen_user_role', 'x-user-role'],
      ['seen_user_id',   'x-user-id'],
      ['seen_org_id',    'x-org-id'],
    ]) {
      if (forged[key] !== null) {
        failures.push(
          `${label} survived the strip (downstream saw ${JSON.stringify(forged[key])}). ` +
          `A public route would treat this caller as that identity.`
        );
      }
    }

    // A request with no identity headers must still work — the strip
    // must not break the anonymous path it is protecting.
    const clean = await get(server, {});
    if (clean.seen_user_role !== null) {
      failures.push('anonymous request somehow carried a role');
    }

    // The assertions above exercise the real middleware, so they prove
    // it WORKS. They cannot prove the gateway still calls it — drop
    // the app.use() line and every one of them keeps passing. That is
    // exactly how the first version of this test passed with the
    // gateway's strip deleted. So: assert the wiring too.
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

    // Comment-aware. A plain regex over the source matches
    // `// app.use(stripIdentityHeadersMiddleware);` just as happily as
    // the real call — which is how the previous revision of this test
    // reported PASS on a gateway with the strip commented out. Scan
    // lines and skip anything commented.
    const liveLines = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*'));

    const requires = liveLines.some((l) =>
      /require\(['"]\.\/stripIdentityHeaders['"]\)/.test(l));
    if (!requires) {
      failures.push('src/index.js no longer requires stripIdentityHeaders');
    }

    const mountLine = liveLines.findIndex((l) =>
      /app\.use\(\s*stripIdentityHeadersMiddleware\s*\)/.test(l));
    if (mountLine === -1) {
      failures.push(
        'src/index.js no longer mounts stripIdentityHeadersMiddleware — ' +
        'forged headers would reach downstream services'
      );
    }
    // Order matters as much as presence: mounted after the proxies it
    // runs too late to protect anything.
    //
    // Compare against where the proxies are MOUNTED, not against the
    // first mention of createProxyMiddleware — that is the require at
    // the top of the file, which precedes every app.use() and made
    // this assertion fire on correct code.
    const proxyLine = liveLines.findIndex((l) => /app\.use\(\s*prefix\s*,/.test(l));
    if (mountLine !== -1 && proxyLine !== -1 && mountLine > proxyLine) {
      failures.push('strip is mounted AFTER the proxy routes — it must run first');
    }
    if (CLIENT_FORBIDDEN_HEADERS.length < 3) {
      failures.push('CLIENT_FORBIDDEN_HEADERS looks truncated');
    }
  } finally {
    server.close();
  }

  if (failures.length) {
    console.error('[forged-identity-headers] FAIL');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('[forged-identity-headers] pass — x-user-id / x-user-role / x-org-id all stripped');
}

run().catch((e) => { console.error(e); process.exit(1); });
