from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import os, httpx

from app.db import get_db

router = APIRouter()

USER_ORG_URL = os.getenv("USER_ORG_SERVICE_URL", "http://user-org:3002")


@router.get("/pending-approvals")
def list_pending():
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, contact_name, contact_phone, business_number,
                   kablan_number, kvutza, sivug, gov_branch, gov_company_status,
                   verification_tier, verification_method,
                   commission_per_worker_amount,
                   approval_sla_deadline, created_at, 'contractor' AS org_type
            FROM contractors
            WHERE approval_status='pending' AND deleted_at IS NULL
            UNION ALL
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, contact_name, contact_phone, business_number,
                   NULL AS kablan_number, NULL AS kvutza, NULL AS sivug,
                   NULL AS gov_branch, gov_company_status,
                   verification_tier, verification_method,
                   commission_per_worker_amount,
                   approval_sla_deadline, created_at, 'corporation' AS org_type
            FROM corporations
            WHERE approval_status='pending' AND deleted_at IS NULL
            ORDER BY approval_sla_deadline ASC
            """
        )
        rows = cur.fetchall()
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
                elif hasattr(v, 'as_tuple'):  # Decimal
                    r[k] = float(v)
        return rows
    finally:
        conn.close()


@router.get("/orgs/{org_id}")
def get_org(org_id: str, org_type: str = "contractor"):
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        table = "contractors" if org_type == "contractor" else "corporations"
        cur.execute(f"SELECT * FROM {table} WHERE id=%s AND deleted_at IS NULL", (org_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Organisation not found")
        for k, v in row.items():
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
        return {**row, "org_type": org_type}
    finally:
        conn.close()


@router.get("/approved-orgs")
def list_approved():
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, approval_status, created_at, 'contractor' AS org_type
            FROM contractors WHERE deleted_at IS NULL
            UNION ALL
            SELECT id, company_name, COALESCE(company_name_he,'') AS company_name_he,
                   contact_email, approval_status, created_at, 'corporation' AS org_type
            FROM corporations WHERE deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 200
            """
        )
        rows = cur.fetchall()
        for r in rows:
            for k, v in r.items():
                if hasattr(v, 'isoformat'):
                    r[k] = v.isoformat()
        return rows
    finally:
        conn.close()


class ApprovalDecision(BaseModel):
    approved: bool
    reason: Optional[str] = None
    commission_per_worker_amount: Optional[float] = None  # if set, override entity commission at approval time


class OrgEdit(BaseModel):
    company_name_he: Optional[str] = None
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    commission_per_worker_amount: Optional[float] = None
    notes: Optional[str] = None
    # Registry / business fields — admin can correct these (e.g. fix mojibake,
    # update after רשם החברות status change, override a wrong סיווג).
    business_number: Optional[str] = None
    gov_company_status: Optional[str] = None
    # Contractor-only registry fields
    kablan_number: Optional[str] = None
    kvutza: Optional[str] = None
    sivug: Optional[int] = None
    gov_branch: Optional[str] = None
    # Corporation-only fields
    countries_of_origin: Optional[list] = None
    minimum_contract_months: Optional[int] = None


def _audit(conn, entity_type: str, entity_id: str, actor_id: str,
           action: str, old: dict, new: dict) -> None:
    """Append a row to auth_db.audit_log capturing what changed."""
    import json
    cur = conn.cursor()
    diff = {k: {"old": old.get(k), "new": new[k]} for k in new
            if k in old and old.get(k) != new[k]}
    if not diff and not old:
        diff = {"new": new}
    cur.execute(
        """INSERT INTO auth_db.audit_log
             (entity_type, entity_id, actor_id, action, metadata)
           VALUES (%s, %s, %s, %s, %s)""",
        (entity_type, entity_id, actor_id, action, json.dumps(diff, default=str, ensure_ascii=False)),
    )


