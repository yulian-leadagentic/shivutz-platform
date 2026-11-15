// What the gateway tells downstream services about the caller, and
// which paths only a platform admin may reach.
//
// Lives in its own module for the same reason stripIdentityHeaders
// does: so the regression test can require and exercise the real
// code, not a copy of it (test/admin-identity-header.test.js).

// Admin-only routes, matched against the request URL (not the service
// prefix) so a sub-path can be admin-only without affecting the rest
// of the upstream service: /api/marketplace/admin/* is admin-only,
// /api/marketplace/* (browse) stays public for everyone.
const ADMIN_ONLY = ['/api/admin', '/api/marketplace/admin'];

function isAdminOnlyPath(url) {
  return ADMIN_ONLY.some((p) => url.startsWith(p));
}

/** Set the identity headers on `headers` from a validated JWT payload. */
function attachUserHeaders(headers, user) {
  headers['x-user-id'] = user.sub;
  // Effective role for this request. Multi-membership users
  // (e.g. yulian@ — owns a corp AND a contractor entity) have a
  // legacy `role` from users.role that reflects their FIRST
  // signup, while their CURRENT working context is decided by
  // the entity they picked at /select-entity. Downstream services
  // gate on the role they're acting as right now, so we project
  // entity_type into x-user-role when present and only fall back
  // to the legacy role for admins (who have no entity context).
  // This fixed the "contractor_only" 403 a corp-rooted contractor
  // got when approving a deal.
  headers['x-user-role'] = user.entity_type || user.role;
  // R33 A1 · "is this caller a platform admin" travels on its own.
  //
  // x-user-role answers "which entity is this user acting as", and an
  // admin who picked an entity at /select-entity keeps that entity in
  // the JWT after opening the admin area. The projection above then
  // says 'corporation', and every backend check written as
  // `x_user_role == "admin"` refused the admin: /admin/marketplace
  // showed `admin_only` under a header that said "מנהל מערכת".
  //
  // The two questions get two headers. x-user-role keeps its meaning,
  // so an admin acting as a corporation is still a corporation where
  // the code asks about the entity. This one is read only where the
  // code asks about the admin. It is in CLIENT_FORBIDDEN_HEADERS, so
  // the only way it reaches a service is from this line.
  if (user.role === 'admin') headers['x-user-is-admin'] = '1';
  else                       delete headers['x-user-is-admin'];
  // x-org-id is consumed across services as the CURRENT ACTING
  // entity's id (the thing the user is operating as right now),
  // not as the legacy users.org_id. For multi-membership users
  // (own a corp AND a contractor), the legacy org_id reflects
  // their first signup — which is the WRONG entity if they're
  // currently acting as the other one. Mirror the entity-aware
  // projection we do for x-user-role: when entity context is
  // present, project entity_id into x-org-id; only fall back
  // to the legacy org_id when there's no entity context (admins
  // with no org, old single-entity users).
  // Audit 2026-05-17: every x-org-id reader (deals, payment,
  // user-org/marketplace*, worker) treats this as "current
  // acting entity" already, so the projection is semantically
  // lossless.
  const effectiveOrgId = user.entity_id || user.org_id;
  if (effectiveOrgId)       headers['x-org-id']          = effectiveOrgId;
  else                      delete headers['x-org-id'];
  if (user.phone)           headers['x-phone']           = user.phone;
  else                      delete headers['x-phone'];
  if (user.entity_id)       headers['x-entity-id']       = user.entity_id;
  else                      delete headers['x-entity-id'];
  if (user.entity_type)     headers['x-entity-type']     = user.entity_type;
  else                      delete headers['x-entity-type'];
  if (user.membership_role) headers['x-membership-role'] = user.membership_role;
  else                      delete headers['x-membership-role'];
  return headers;
}

module.exports = { ADMIN_ONLY, isAdminOnlyPath, attachUserHeaders };
