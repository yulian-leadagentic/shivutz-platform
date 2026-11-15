"""L1 §1 — entity-access guard.

Five routes in this service take `org_id` in the URL and return the
row without checking that the caller belongs to that org: two
`/organizations/contractors/{id}` shapes, two `/organizations/
corporations/{id}` shapes, and `.../corporations/{id}/documents`.
Any authenticated user who guesses or scrapes a UUID gets phone
numbers and document URLs of other tenants.

The gateway injects `x-entity-id`, `x-entity-type`, and
`x-user-role` from the JWT and strips them when the token is
absent (`gateway/src/index.js:259-263`). That means the headers
here are trustworthy; they cannot be spoofed by a client. So the
check is exclusively an "is this the tenant that owns the row"
comparison, plus an admin bypass — no re-validation of identity.

Contract:
  * missing headers  → 401 no_entity_context
  * admin role       → pass (admin panel + tools drive here too)
  * type mismatch    → 403 wrong_entity_type
  * id mismatch      → 403 not_your_entity
"""
from typing import Optional
from fastapi import HTTPException
from app.services.admin_check import is_admin


def require_entity_access(
    x_entity_id:   Optional[str],
    x_entity_type: Optional[str],
    x_user_role:   Optional[str],
    org_id:        str,
    entity_kind:   str,   # 'corporation' | 'contractor'
    x_user_is_admin: Optional[str] = None,
) -> None:
    # Platform admins can inspect any org (admin panel, support
    # tooling, migrations dashboard). The gateway already gates
    # `/api/admin/*` explicitly, but SEC-1's five routes sit
    # under `/api/organizations/*` — they need to accept an admin
    # caller from that path too.
    if is_admin(x_user_is_admin, x_user_role):
        return
    if not x_entity_id:
        raise HTTPException(status_code=401, detail={"error": "no_entity_context"})
    if x_entity_type != entity_kind:
        raise HTTPException(status_code=403, detail={"error": "wrong_entity_type"})
    if x_entity_id != org_id:
        raise HTTPException(status_code=403, detail={"error": "not_your_entity"})
