"""
Deal state machine transitions:
  proposed → counter_proposed → accepted → active → reporting → completed
                                                               → disputed
  Any state → cancelled
"""
from fastapi import HTTPException
from app.db import get_db
from app.services import audit
import uuid

VALID_TRANSITIONS = {
    "proposed":         {"counter_proposed", "accepted", "cancelled"},
    "counter_proposed": {"accepted", "cancelled"},
    "accepted":         {"active", "cancelled"},
    "active":           {"reporting", "cancelled"},
    "reporting":        {"completed", "disputed"},
    "completed":        set(),
    "disputed":         {"completed", "cancelled"},
    "cancelled":        set(),
}


def transition(deal_id: str, new_status: str, performed_by: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id = %s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="Deal not found")

        current = deal["status"]
        if new_status not in VALID_TRANSITIONS.get(current, set()):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot transition deal from '{current}' to '{new_status}'"
            )

        cur.execute("UPDATE deals SET status = %s WHERE id = %s", (new_status, deal_id))
        conn.commit()

        audit.log("deal", deal_id, "status_changed", performed_by,
                  old_value={"status": current},
                  new_value={"status": new_status})

        # On acceptance: record agreed price + mark workers as assigned + attach standard contract
        if new_status == "accepted":
            _apply_pricing(conn, deal_id, deal["corporation_id"], performed_by)
            _assign_workers(conn, deal_id)
            _attach_standard_contract(conn, deal_id, deal["corporation_id"])

        # On activation (contractor confirms): post system message with contractor contact details
        if new_status == "active":
            _post_contractor_contact(conn, deal_id, deal.get("contractor_id"))

        # On completion or cancellation: release the workers back to available
        if new_status in ("completed", "cancelled"):
            _free_workers(conn, deal_id)

        return {"id": deal_id, "status": new_status}
    finally:
        conn.close()


def _assign_workers(conn, deal_id: str):
    """Mark all deal workers as assigned in worker_db and link current_deal_id."""
    try:
        cur = conn.cursor()
        # Get assigned worker IDs
        cur.execute(
            "SELECT worker_id FROM deal_workers WHERE deal_id=%s",
            (deal_id,)
        )
        rows = cur.fetchall()
        for row in rows:
            wid = row["worker_id"]
            cur.execute(
                "UPDATE worker_db.workers SET status='assigned', current_deal_id=%s "
                "WHERE id=%s AND deleted_at IS NULL",
                (deal_id, wid)
            )
        conn.commit()
    except Exception:
        pass  # best-effort; don't block the deal transition


def _free_workers(conn, deal_id: str):
    """Release workers tied to this deal back to available."""
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE worker_db.workers SET status='available', current_deal_id=NULL "
            "WHERE current_deal_id=%s AND deleted_at IS NULL",
            (deal_id,)
        )
        conn.commit()
    except Exception:
        pass  # best-effort


def _post_contractor_contact(conn, deal_id: str, contractor_id: str):
    """Auto-post a system message with contractor contact details when deal goes active."""
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT company_name_he, company_name, contact_name, contact_phone, contact_email "
            "FROM org_db.contractors WHERE id=%s AND deleted_at IS NULL",
            (contractor_id,)
        )
        row = cur.fetchone()
        if not row:
            return
        name = row.get("company_name_he") or row.get("company_name") or "קבלן"
        contact = row.get("contact_name") or ""
        phone   = row.get("contact_phone") or ""
        email   = row.get("contact_email") or ""

        lines = [f"✅ הקבלן אישר את ההתקשרות — פרטי יצירת קשר:"]
        lines.append(f"חברה: {name}")
        if contact: lines.append(f"איש קשר: {contact}")
        if phone:   lines.append(f"טלפון: {phone}")
        if email:   lines.append(f"דוא״ל: {email}")
        content = "\n".join(lines)

        cur.execute(
            """INSERT INTO messages (id, deal_id, sender_user_id, sender_role, content, content_type)
               VALUES (%s, %s, 'system', 'contractor', %s, 'system')""",
            (str(uuid.uuid4()), deal_id, content)
        )
        conn.commit()
    except Exception:
        pass  # best-effort


def _attach_standard_contract(conn, deal_id: str, corporation_id: str):
    """Copy the corporation's standard_contract document URL to the deal record."""
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT file_url, file_name
                 FROM auth_db.entity_documents
                WHERE entity_type = 'corporation'
                  AND entity_id   = %s
                  AND doc_type    = 'standard_contract'
                  AND deleted_at IS NULL
             ORDER BY uploaded_at DESC
                LIMIT 1""",
            (corporation_id,)
        )
        doc = cur.fetchone()
        if not doc:
            return
        cur.execute(
            """UPDATE deals
                  SET standard_contract_url      = %s,
                      standard_contract_doc_name = %s
                WHERE id = %s""",
            (doc["file_url"], doc.get("file_name", "חוזה התקשרות"), deal_id)
        )
        conn.commit()
    except Exception:
        pass  # best-effort; don't block acceptance


def _apply_pricing(conn, deal_id: str, corporation_id: str, performed_by: str):
    """Look up current pricing for the corporation and stamp agreed_price on the deal."""
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT price_per_deal FROM corporation_pricing
            WHERE corporation_id=%s AND is_active=1
              AND (valid_until IS NULL OR valid_until >= CURDATE())
            ORDER BY created_at DESC LIMIT 1
        """, (corporation_id,))
        row = cur.fetchone()
        if row:
            price = row["price_per_deal"]
            cur.execute(
                "UPDATE deals SET agreed_price=%s WHERE id=%s",
                (price, deal_id)
            )
            conn.commit()
            audit.log("deal", deal_id, "price_applied", performed_by,
                      new_value={"agreed_price": str(price), "source": "corporation_pricing"})
    except Exception:
        pass  # pricing is best-effort; don't block acceptance


def check_discrepancy(deal_id: str):
    """Compare contractor and corporation reports. Flag if mismatched."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT reported_by, actual_workers, actual_days FROM deal_reports WHERE deal_id = %s",
            (deal_id,)
        )
        reports = {r["reported_by"]: r for r in cur.fetchall()}

        if "contractor" not in reports or "corporation" not in reports:
            return  # Both reports not yet submitted

        c_rep = reports["contractor"]
        corp_rep = reports["corporation"]

        workers_match = c_rep["actual_workers"] == corp_rep["actual_workers"]
        days_diff = abs(c_rep["actual_days"] - corp_rep["actual_days"])

        if not workers_match or days_diff > 2:
            details = {
                "contractor_workers": c_rep["actual_workers"],
                "corporation_workers": corp_rep["actual_workers"],
                "contractor_days": c_rep["actual_days"],
                "corporation_days": corp_rep["actual_days"],
            }
            import json
            cur.execute(
                "UPDATE deals SET discrepancy_flag=TRUE, discrepancy_details=%s, status='disputed' WHERE id=%s",
                (json.dumps(details), deal_id)
            )
            conn.commit()
            audit.log("deal", deal_id, "discrepancy_flagged", "system", new_value=details)
            return True
        else:
            cur.execute("UPDATE deals SET status='completed' WHERE id=%s", (deal_id,))
            conn.commit()
            audit.log("deal", deal_id, "status_changed", "system",
                      old_value={"status": "reporting"}, new_value={"status": "completed"})
            return False
    finally:
        conn.close()
