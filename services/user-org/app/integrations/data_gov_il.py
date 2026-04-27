"""Live lookups against data.gov.il CKAN datasets, with a 7-day cache.

Two datasets are queried per business_number:
  pinkashakablanim  (פנקס הקבלנים)  — exposes EMAIL + MISPAR_TEL per contractor.
  ica_companies     (רשם החברות)    — exposes legal status (פעילה / מחוקה / ...).

Returns the raw rows so the caller can decide what to surface in the UI.
A failed network call (timeout, non-200) does not raise — it returns a
result with both `_found` flags False so the caller falls through to the
manual-approval lane without blocking the user.
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional, TypedDict

import httpx

from app.db import get_db

log = logging.getLogger(__name__)

CKAN_BASE = "https://data.gov.il/api/3/action/datastore_search"
PINKASH_RESOURCE_ID = "4eb61bd6-18cf-4e7c-9f9c-e166dfa0a2d8"
ICA_RESOURCE_ID = "f004176c-b85f-4542-8901-7b3176f9a054"

CACHE_TTL = timedelta(days=7)
HTTP_TIMEOUT_SECONDS = 3.0


class RegistryLookup(TypedDict):
    pinkash: Optional[dict[str, Any]]
    ica: Optional[dict[str, Any]]
    pinkash_found: bool
    ica_found: bool
    from_cache: bool
    fetched_at: datetime


def _read_cache(business_number: str) -> Optional[RegistryLookup]:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT pinkash_payload, ica_payload, pinkash_found, ica_found, fetched_at
               FROM gov_registry_cache WHERE business_number = %s""",
            (business_number,),
        )
        row = cur.fetchone()
        if not row:
            return None
        if row["fetched_at"] < datetime.utcnow() - CACHE_TTL:
            return None
        pinkash = row["pinkash_payload"]
        ica = row["ica_payload"]
        if isinstance(pinkash, str):
            pinkash = json.loads(pinkash)
        if isinstance(ica, str):
            ica = json.loads(ica)
        return RegistryLookup(
            pinkash=pinkash,
            ica=ica,
            pinkash_found=bool(row["pinkash_found"]),
            ica_found=bool(row["ica_found"]),
            from_cache=True,
            fetched_at=row["fetched_at"],
        )
    finally:
        conn.close()


def _write_cache(business_number: str, result: RegistryLookup) -> None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO gov_registry_cache
                 (business_number, pinkash_payload, ica_payload,
                  pinkash_found, ica_found, fetched_at)
               VALUES (%s, %s, %s, %s, %s, NOW())
               ON DUPLICATE KEY UPDATE
                 pinkash_payload = VALUES(pinkash_payload),
                 ica_payload     = VALUES(ica_payload),
                 pinkash_found   = VALUES(pinkash_found),
                 ica_found       = VALUES(ica_found),
                 fetched_at      = NOW()""",
            (
                business_number,
                json.dumps(result["pinkash"], ensure_ascii=False) if result["pinkash"] else None,
                json.dumps(result["ica"], ensure_ascii=False) if result["ica"] else None,
                result["pinkash_found"],
                result["ica_found"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


async def _query(client: httpx.AsyncClient, resource_id: str, filters: dict) -> Optional[dict]:
    try:
        resp = await client.get(
            CKAN_BASE,
            params={
                "resource_id": resource_id,
                "filters": json.dumps(filters, ensure_ascii=False),
                "limit": 1,
            },
        )
        resp.raise_for_status()
        body = resp.json()
        records = body.get("result", {}).get("records") or []
        return records[0] if records else None
    except (httpx.HTTPError, ValueError) as e:
        log.warning("data.gov.il query failed (resource=%s): %s", resource_id, e)
        return None


async def lookup(business_number: str) -> RegistryLookup:
    cached = _read_cache(business_number)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        pinkash = await _query(client, PINKASH_RESOURCE_ID, {"MISPAR_YESHUT": business_number})
        ica = await _query(client, ICA_RESOURCE_ID, {"מספר חברה": business_number})

    result = RegistryLookup(
        pinkash=pinkash,
        ica=ica,
        pinkash_found=pinkash is not None,
        ica_found=ica is not None,
        from_cache=False,
        fetched_at=datetime.utcnow(),
    )
    try:
        _write_cache(business_number, result)
    except Exception as e:
        log.warning("gov_registry_cache write failed for %s: %s", business_number, e)
    return result


def extract_pinkash_fields(pinkash: dict) -> dict:
    """Pull the fields we surface in the registration UI + write to contractors."""
    kvutza = (pinkash.get("KVUTZA") or "").strip() or None
    sivug_raw = pinkash.get("SIVUG")
    try:
        sivug = int(sivug_raw) if sivug_raw not in (None, "") else None
    except (ValueError, TypeError):
        sivug = None
    return {
        "kablan_number": str(pinkash.get("MISPAR_KABLAN") or "").strip() or None,
        "company_name_he": (pinkash.get("SHEM_YESHUT") or "").strip() or None,
        "kvutza": kvutza,
        "sivug": sivug,
        "gov_branch": (pinkash.get("TEUR_ANAF") or "").strip() or None,
        "email": (pinkash.get("EMAIL") or "").strip() or None,
        "phone": _normalize_phone(pinkash.get("MISPAR_TEL")),
    }


def extract_ica_fields(ica: dict) -> dict:
    return {
        "gov_company_status": (ica.get("סטטוס חברה") or "").strip() or None,
        "company_name_he": (ica.get("שם חברה") or "").strip() or None,
    }


def _normalize_phone(raw) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    digits = "".join(c for c in s if c.isdigit())
    if not digits:
        return None
    if digits.startswith("972"):
        digits = "0" + digits[3:]
    elif not digits.startswith("0"):
        digits = "0" + digits
    return digits


def is_company_active(ica: Optional[dict]) -> Optional[bool]:
    """True/False for known statuses; None when ica row is missing (sole prop case)."""
    if not ica:
        return None
    status = (ica.get("סטטוס חברה") or "").strip()
    if not status:
        return None
    return status == "פעילה"
