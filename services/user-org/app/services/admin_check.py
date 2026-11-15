"""R33 A1 · one answer to "is this caller a platform admin".

The gateway sends two things about the caller's role, and they answer
different questions:

  x-user-role      which entity the user is acting as right now
                   ('contractor', 'corporation', 'service_provider'),
                   or 'admin' for an admin with no entity picked
  x-user-is-admin  '1' when the user IS a platform admin, whatever
                   entity they are acting as; absent otherwise

An admin who picked an entity at /select-entity and then opened the
admin area keeps that entity in the JWT, so x-user-role says
'corporation'. Checks written as `x_user_role == "admin"` refused that
admin. Every admin gate reads this helper instead.

Both headers are set by the gateway from a validated JWT and stripped
from anything a client sends (gateway/src/stripIdentityHeaders.js), so
neither can be supplied by a caller.

Use this only where the code asks "is this an admin". Where it asks
"which entity is this", keep reading x-user-role / x-entity-type: an
admin acting as a corporation is a corporation there.
"""
from typing import Optional


def is_admin(x_user_is_admin: Optional[str], x_user_role: Optional[str]) -> bool:
    return x_user_is_admin == "1" or x_user_role == "admin"