@router.patch("/approvals/{org_id}")
async def decide(
    org_id: str,
    body: ApprovalDecision,
    org_type: str = "contractor",
    x_user_id: Optional[str] = Header(default=None),
):
    admin_user_id = x_user_id or "admin"
    status = "approved" if body.approved else "rejected"
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        table = "contractors" if org_type == "contractor" else "corporations"

        # Snapshot before state for the audit row.
        cur.execute(
            f"SELECT approval_status, verification_tier, commission_per_worker_amount FROM {table} WHERE id=%s",
            (org_id,),
        )
        before = cur.fetchone() or {}

        # Manual approval is the path that bumps verification_tier to tier_2.
        # For contractors:  tier_2 = identity-verified principal (can submit to corp).
        # For corporations: tier_2 = "תאגיד מאושר" (only path to publish/offer workers).
        if body.approved:
            sets = [
                "approval_status='approved'",
                "approved_by_user_id=%s",
                "approved_at=NOW()",
                "rejection_reason=%s",
                "verification_tier='tier_2'",
                "verification_method='manual'",
                "verified_at=NOW()",
                "revalidate_at=DATE_ADD(NOW(), INTERVAL 183 DAY)",
            ]
            params = [admin_user_id, body.reason]
            if body.commission_per_worker_amount is not None:
                sets += ["commission_per_worker_amount=%s",
                         "commission_set_by_user_id=%s",
                         "commission_set_at=NOW()"]
                params += [body.commission_per_worker_amount, admin_user_id]
            params.append(org_id)
            cur.execute(
                f"UPDATE {table} SET {', '.join(sets)} WHERE id=%s AND deleted_at IS NULL",
                tuple(params),
            )
        else:
            cur.execute(
                f"""UPDATE {table}
                    SET approval_status=%s, approved_by_user_id=%s,
                        approved_at=NOW(), rejection_reason=%s
                    WHERE id=%s AND deleted_at IS NULL""",
                (status, admin_user_id, body.reason, org_id),
            )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Organisation not found")

        new_state = {
            "approval_status": "approved" if body.approved else "rejected",
            "verification_tier": "tier_2" if body.approved else before.get("verification_tier"),
            "commission_per_worker_amount": body.commission_per_worker_amount
                if body.commission_per_worker_amount is not None
                else (float(before["commission_per_worker_amount"]) if before.get("commission_per_worker_amount") is not None else None),
        }
        _audit(conn, org_type, org_id, admin_user_id,
               "decided" if body.approved else "rejected",
               {k: (float(v) if hasattr(v, "as_tuple") else v) for k, v in (before or {}).items()},
               new_state)
        conn.commit()

        cur.execute(
            f"SELECT company_name, contact_email, contact_name FROM {table} WHERE id=%s",
            (org_id,),
        )
        org = cur.fetchone()

        # Best-effort: fire event via user-org which has the RabbitMQ publisher
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.patch(
                    f"{USER_ORG_URL}/admin/approvals/{org_id}",
                    params={"org_type": org_type},
                    json={
                        "approved": body.approved,
                        "reason": body.reason or "",
                        "admin_user_id": admin_user_id,
                    },
                )
        except Exception:
            pass

        return {
            "id": org_id,
            "org_type": org_type,
            "status": status,
            "company_name": org["company_name"] if org else "",
        }
    finally:
        conn.close()


# ── Admin edit + document upload + audit history ────────────────────────────

@router.patch("/orgs/{org_id}/edit")
def edit_org(
    org_id: str,
    body: OrgEdit,
    org_type: str = "contractor",
    x_user_id: Optional[str] = Header(default=None),
):
    """Admin edits contractor / corporation fields. Records the diff in
    audit_log so changes are traceable. Useful for fixing mojibake names,
    updating contact details, overriding commission, etc."""
    if org_type not in ("contractor", "corporation"):
        raise HTTPException(status_code=400, detail="invalid org_type")
    table = "contractors" if org_type == "contractor" else "corporations"
    admin_user_id = x_user_id or "admin"

    import json as _json

    updates: dict = body.model_dump(exclude_none=True)

    # Strip fields that don't apply to this org_type to avoid SQL errors
    # against columns that don't exist on the other table.
    CONTRACTOR_ONLY = {"kablan_number", "kvutza", "sivug", "gov_branch"}
    CORPORATION_ONLY = {"countries_of_origin", "minimum_contract_months"}
    if org_type == "contractor":
        for k in CORPORATION_ONLY:
            updates.pop(k, None)
    else:
        for k in CONTRACTOR_ONLY:
            updates.pop(k, None)

    if not updates:
        raise HTTPException(status_code=400, detail="no_fields_to_update")

    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        # Snapshot the affected fields BEFORE the update for the audit row.
        sel_cols = ", ".join(updates.keys())
        cur.execute(f"SELECT {sel_cols} FROM {table} WHERE id=%s AND deleted_at IS NULL", (org_id,))
        before = cur.fetchone() or {}
        if not before:
            raise HTTPException(status_code=404, detail="org_not_found")

        sets: list = []
        params: list = []
        for k, v in updates.items():
            sets.append(f"{k}=%s")
            # JSON columns need serialization.
            params.append(_json.dumps(v, ensure_ascii=False) if k == "countries_of_origin" else v)
        if "commission_per_worker_amount" in updates:
            sets += ["commission_set_by_user_id=%s", "commission_set_at=NOW()"]
            params += [admin_user_id]
        params.append(org_id)
        try:
            cur.execute(
                f"UPDATE {table} SET {', '.join(sets)} WHERE id=%s AND deleted_at IS NULL",
                tuple(params),
            )
        except Exception as e:
            # Most likely UNIQUE collision on business_number.
            msg = str(e)
            if "uq_business_number" in msg or "Duplicate entry" in msg:
                raise HTTPException(status_code=409, detail={
                    "code": "business_number_taken",
                    "message": "מספר ע.מ / ח.פ כבר קיים במערכת",
                })
            raise

        _audit(conn, org_type, org_id, admin_user_id, "admin_edit",
               {k: (float(v) if hasattr(v, "as_tuple") else v) for k, v in before.items()},
               updates)
        conn.commit()
        return {"id": org_id, "updated_fields": list(updates.keys())}
    finally:
        conn.close()


@router.get("/orgs/{org_id}/audit")
def get_org_audit(org_id: str, org_type: str = "contractor", limit: int = 100):
    """Recent audit-log entries for a specific org. Visible to admin."""
    conn = get_db("org_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT log_id, actor_id, action, metadata, created_at
               FROM auth_db.audit_log
               WHERE entity_type=%s AND entity_id=%s
               ORDER BY created_at DESC
               LIMIT %s""",
            (org_type, org_id, limit),
        )
        rows = cur.fetchall()
        for r in rows:
            for col in ("created_at",):
                if hasattr(r.get(col), "isoformat"):
                    r[col] = r[col].isoformat()
        return rows
    finally:
        conn.close()
