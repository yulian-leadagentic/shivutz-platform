"""Commission calculator — computes base amount, VAT, total for a deal.

Updated for the new deal lifecycle (migration 014):
  - workers_count comes from deal_workers join (the column was dropped)
  - commission rate comes from the CONTRACTOR's commission_per_worker_amount
    (charging side per the new model; falls back to the system default)
  - VAT comes from vat_periods (multi-period; lookup by today's date)
"""
from decimal import Decimal
from app.db import get_db
from app.services.vat_lookup import get_vat_for_date


class CommissionResult:
    def __init__(self, base_amount, vat_rate, vat_amount, total_amount,
                 workers_count, commission_per_worker):
        self.base_amount           = base_amount
        self.vat_rate              = vat_rate
        self.vat_amount            = vat_amount
        self.total_amount          = total_amount
        self.workers_count         = workers_count
        self.commission_per_worker = commission_per_worker

    def to_dict(self):
        return {
            "base_amount":            float(self.base_amount),
            "vat_rate":               float(self.vat_rate),
            "vat_amount":             float(self.vat_amount),
            "total_amount":           float(self.total_amount),
            "workers_count":          self.workers_count,
            "commission_per_worker":  float(self.commission_per_worker),
        }


def calculate(deal_id: str) -> CommissionResult:
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    try:
        deal_cur = deal_conn.cursor()
        deal_cur.execute(
            """SELECT contractor_id,
                      (SELECT COUNT(*) FROM deal_workers dw
                       WHERE dw.deal_id=d.id AND dw.removed_at IS NULL) AS worker_count
               FROM deals d WHERE d.id=%s AND d.deleted_at IS NULL""",
            (deal_id,),
        )
        deal = deal_cur.fetchone()
        if not deal:
            raise ValueError(f"Deal '{deal_id}' not found")

        corp_cur = org_conn.cursor()
        corp_cur.execute(
            "SELECT commission_per_worker_amount FROM contractors WHERE id=%s AND deleted_at IS NULL",
            (deal["contractor_id"],),
        )
        contractor = corp_cur.fetchone()
        commission_per_worker = Decimal(str((contractor or {}).get("commission_per_worker_amount") or 0))

        workers_count = int(deal["worker_count"] or 0)
        base_amount   = (commission_per_worker * workers_count).quantize(Decimal("0.01"))

        vat_rate   = get_vat_for_date()
        vat_amount = (base_amount * vat_rate).quantize(Decimal("0.01"))
        total      = (base_amount + vat_amount).quantize(Decimal("0.01"))

        return CommissionResult(
            base_amount=base_amount,
            vat_rate=vat_rate,
            vat_amount=vat_amount,
            total_amount=total,
            workers_count=workers_count,
            commission_per_worker=commission_per_worker,
        )
    finally:
        deal_conn.close()
        org_conn.close()
