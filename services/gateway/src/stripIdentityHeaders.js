// R30 §30c · ingress strip for caller-supplied identity headers.
//
// x-user-* / x-entity-* are OURS to set from a validated JWT, never
// the caller's to supply. Downstream services trust them completely:
// visibility.py keys its admin bypass off x_user_role alone, by
// design — the trust boundary belongs at the edge rather than being
// re-derived in every service.
//
// That design is only sound while the edge actually holds. Before
// R30 nothing stripped these, and on a public route with no
// Authorization header neither attachUserHeaders branch runs — so a
// forged `x-user-role: admin` reached viewer_scope_wheres() and took
// the bypass: `return ([], [])`, no WHERE clauses, full visibility.
//
// Lives in its own module so the regression test can require and
// exercise THE REAL MIDDLEWARE. The first version of that test
// reimplemented the strip inside itself and passed even with the
// gateway's copy deleted — a test that proved only that its own two
// lines worked.

const CLIENT_FORBIDDEN_HEADERS = [
  'x-user-id', 'x-user-role', 'x-org-id', 'x-phone',
  'x-entity-id', 'x-entity-type', 'x-membership-role',
];

/** Delete every caller-supplied identity header from `headers`. */
function stripIdentityHeaders(headers) {
  for (const h of CLIENT_FORBIDDEN_HEADERS) delete headers[h];
  return headers;
}

/** Express middleware form — mounted before every route in index.js. */
function stripIdentityHeadersMiddleware(req, _res, next) {
  stripIdentityHeaders(req.headers);
  next();
}

module.exports = {
  CLIENT_FORBIDDEN_HEADERS,
  stripIdentityHeaders,
  stripIdentityHeadersMiddleware,
};
