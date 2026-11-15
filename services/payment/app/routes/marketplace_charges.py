"""R37 4.1.2 · the routes for marketplace plan charges.

  POST /payments/marketplace/charges/{id}/pay   charge a purchase that
        user-org approved and wrote down, for the entity that is asking
  GET  /payments/marketplace/charges/mine       the caller's own charges
        and their invoices

Neither takes an amount, a tier or an entity from the request: the
entity is the gateway's, the rest is on the charge row.

R37 4.1.5 · and for a platform admin only:

  GET  /payments/marketplace/charges              every plan charge
  POST /payments/marketplace/charges/{id}/refund  return one in full
"""
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.services import marketplace_charges, marketplace_refunds
from app.services.admin_check import is_admin

router = APIRouter()

BUYERS = ("contractor", "corporation", "service_provider")


def _caller(x_entity_id: Optional[str], x_org_id: Optional[str], x_entity_type: Optional[str]) -> tuple[str, str]:
    entity_id = x_entity_id or x_org_id
    entity_type = (x_entity_type or "").lower()
    if not entity_id or entity_type not in BUYERS:
        raise HTTPException(status_code=403, detail="entity_required")
    return entity_type, entity_id


@router.post("/charges/{charge_id}/pay")
async def pay_charge(
    charge_id: str,
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_type, entity_id = _caller(x_entity_id, x_org_id, x_entity_type)
    charge = marketplace_charges.load(charge_id)
    # Someone else's charge reads the same as one that does not exist.
    if not charge or charge["entity_id"] != entity_id or charge["entity_type"] != entity_type:
        raise HTTPException(status_code=404, detail="charge_not_found")
    try:
        return await marketplace_charges.pay(charge)
    except marketplace_charges.ChargeRefused as refused:
        raise HTTPException(status_code=refused.status, detail=refused.detail)


@router.get("/charges/mine")
def my_charges(
    x_entity_id:   Optional[str] = Header(default=None),
    x_org_id:      Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_type, entity_id = _caller(x_entity_id, x_org_id, x_entity_type)
    return marketplace_charges.mine(entity_type, entity_id)


@router.get("/charges")
def all_charges(
    x_user_role:     Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    if not is_admin(x_user_is_admin, x_user_role):
        raise HTTPException(status_code=403, detail="admin_only")
    return marketplace_refunds.list_for_admin()


@router.post("/charges/{charge_id}/refund")
async def refund_charge(
    charge_id: str,
    x_user_id:       Optional[str] = Header(default=None),
    x_user_role:     Optional[str] = Header(default=None),
    x_user_is_admin: Optional[str] = Header(default=None),
):
    """Return a plan charge to the card it was made on, in full. The
    plan itself is not changed."""
    if not is_admin(x_user_is_admin, x_user_role):
        raise HTTPException(status_code=403, detail="admin_only")
    charge = marketplace_charges.load(charge_id)
    if not charge:
        raise HTTPException(status_code=404, detail="charge_not_found")
    try:
        return await marketplace_refunds.refund(charge, x_user_id)
    except marketplace_refunds.RefundRefused as refused:
        raise HTTPException(status_code=refused.status, detail=refused.detail)
