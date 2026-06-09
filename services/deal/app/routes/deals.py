from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime, timedelta
from decimal import Decimal
import uuid, os
import httpx

from app.db import get_db
from app.services import audit
from app.publisher import publish_event

router = APIRouter()

JOB_MATCH_URL = os.getenv("JOB_MATCH_SERVICE_URL", "http://job-match:3004")
PAYMENT_URL  = os.getenv("PAYMENT_SERVICE_URL",  "http://payment:3009")
WORKER_URL   = os.getenv("WORKER_SERVICE_URL",   "http://worker:3003")


class DealCreate(BaseModel):
    """Inquiry sent by contractor to corp. The corp side commits the worker
    list later via POST /deals/{id}/commit. No price field — commission is
    applied at corp-commit time as accepted_count × system_settings rate.

    Wave 3 (2026-05-06): the project umbrella was dropped — `search_id`
    points directly at job_db.worker_searches. The legacy
    `request_line_item_id` field is accepted as an alias for one release."""
    search_id: Optional[str] = None
    request_line_item_id: Optional[str] = None  # legacy alias — to be removed
    contractor_id: Optional[str] = None
    corporation_id: str
    proposed_by: Optional[str] = None
    notes: Optional[str] = None


class CommitRequest(BaseModel):
    """Corp action — attach the final worker list and place the J5 hold.
    The list is frozen against editing once committed (replace_worker has
    its own endpoint). All workers must belong to the corp, must not be
    locked to another deal."""
    worker_ids: List[str]


class CancelRequest(BaseModel):
    reason: Optional[str] = None


class ReplaceWorkerRequest(BaseModel):
    old_worker_id: str
    new_worker_id: str


def _fetch_commission_rate(conn, contractor_id: Optional[str] = None) -> Decimal:
    """Resolve the commission rate to apply to this deal.

    Lookup order:
      1. Contractor's own `commission_per_worker_amount` (admin-overridable per entity)
      2. payment_db.system_settings.commission_per_worker_nis (platform default)
      3. 0 (defensive — admin should always set the platform default)
    """
    if contractor_id:
        cur = conn.cursor()
        cur.execute(
            "SELECT commission_per_worker_amount FROM org_db.contractors WHERE id=%s AND deleted_at IS NULL",
            (contractor_id,),
        )
        row = cur.fetchone()
        if row and row["commission_per_worker_amount"] is not None:
            rate = Decimal(str(row["commission_per_worker_amount"]))
            if rate > 0:
                return rate

    cur = conn.cursor()
    cur.execute(
        "SELECT setting_value FROM payment_db.system_settings WHERE setting_key='commission_per_worker_nis'"
    )
    row = cur.fetchone()
    if not row or row["setting_value"] is None:
        return Decimal(0)
    return Decimal(str(row["setting_value"]))


def _read_setting_int(conn, key: str, default: int) -> int:
    cur = conn.cursor()
    cur.execute(
        "SELECT setting_value FROM payment_db.system_settings WHERE setting_key=%s", (key,)
    )
    row = cur.fetchone()
    if not row:
        return default
    try:
        return int(row["setting_value"])
    except (ValueError, TypeError):
        return default


def _enrich_event_payload(deal_id: str, contractor_id: str, corporation_id: str,
                          worker_count: Optional[int] = None,
                          search_id: Optional[str] = None) -> dict:
    """Pull party contact info + profession/region context so the notification
    consumer can route emails/SMS to the right recipients without extra
    round-trips. Best-effort — empty values fall through gracefully."""
    out = {
        "deal_id":          deal_id,
        "deal_id_short":    deal_id[:8],
        "contractor_id":    contractor_id,
        "corporation_id":   corporation_id,
        "worker_count":     worker_count,
    }
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT contact_name, contact_email, contact_phone, company_name_he "
            "FROM org_db.contractors WHERE id=%s",
            (contractor_id,),
        )
        c = cur.fetchone() or {}
        cur.execute(
            "SELECT contact_name, contact_email, contact_phone, company_name_he "
            "FROM org_db.corporations WHERE id=%s",
            (corporation_id,),
        )
        p = cur.fetchone() or {}
        out.update({
            "contractor_contact_name":  c.get("contact_name") or "",
            "contractor_contact_email": c.get("contact_email") or "",
            "contractor_contact_phone": c.get("contact_phone") or "",
            "contractor_name":          c.get("company_name_he") or "",
            "corp_contact_name":        p.get("contact_name") or "",
            "corp_contact_email":       p.get("contact_email") or "",
            "corp_contact_phone":       p.get("contact_phone") or "",
            "corp_name":                p.get("company_name_he") or "",
        })
        # profession_he/region_he: best-effort lookup via the search row.
        # Cross-service join is fragile; we skip it on any error and the
        # template falls back to a generic phrasing.
        if search_id:
            try:
                cur.execute(
                    "SELECT ws.profession_type, ws.quantity, "
                    "       COALESCE(pt.name_he, ws.profession_type) AS prof_he, "
                    "       ws.region "
                    "FROM job_db.worker_searches ws "
                    "LEFT JOIN worker_db.profession_types pt ON pt.code = ws.profession_type "
                    "WHERE ws.id=%s",
                    (search_id,),
                )
                ws = cur.fetchone() or {}
                out["profession_he"]   = ws.get("prof_he") or ""
                out["region_he"]       = ws.get("region")  or ""
                out["requested_count"] = int(ws.get("quantity") or 0)
            except Exception:
                out["profession_he"]   = ""
                out["region_he"]       = ""
                out["requested_count"] = 0
        else:
            out["profession_he"]   = ""
            out["region_he"]       = ""
            out["requested_count"] = 0
    finally:
        conn.close()
    return out


def _serialize_deal(row: dict) -> dict:
    """JSON-friendly serialization."""
    for k, v in list(row.items()):
        if isinstance(v, Decimal):
            row[k] = float(v)
        elif hasattr(v, "isoformat"):
            row[k] = v.isoformat()
    # MySQL JSON columns come back as strings from PyMySQL — parse them
    # so the frontend gets actual arrays. Currently only
    # requested_origins (from worker_searches.origin_preference) is
    # joined into the deal payload; expand the list as needed.
    import json as _json
    raw_origins = row.get("requested_origins")
    if isinstance(raw_origins, str):
        try:
            row["requested_origins"] = _json.loads(raw_origins) or []
        except Exception:
            row["requested_origins"] = []
    elif raw_origins is None:
        row["requested_origins"] = []
    return row


# Fields that reveal a counter-party's identity. Frontend joins to org_db
# elsewhere to get names — these are just the IDs. Pre-disclosure phases
# don't return the counter-party ID at all.
DISCLOSED_STATES = {"approved", "closed", "cancelled_by_corp"}


def _filter_for_caller(row: dict, caller_role: str, caller_org_id: Optional[str]) -> dict:
    """Apply info-disclosure rules. Caller is the contractor or corporation
    party; admin sees everything. Until the deal reaches `approved` (or
    later), each side sees only their own ID — never the counter-party's."""
    if caller_role == "admin":
        return row
    disclosed = row.get("status") in DISCLOSED_STATES
    if disclosed:
        return row
    out = dict(row)
    if caller_org_id and caller_org_id == row.get("contractor_id"):
        out["corporation_id"] = None
    elif caller_org_id and caller_org_id == row.get("corporation_id"):
        out["contractor_id"] = None
    return out


@router.get("")
def list_deals(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """List deals visible to the caller. Paginated envelope."""
    offset = (page - 1) * page_size
    empty = {"items": [], "page": page, "page_size": page_size, "total": 0}

    conn = get_db()
    try:
        cur = conn.cursor()
        # Build the role-scoped WHERE clause for the deals (aliased as d).
        if x_user_role == "admin":
            where, params = "d.deleted_at IS NULL", ()
        elif x_user_role == "corporation" and x_org_id:
            where, params = "d.corporation_id=%s AND d.deleted_at IS NULL", (x_org_id,)
        elif x_org_id:
            where, params = "d.contractor_id=%s AND d.deleted_at IS NULL", (x_org_id,)
        else:
            return empty

        cur.execute(f"SELECT COUNT(*) AS c FROM deals d WHERE {where}", params)
        total = int(cur.fetchone()["c"])

        # Enrich each row with worker_count + profession_he + requested_count
        # via cross-DB joins so the table can show what each deal is about
        # without N+1 round trips from the frontend.
        cur.execute(
            f"""SELECT d.*,
                       (SELECT COUNT(*) FROM deal_workers dw
                        WHERE dw.deal_id=d.id AND dw.removed_at IS NULL) AS worker_count,
                       ws.profession_type,
                       ws.quantity AS requested_count,
                       COALESCE(pt.name_he, ws.profession_type) AS profession_he,
                       ws.region AS region_he
                FROM deals d
                LEFT JOIN job_db.worker_searches ws       ON ws.id = d.search_id
                LEFT JOIN worker_db.profession_types pt   ON pt.code = ws.profession_type
                WHERE {where}
                ORDER BY d.created_at DESC
                LIMIT %s OFFSET %s""",
            params + (page_size, offset),
        )
        rows = [_serialize_deal(r) for r in cur.fetchall()]
        rows = [_filter_for_caller(r, x_user_role or "", x_org_id) for r in rows]
        return {"items": rows, "page": page, "page_size": page_size, "total": total}
    finally:
        conn.close()


def _require_contractor_tier_2(contractor_id: str) -> None:
    """Block deal proposals from contractors that haven't completed identity
    verification (tier_2). Tier_0 / tier_1 contractors can browse and build
    their own internal projects, but submitting an application to a
    corporation requires a verified principal."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT verification_tier FROM org_db.contractors WHERE id = %s AND deleted_at IS NULL",
            (contractor_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="contractor_not_found")
        if row["verification_tier"] != "tier_2":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "verification_required",
                    "message": "אימות בעלות נדרש לפני הגשת בקשה לתאגיד. השלם אימות בהגדרות.",
                    "current_tier": row["verification_tier"],
                },
            )
    finally:
        conn.close()


@router.post("", status_code=201)
async def create_deal(
    data: DealCreate,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    contractor_id = data.contractor_id or x_org_id
    proposed_by = data.proposed_by or x_user_id or "unknown"

    # Verification gate — only when the contractor is the one initiating.
    if x_user_role == "contractor" and contractor_id:
        _require_contractor_tier_2(contractor_id)

    # Wave 3: search_id directly references job_db.worker_searches.
    # Accept the legacy field name as a fallback for one release.
    search_id = data.search_id or data.request_line_item_id

    deal_id = str(uuid.uuid4())
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO deals
               (id, search_id, contractor_id, corporation_id, proposed_by, notes)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (deal_id, search_id, contractor_id, data.corporation_id,
             proposed_by, data.notes)
        )
        conn.commit()

        audit.log("deal", deal_id, "created", proposed_by,
                  new_value={"contractor_id": contractor_id, "corporation_id": data.corporation_id})

        await publish_event("deal.proposed", {
            "deal_id": deal_id,
            "contractor_id": contractor_id,
            "corporation_id": data.corporation_id,
        })

        return {"id": deal_id, "status": "proposed"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── POST /deals/from-search/{search_id} — corp-initiated proposal ──────────
#
# Corp browses /corporation/requests and clicks "השב לדרישה" on a search
# it wasn't auto-matched to. We create (or reuse) a 'proposed' deal row
# for (this corp, this search) and return the deal_id so the FE can
# navigate straight into the existing /corporation/deals/{id} allocation
# flow. The contractor_id is resolved from the search itself — the corp
# never sees it on the browse surface (anonymized "קבלן N").
#
# Idempotent: if a deal already exists for this (corp, search), we
# return it instead of creating a duplicate.
@router.post("/from-search/{search_id}", status_code=201)
async def create_deal_from_search(
    search_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    if x_user_role not in ("corporation", "admin"):
        raise HTTPException(status_code=403, detail="corp_only")
    if not x_org_id:
        raise HTTPException(status_code=400, detail="entity_context_required")

    corporation_id = x_org_id
    proposed_by    = x_user_id or "unknown"

    conn = get_db()
    try:
        cur = conn.cursor()

        # Idempotency — reuse existing deal if one exists for this (corp, search).
        cur.execute(
            """SELECT id, status FROM deals
               WHERE search_id=%s AND corporation_id=%s AND deleted_at IS NULL
               LIMIT 1""",
            (search_id, corporation_id),
        )
        existing = cur.fetchone()
        if existing:
            return {"id": existing["id"], "status": existing["status"], "reused": True}

        # Resolve contractor_id from the search (cross-db query to job_db).
        cur.execute(
            "SELECT contractor_id, status FROM job_db.worker_searches WHERE id=%s",
            (search_id,),
        )
        srow = cur.fetchone()
        if not srow:
            raise HTTPException(status_code=404, detail="search_not_found")
        if srow["status"] not in ("open", "partially_matched"):
            raise HTTPException(status_code=409, detail="search_not_active")
        contractor_id = srow["contractor_id"]

        deal_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO deals
               (id, search_id, contractor_id, corporation_id, proposed_by, notes)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (deal_id, search_id, contractor_id, corporation_id, proposed_by, None),
        )
        conn.commit()

        audit.log("deal", deal_id, "created_from_browse", proposed_by,
                  new_value={"contractor_id": contractor_id,
                             "corporation_id": corporation_id,
                             "search_id": search_id})

        await publish_event("deal.proposed", {
            "deal_id": deal_id,
            "contractor_id": contractor_id,
            "corporation_id": corporation_id,
            "corp_initiated": True,
        })

        return {"id": deal_id, "status": "proposed", "reused": False}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── Deal lifecycle endpoints (replaces the old /status PATCH) ───────────────

@router.post("/{deal_id}/commit")
async def commit_deal(
    deal_id: str,
    body: CommitRequest,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Corp commits the worker list. Locks workers, places the J5 hold,
    transitions deal to `corp_committed`, sets the 7-day expiry."""
    if not body.worker_ids:
        raise HTTPException(status_code=400, detail="worker_ids required")
    if x_user_role not in ("corporation", "admin"):
        raise HTTPException(status_code=403, detail="corp_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["corporation_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "proposed":
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "message": f"Deal already in state '{deal['status']}'"},
            )

        # Validate each worker belongs to this corp and isn't locked elsewhere.
        placeholders = ",".join(["%s"] * len(body.worker_ids))
        cur.execute(
            f"""SELECT id, corporation_id, current_deal_id, status
                FROM worker_db.workers
                WHERE id IN ({placeholders}) AND deleted_at IS NULL""",
            tuple(body.worker_ids),
        )
        workers = cur.fetchall()
        if len(workers) != len(body.worker_ids):
            raise HTTPException(status_code=400, detail="some_workers_not_found")
        for w in workers:
            if w["corporation_id"] != deal["corporation_id"]:
                raise HTTPException(status_code=400, detail={"code": "worker_not_yours", "worker_id": w["id"]})
            if w["current_deal_id"] and w["current_deal_id"] != deal_id:
                raise HTTPException(status_code=409, detail={"code": "worker_locked", "worker_id": w["id"]})

        # Compute commission snapshot — per-contractor rate, fallback to system default.
        rate = _fetch_commission_rate(conn, contractor_id=deal["contractor_id"])
        commission_amount = rate * len(body.worker_ids)
        approval_hours = _read_setting_int(conn, "approval_deadline_hours", 24)

        now = datetime.utcnow()
        expires_at = now + timedelta(hours=approval_hours)

        # Lock workers and attach to the deal.
        cur.execute(
            f"""UPDATE worker_db.workers
                SET current_deal_id=%s, status='assigned', updated_at=NOW()
                WHERE id IN ({placeholders})""",
            (deal_id, *body.worker_ids),
        )
        cur.execute("DELETE FROM deal_workers WHERE deal_id=%s", (deal_id,))
        for wid in body.worker_ids:
            cur.execute(
                "INSERT INTO deal_workers (id, deal_id, worker_id) VALUES (%s,%s,%s)",
                (str(uuid.uuid4()), deal_id, wid),
            )

        # Transition the deal.
        cur.execute(
            """UPDATE deals
               SET status='corp_committed',
                   corp_committed_at=%s,
                   corp_committed_by_user_id=%s,
                   commission_amount=%s,
                   expires_at=%s
               WHERE id=%s""",
            (now, x_user_id, commission_amount, expires_at, deal_id),
        )
        conn.commit()

        audit.log("deal", deal_id, "corp_committed", x_user_id or "unknown",
                  new_value={"worker_count": len(body.worker_ids), "commission_amount": float(commission_amount)})

        # Place the J5 hold via payment service. Failure here doesn't roll back
        # the commit — admin gets visibility via the payment_status field.
        # The CORP is the paying party (per T&C: BuildUp commission is on
        # the corp side; corp holds card on file, corp can cancel during
        # the grace window). The previous code wrongly passed contractor_id
        # — that caused the cancel-engagement, capture, void and refund
        # endpoints (which all compare tx.charged_entity_id against the
        # acting user's org_id) to return 403 Forbidden whenever the corp
        # tried to manage the hold. Schema default for
        # payment_transactions.charged_entity_type is already 'corporation';
        # this brings deal-service in line with it.
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{PAYMENT_URL}/payments/deals/{deal_id}/authorize",
                    json={
                        "amount": float(commission_amount),
                        "charged_entity_type": "corporation",
                        "charged_entity_id":   deal["corporation_id"],
                    },
                )
        except httpx.HTTPError as e:
            # Don't block the lifecycle on payment-service flakiness.
            audit.log("deal", deal_id, "j5_authorize_failed", "system",
                      new_value={"error": str(e)})

        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            worker_count=len(body.worker_ids), search_id=deal.get("search_id"),
        )
        payload.update({
            "commission_amount": float(commission_amount),
            "expires_at":        expires_at.isoformat() + "Z",
        })
        await publish_event("deal.corp_committed", payload)

        return {"id": deal_id, "status": "corp_committed", "expires_at": expires_at.isoformat() + "Z",
                "commission_amount": float(commission_amount)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/{deal_id}/reveal-corp")
async def reveal_corp(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor unlocks the corp's identity WITHOUT approving the deal.
    Step 1 of 2 in the contractor's post-proposal flow:

      1. (this endpoint) reveal-corp  → status stays 'corp_committed';
         contractor sees corp name + contact info, can talk offline.
      2. POST /approve                → contractor formally commits;
         status flips to 'approved', capture timer starts.

    Idempotent — re-calling on an already-revealed deal is a no-op (it
    just re-asserts the same timestamp). RBAC matches /approve:
    contractor of the deal, or admin.
    """
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        # Only allow reveal once the corp has committed workers. Earlier
        # (e.g. status='proposed' before any worker selection) there
        # isn't an "offer" worth revealing yet.
        if deal["status"] not in ("corp_committed", "approved", "active", "reporting", "closed"):
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "current": deal["status"],
                        "message": "corp must have committed workers before reveal"},
            )

        # Idempotent: if already revealed, just return the existing
        # timestamp. Avoids audit-log noise on accidental double-clicks.
        if deal.get("corp_revealed_at"):
            return {
                "id":               deal_id,
                "status":           deal["status"],
                "corp_revealed_at": deal["corp_revealed_at"].isoformat() + "Z"
                                    if hasattr(deal["corp_revealed_at"], "isoformat")
                                    else deal["corp_revealed_at"],
            }

        now = datetime.utcnow()
        cur.execute(
            "UPDATE deals SET corp_revealed_at=%s WHERE id=%s",
            (now, deal_id),
        )
        conn.commit()
        audit.log("deal", deal_id, "corp_revealed", x_user_id or "unknown",
                  new_value={"revealed_at": now.isoformat() + "Z"})
        return {
            "id":               deal_id,
            "status":           deal["status"],
            "corp_revealed_at": now.isoformat() + "Z",
        }
    except HTTPException:
        raise
    finally:
        conn.close()


@router.post("/{deal_id}/approve")
async def approve_deal(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor approves the worker list. Schedules capture for now+capture_delay_hours.
    During this window the corp can still cancel; otherwise capture fires automatically."""
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "corp_committed":
            raise HTTPException(status_code=409, detail={"code": "wrong_state", "current": deal["status"]})

        capture_hours = _read_setting_int(conn, "capture_delay_hours", 48)
        now = datetime.utcnow()
        scheduled_capture_at = now + timedelta(hours=capture_hours)

        cur.execute(
            """UPDATE deals
               SET status='approved',
                   approved_at=%s,
                   scheduled_capture_at=%s,
                   expires_at=NULL
               WHERE id=%s""",
            (now, scheduled_capture_at, deal_id),
        )
        conn.commit()

        audit.log("deal", deal_id, "approved", x_user_id or "unknown",
                  new_value={"scheduled_capture_at": scheduled_capture_at.isoformat() + "Z"})

        # Worker count from deal_workers join (snapshot at commit time).
        cur.execute("SELECT COUNT(*) AS c FROM deal_workers WHERE deal_id=%s", (deal_id,))
        wc = int((cur.fetchone() or {}).get("c") or 0)
        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            worker_count=wc, search_id=deal.get("search_id"),
        )
        payload.update({
            "commission_amount":   float(deal["commission_amount"] or 0),
            "scheduled_capture_at": scheduled_capture_at.isoformat() + "Z",
        })
        await publish_event("deal.approved", payload)

        return {"id": deal_id, "status": "approved",
                "scheduled_capture_at": scheduled_capture_at.isoformat() + "Z"}
    except HTTPException:
        raise
    finally:
        conn.close()


async def _void_payment_hold(deal_id: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{PAYMENT_URL}/payments/deals/{deal_id}/void")
    except httpx.HTTPError:
        pass  # cron will clean up later; admin sees via payment_status


def _unlock_workers(cur, deal_id: str) -> None:
    cur.execute(
        """UPDATE worker_db.workers
           SET current_deal_id=NULL, status='available', updated_at=NOW()
           WHERE current_deal_id=%s""",
        (deal_id,),
    )


@router.post("/{deal_id}/reject")
async def reject_deal(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor declines the worker list. J5 voided, workers unlocked."""
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "corp_committed":
            raise HTTPException(status_code=409, detail={"code": "wrong_state", "current": deal["status"]})

        now = datetime.utcnow()
        _unlock_workers(cur, deal_id)
        cur.execute(
            "UPDATE deals SET status='rejected', rejected_at=%s WHERE id=%s",
            (now, deal_id),
        )
        conn.commit()

        audit.log("deal", deal_id, "rejected", x_user_id or "unknown")

        await _void_payment_hold(deal_id)

        cur.execute("SELECT COUNT(*) AS c FROM deal_workers WHERE deal_id=%s", (deal_id,))
        wc = int((cur.fetchone() or {}).get("c") or 0)
        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            worker_count=wc, search_id=deal.get("search_id"),
        )
        payload.update({
            "commission_amount": float(deal["commission_amount"] or 0),
            "rejected_at":       now.isoformat() + "Z",
        })
        await publish_event("deal.rejected", payload)
        return {"id": deal_id, "status": "rejected"}
    except HTTPException:
        raise
    finally:
        conn.close()


@router.post("/{deal_id}/contractor-cancel")
async def contractor_cancel_deal(
    deal_id: str,
    body: CancelRequest,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor withdraws an in-flight deal.

    Used by the "סגור שאר ההצעות" action on the deals page: when one
    corp has fulfilled the full requested quantity, the other corps'
    bids become irrelevant and the contractor should be able to
    retract them in one click.

    Allowed source states:
      * proposed / counter_proposed — corp hasn't responded yet,
        so nothing to unlock / void.
      * corp_committed             — corp committed workers; we
        also unlock those workers + void the payment hold, just
        like reject does.

    Anything else (already accepted, closed, cancelled, expired,
    rejected) is rejected with 409 wrong_state — those deals are
    either done or already terminal-negative.
    """
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    cancellable_states = {"proposed", "counter_proposed", "corp_committed"}
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] not in cancellable_states:
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "current": deal["status"]},
            )

        now    = datetime.utcnow()
        reason = (body.reason or "").strip() or "התקבלה הצעה אחרת"
        had_workers = deal["status"] == "corp_committed"

        if had_workers:
            _unlock_workers(cur, deal_id)
        cur.execute(
            """UPDATE deals
                  SET status='cancelled_by_contractor',
                      cancelled_at=%s,
                      cancelled_by='contractor',
                      cancellation_reason=%s,
                      expires_at=NULL,
                      scheduled_capture_at=NULL
                WHERE id=%s""",
            (now, reason, deal_id),
        )
        conn.commit()
        audit.log(
            "deal", deal_id, "contractor_cancelled", x_user_id or "unknown",
            new_value={"reason": reason, "from_status": deal["status"]},
        )
        if had_workers:
            await _void_payment_hold(deal_id)

        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            search_id=deal.get("search_id"),
        )
        payload.update({
            "cancellation_reason": reason,
            "cancelled_at":        now.isoformat() + "Z",
            "from_status":         deal["status"],
        })
        await publish_event("deal.contractor_cancelled", payload)
        return {"id": deal_id, "status": "cancelled_by_contractor"}
    except HTTPException:
        raise
    finally:
        conn.close()


@router.post("/{deal_id}/cancel")
async def cancel_deal(
    deal_id: str,
    body: CancelRequest,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Corp cancels during the post-approval billing window. J5 voided,
    workers unlocked, admin gets an urgent alert."""
    if x_user_role not in ("corporation", "admin"):
        raise HTTPException(status_code=403, detail="corp_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["corporation_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "approved":
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "current": deal["status"],
                        "message": "ניתן לבטל רק עסקאות שאושרו ולפני שהחיוב התבצע"},
            )

        now = datetime.utcnow()
        _unlock_workers(cur, deal_id)
        cur.execute(
            """UPDATE deals
               SET status='cancelled_by_corp',
                   cancelled_at=%s,
                   cancelled_by='corp',
                   cancellation_reason=%s,
                   scheduled_capture_at=NULL
               WHERE id=%s""",
            (now, body.reason, deal_id),
        )
        conn.commit()

        audit.log("deal", deal_id, "cancelled_by_corp", x_user_id or "unknown",
                  new_value={"reason": body.reason})

        await _void_payment_hold(deal_id)

        cur.execute("SELECT COUNT(*) AS c FROM deal_workers WHERE deal_id=%s", (deal_id,))
        wc = int((cur.fetchone() or {}).get("c") or 0)
        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            worker_count=wc, search_id=deal.get("search_id"),
        )
        payload.update({
            "commission_amount":   float(deal["commission_amount"] or 0),
            "cancellation_reason": body.reason or "",
            "cancelled_at":        now.isoformat() + "Z",
        })
        await publish_event("deal.cancelled_by_corp", payload)
        return {"id": deal_id, "status": "cancelled_by_corp"}
    except HTTPException:
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────
# Contractor-side close-the-loop endpoints
# After the contractor "approves" (= reveals corp details), they
# coordinate with the corp off-platform. Once that's done, they come
# back and tell us whether the deal actually closed — those two
# outcomes go through these two endpoints.
# ─────────────────────────────────────────────────────────────────────

@router.post("/{deal_id}/contractor-confirm-closed")
async def contractor_confirm_closed(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor confirms: yes, the deal actually closed. Status
    advances to 'closed' (commission stays scheduled / captured per
    the existing capture cron)."""
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "approved":
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "current": deal["status"],
                        "message": "ניתן לאשר סגירת עסקה רק במצב 'אושר'"},
            )
        now = datetime.utcnow()
        cur.execute(
            "UPDATE deals SET status='closed', closed_at=%s WHERE id=%s",
            (now, deal_id),
        )
        conn.commit()
        audit.log("deal", deal_id, "contractor_confirmed_closed", x_user_id or "unknown")
        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            search_id=deal.get("search_id"),
        )
        await publish_event("deal.contractor_confirmed_closed", payload)
        return {"id": deal_id, "status": "closed"}
    except HTTPException:
        raise
    finally:
        conn.close()


class ContractorDeclineCloseRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/{deal_id}/contractor-decline-closed")
async def contractor_decline_closed(
    deal_id: str,
    body: ContractorDeclineCloseRequest,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Contractor declines: the deal did NOT close. Reason text is
    captured to the audit log and the cancellation_reason column.
    Status advances to 'cancelled_by_contractor' and the J5 hold is
    voided (no commission charged)."""
    if x_user_role not in ("contractor", "admin"):
        raise HTTPException(status_code=403, detail="contractor_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["contractor_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] != "approved":
            raise HTTPException(
                status_code=409,
                detail={"code": "wrong_state", "current": deal["status"],
                        "message": "ניתן לציין שעסקה לא נסגרה רק במצב 'אושר'"},
            )
        now = datetime.utcnow()
        reason = (body.reason or '').strip() or None
        _unlock_workers(cur, deal_id)
        cur.execute(
            """UPDATE deals
               SET status='cancelled_by_contractor',
                   cancelled_at=%s,
                   cancelled_by='contractor',
                   cancellation_reason=%s,
                   scheduled_capture_at=NULL
               WHERE id=%s""",
            (now, reason, deal_id),
        )
        conn.commit()
        audit.log("deal", deal_id, "contractor_declined_closed", x_user_id or "unknown",
                  new_value={"reason": reason or ""})
        await _void_payment_hold(deal_id)
        payload = _enrich_event_payload(
            deal_id, deal["contractor_id"], deal["corporation_id"],
            search_id=deal.get("search_id"),
        )
        payload.update({"cancellation_reason": reason or ""})
        await publish_event("deal.contractor_declined_closed", payload)
        return {"id": deal_id, "status": "cancelled_by_contractor"}
    except HTTPException:
        raise
    finally:
        conn.close()


@router.post("/{deal_id}/replace_worker")
async def replace_worker(
    deal_id: str,
    body: ReplaceWorkerRequest,
    x_org_id: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Corp swaps one worker for another in a corp_committed or approved deal.
    If the new worker matches the old on (occupation, country, languages,
    years_in_israel) the deal stays in its current state. Otherwise the deal
    reverts to corp_committed and the contractor's 7-day timer restarts."""
    if x_user_role not in ("corporation", "admin"):
        raise HTTPException(status_code=403, detail="corp_only")

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM deals WHERE id=%s AND deleted_at IS NULL", (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        if x_user_role != "admin" and deal["corporation_id"] != x_org_id:
            raise HTTPException(status_code=403, detail="not_your_deal")
        if deal["status"] not in ("corp_committed", "approved"):
            raise HTTPException(status_code=409, detail={"code": "wrong_state", "current": deal["status"]})

        # Both workers must exist and belong to this corp.
        cur.execute(
            """SELECT id, corporation_id, current_deal_id, profession_type,
                      origin_country, languages, years_in_israel
               FROM worker_db.workers
               WHERE id IN (%s, %s) AND deleted_at IS NULL""",
            (body.old_worker_id, body.new_worker_id),
        )
        rows = {r["id"]: r for r in cur.fetchall()}
        old_w, new_w = rows.get(body.old_worker_id), rows.get(body.new_worker_id)
        if not old_w or not new_w:
            raise HTTPException(status_code=400, detail="worker_not_found")
        if new_w["corporation_id"] != deal["corporation_id"]:
            raise HTTPException(status_code=400, detail="new_worker_not_yours")
        if new_w["current_deal_id"] and new_w["current_deal_id"] != deal_id:
            raise HTTPException(status_code=409, detail="new_worker_locked")
        if old_w["current_deal_id"] != deal_id:
            raise HTTPException(status_code=400, detail="old_worker_not_in_deal")

        # Material change detection.
        def _norm_langs(v):
            if isinstance(v, str):
                import json
                try: v = json.loads(v)
                except Exception: v = []
            return sorted(str(x).lower() for x in (v or []))

        material = (
            old_w["profession_type"]   != new_w["profession_type"] or
            old_w["origin_country"]    != new_w["origin_country"]  or
            _norm_langs(old_w["languages"]) != _norm_langs(new_w["languages"]) or
            (old_w["years_in_israel"] or 0) > (new_w["years_in_israel"] or 0)
        )

        # Swap the worker.
        cur.execute(
            "UPDATE worker_db.workers SET current_deal_id=NULL, status='available' WHERE id=%s",
            (body.old_worker_id,),
        )
        cur.execute(
            "UPDATE worker_db.workers SET current_deal_id=%s, status='assigned' WHERE id=%s",
            (deal_id, body.new_worker_id),
        )
        cur.execute("DELETE FROM deal_workers WHERE deal_id=%s AND worker_id=%s",
                    (deal_id, body.old_worker_id))
        cur.execute(
            "INSERT INTO deal_workers (id, deal_id, worker_id) VALUES (%s,%s,%s)",
            (str(uuid.uuid4()), deal_id, body.new_worker_id),
        )

        # If material → reset to corp_committed with a fresh 7-day window;
        # capture is cancelled if it was scheduled.
        new_status = deal["status"]
        if material and deal["status"] == "approved":
            approval_hours = _read_setting_int(conn, "approval_deadline_hours", 24)
            new_expires_at = datetime.utcnow() + timedelta(hours=approval_hours)
            cur.execute(
                """UPDATE deals
                   SET status='corp_committed',
                       expires_at=%s,
                       scheduled_capture_at=NULL,
                       approved_at=NULL
                   WHERE id=%s""",
                (new_expires_at, deal_id),
            )
            new_status = "corp_committed"

        conn.commit()
        audit.log("deal", deal_id, "worker_replaced", x_user_id or "unknown",
                  new_value={"old": body.old_worker_id, "new": body.new_worker_id, "material": material})
        return {"id": deal_id, "status": new_status, "material_change": material}
    except HTTPException:
        raise
    finally:
        conn.close()


# ── Internal endpoints called by cron jobs (no auth — gateway-side) ─────────

@router.post("/internal/expire-pending")
async def cron_expire_pending():
    """Mark corp_committed deals past expires_at as expired, void their J5,
    unlock workers. Returns counts. Called from notification-service cron."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT d.id, d.contractor_id, d.corporation_id, d.commission_amount,
                      d.search_id,
                      (SELECT COUNT(*) FROM deal_workers dw WHERE dw.deal_id=d.id) AS worker_count
               FROM deals d
               WHERE d.status='corp_committed' AND d.expires_at <= NOW()
                 AND d.deleted_at IS NULL"""
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    expired = 0
    for d in rows:
        conn = get_db()
        try:
            cur = conn.cursor()
            _unlock_workers(cur, d["id"])
            cur.execute(
                "UPDATE deals SET status='expired' WHERE id=%s AND status='corp_committed'", (d["id"],)
            )
            conn.commit()
            expired += 1
        finally:
            conn.close()
        await _void_payment_hold(d["id"])
        payload = _enrich_event_payload(
            d["id"], d["contractor_id"], d["corporation_id"],
            worker_count=int(d.get("worker_count") or 0),
            search_id=d.get("search_id"),
        )
        payload["commission_amount"] = float(d["commission_amount"] or 0)
        await publish_event("deal.expired", payload)
    return {"expired": expired}


@router.post("/internal/capture-due")
async def cron_capture_due():
    """Capture J5 holds for deals where scheduled_capture_at has passed.
    Each capture call hits the payment service which issues the invoice."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT d.id, d.contractor_id, d.corporation_id, d.commission_amount,
                      d.search_id,
                      (SELECT COUNT(*) FROM deal_workers dw WHERE dw.deal_id=d.id) AS worker_count
               FROM deals d
               WHERE d.status='approved' AND d.scheduled_capture_at <= NOW()
                 AND d.deleted_at IS NULL"""
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    captured = 0
    failed = 0
    for d in rows:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(f"{PAYMENT_URL}/payments/deals/{d['id']}/capture")
            if r.status_code >= 400:
                failed += 1
                continue
        except httpx.HTTPError:
            failed += 1
            continue

        conn = get_db()
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE deals SET status='closed', closed_at=NOW() WHERE id=%s AND status='approved'",
                (d["id"],),
            )
            conn.commit()
            captured += 1
        finally:
            conn.close()

        payload = _enrich_event_payload(
            d["id"], d["contractor_id"], d["corporation_id"],
            worker_count=int(d.get("worker_count") or 0),
            search_id=d.get("search_id"),
        )
        payload["commission_amount"] = float(d["commission_amount"] or 0)
        await publish_event("deal.closed", payload)
    return {"captured": captured, "failed": failed}


@router.get("/internal/contractor-approval-reminder-targets")
async def cron_contractor_reminder_targets():
    """Return one row per contractor that has corp_committed deals
    older than 24h waiting for their approval. Called daily by the
    notification service to fan out SMS reminders.

    Cross-DB join to org_db.contractors so we get the contact phone
    in a single query (mysql user is root locally; on Railway both
    DBs live on the same plugin so the join is cheap).
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
              c.id              AS contractor_id,
              c.contact_phone   AS contact_phone,
              c.contact_name    AS contact_name,
              c.company_name_he AS company_name_he,
              COUNT(DISTINCT d.id)        AS pending_count,
              COUNT(DISTINCT d.search_id) AS request_count
            FROM deal_db.deals d
            JOIN org_db.contractors c ON c.id = d.contractor_id
            WHERE d.status = 'corp_committed'
              AND d.deleted_at IS NULL
              AND TIMESTAMPDIFF(HOUR, d.corp_committed_at, NOW()) >= 24
              AND c.contact_phone IS NOT NULL
              AND c.deleted_at IS NULL
            GROUP BY c.id, c.contact_phone, c.contact_name, c.company_name_he
            """
        )
        return {"targets": cur.fetchall()}
    finally:
        conn.close()


@router.post("/internal/admin-nudge")
async def cron_admin_nudge():
    """Find corp_committed deals pending > admin_nudge_after_hours hours and
    fire one nudge per deal (deduped via simple flag). Called hourly."""
    conn = get_db()
    try:
        cur = conn.cursor()
        nudge_after = _read_setting_int(conn, "admin_nudge_after_hours", 24)
        cur.execute(
            """SELECT d.id, d.contractor_id, d.corporation_id, d.commission_amount,
                      d.corp_committed_at, d.expires_at, d.search_id,
                      TIMESTAMPDIFF(HOUR, d.corp_committed_at, NOW()) AS hours_pending,
                      (SELECT COUNT(*) FROM deal_workers dw WHERE dw.deal_id=d.id) AS worker_count
               FROM deals d
               WHERE d.status='corp_committed'
                 AND TIMESTAMPDIFF(HOUR, d.corp_committed_at, NOW()) >= %s
                 AND d.deleted_at IS NULL""",
            (nudge_after,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    for d in rows:
        payload = _enrich_event_payload(
            d["id"], d["contractor_id"], d["corporation_id"],
            worker_count=int(d.get("worker_count") or 0),
            search_id=d.get("search_id"),
        )
        payload.update({
            "commission_amount": float(d["commission_amount"] or 0),
            "hours_pending":     int(d["hours_pending"] or 0),
            "expires_at":        d["expires_at"].isoformat() + "Z" if d["expires_at"] else None,
        })
        await publish_event("deal.pending_admin_nudge", payload)
    return {"nudged": len(rows)}


@router.get("/internal/corp-response-overdue")
async def cron_corp_response_overdue():
    """Cron target: deals in 'proposed' state past the corp-response
    deadline whose admin notification hasn't yet fired.

    The corp has `corp_response_hours` hours from the deal's
    created_at to commit workers (commit_deal transitions the deal
    to 'corp_committed'). If they don't, admin gets notified once
    per deal. Late commits are still allowed — the notification
    is informational, not blocking.

    Returns the deal payload + admin recipients so the cron in the
    notification service can compose the SMS and the admin
    dashboard can render the in-app banner.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        hours = _read_setting_int(conn, "corp_response_hours", 48)
        cur.execute(
            f"""SELECT d.id, d.contractor_id, d.corporation_id, d.search_id,
                       d.created_at, d.proposed_admin_notified_at,
                       TIMESTAMPDIFF(HOUR, d.created_at, NOW()) AS hours_past_deadline_total
                  FROM deals d
                 WHERE d.status = 'proposed'
                   AND d.deleted_at IS NULL
                   AND d.proposed_admin_notified_at IS NULL
                   AND d.created_at + INTERVAL {int(hours)} HOUR <= NOW()""",
        )
        deals = cur.fetchall()
        # Admin recipients — phones only (a row with NULL phone is skipped).
        cur.execute(
            "SELECT id, phone FROM auth_db.users WHERE role='admin' AND phone IS NOT NULL"
        )
        admins = cur.fetchall()
        return {
            "hours": hours,
            "deals": [
                {
                    "id":            d["id"],
                    "contractor_id": d["contractor_id"],
                    "corporation_id": d["corporation_id"],
                    "search_id":     d["search_id"],
                    "created_at":    d["created_at"].isoformat() + "Z" if d["created_at"] else None,
                    "hours_past":    int(d["hours_past_deadline_total"] or 0) - hours,
                }
                for d in deals
            ],
            "admins": admins,
        }
    finally:
        conn.close()


@router.post("/internal/corp-response-overdue/{deal_id}/mark-notified")
async def cron_corp_response_overdue_mark(deal_id: str):
    """Idempotency latch — sets proposed_admin_notified_at so the
    cron doesn't re-fire the SMS / banner for this deal."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE deals
                  SET proposed_admin_notified_at = NOW()
                WHERE id = %s
                  AND proposed_admin_notified_at IS NULL""",
            (deal_id,),
        )
        conn.commit()
        return {"id": deal_id, "rows_affected": cur.rowcount}
    finally:
        conn.close()


@router.get("/internal/corp-response-overdue/count")
async def admin_overdue_count():
    """Lightweight count for the admin dashboard banner — total
    proposed deals past the corp-response deadline (notified or
    not). Used by the admin banner to decide whether to render."""
    conn = get_db()
    try:
        cur = conn.cursor()
        hours = _read_setting_int(conn, "corp_response_hours", 48)
        cur.execute(
            f"""SELECT COUNT(*) AS n
                  FROM deals d
                 WHERE d.status = 'proposed'
                   AND d.deleted_at IS NULL
                   AND d.created_at + INTERVAL {int(hours)} HOUR <= NOW()""",
        )
        return {"count": int(cur.fetchone()["n"]), "hours": hours}
    finally:
        conn.close()


@router.get("/internal/by-search/{search_id}")
async def internal_deals_by_search(search_id: str):
    """List existing (deal_id, corporation_id, status) tuples for a
    given search_id. Internal-only — used by the notification
    consumer's rematch flow to skip corps that already have a deal
    before creating new ones.

    No auth header gating: lives under /internal/* alongside the
    overdue endpoints, which run from the same trust boundary
    (notification consumer, cron, admin dashboard counter).
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, corporation_id, status
                  FROM deals
                 WHERE search_id = %s
                   AND deleted_at IS NULL""",
            (search_id,),
        )
        return [
            {
                "deal_id": r["id"],
                "corporation_id": r["corporation_id"],
                "status": r["status"],
            }
            for r in cur.fetchall()
        ]
    finally:
        conn.close()


@router.get("/{deal_id}/workers")
def get_deal_workers(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    """Return the worker list for a deal, redacted by caller role + state.

    Disclosure rules:
      - corp side, all states:        full info (their own workers)
      - contractor pre-approval:      internal_id, full_name, profession,
                                       origin_country, years_in_israel, languages
      - contractor post-approval:     full info except phone/visa/employee_number
      - admin: full info
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT contractor_id, corporation_id, status FROM deals WHERE id=%s AND deleted_at IS NULL",
                    (deal_id,))
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")

        cur.execute(
            """SELECT w.id, w.internal_id, w.first_name, w.last_name, w.profession_type,
                      w.experience_years, w.years_in_israel, w.origin_country, w.languages,
                      w.visa_type, w.visa_number, w.visa_valid_until,
                      w.notes, w.extra_fields
               FROM worker_db.workers w
               JOIN deal_workers dw ON dw.worker_id = w.id
               WHERE dw.deal_id=%s AND dw.removed_at IS NULL AND w.deleted_at IS NULL""",
            (deal_id,),
        )
        workers = cur.fetchall()

        is_corp        = x_user_role == "corporation" and x_org_id == deal["corporation_id"]
        is_contractor  = x_user_role == "contractor" and x_org_id == deal["contractor_id"]
        is_admin       = x_user_role == "admin"
        post_approval  = deal["status"] in DISCLOSED_STATES

        out = []
        for w in workers:
            if isinstance(w.get("languages"), str):
                import json
                try: w["languages"] = json.loads(w["languages"])
                except Exception: w["languages"] = []
            for f in ("visa_valid_until",):
                if hasattr(w.get(f), "isoformat"):
                    w[f] = w[f].isoformat()

            if is_admin or is_corp:
                out.append(w)
                continue
            if is_contractor:
                if post_approval:
                    # Strip employee_number from extra_fields, keep everything else
                    extra = w.get("extra_fields") or {}
                    if isinstance(extra, str):
                        import json
                        try: extra = json.loads(extra)
                        except Exception: extra = {}
                    extra = {k: v for k, v in extra.items() if k != "employee_number"}
                    w["extra_fields"] = extra
                    out.append({k: v for k, v in w.items()
                                if k not in ("visa_number", "visa_type", "notes")})
                else:
                    # Pre-approval: only the disclosure-rule fields
                    out.append({
                        "id":              w["id"],
                        "internal_id":     w["internal_id"],
                        "full_name":       f"{w['first_name']} {w['last_name']}".strip(),
                        "profession_type": w["profession_type"],
                        "origin_country":  w["origin_country"],
                        "years_in_israel": w["years_in_israel"],
                        "languages":       w["languages"],
                    })
                continue
        return out
    finally:
        conn.close()


@router.get("/{deal_id}")
def get_deal(
    deal_id: str,
    x_org_id: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT d.*,
                      (SELECT COUNT(*) FROM deal_workers dw
                       WHERE dw.deal_id=d.id AND dw.removed_at IS NULL) AS worker_count,
                      ws.profession_type,
                      ws.quantity AS requested_count,
                      COALESCE(pt.name_he, ws.profession_type) AS profession_he,
                      ws.region AS region_he,
                      ws.origin_preference AS requested_origins,
                      ws.min_experience AS requested_min_experience_months,
                      ws.start_date AS requested_start_date,
                      ws.end_date   AS requested_end_date
               FROM deals d
               LEFT JOIN job_db.worker_searches ws       ON ws.id = d.search_id
               LEFT JOIN worker_db.profession_types pt   ON pt.code = ws.profession_type
               WHERE d.id=%s AND d.deleted_at IS NULL""",
            (deal_id,),
        )
        deal = cur.fetchone()
        if not deal:
            raise HTTPException(status_code=404, detail="deal_not_found")
        return _filter_for_caller(_serialize_deal(deal), x_user_role or "", x_org_id)
    finally:
        conn.close()


@router.get("/contractors/{contractor_id}/deals")
def list_contractor_deals(contractor_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM deals WHERE contractor_id=%s AND deleted_at IS NULL ORDER BY created_at DESC",
            (contractor_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()


@router.get("/corporations/{corporation_id}/deals")
def list_corporation_deals(corporation_id: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM deals WHERE corporation_id=%s AND deleted_at IS NULL ORDER BY created_at DESC",
            (corporation_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()
# Wave 4 deploy probe — 2026-05-07T09:12:51Z
