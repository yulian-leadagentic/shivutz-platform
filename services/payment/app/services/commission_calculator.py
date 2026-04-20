"""Commission calculator — computes base amount, VAT, total for a deal."""
from decimal import Decimal
from app.db import get_db
from app.system_settings import get_setting


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
    """
    Calculate commission for a deal.
    commission_per_worker_amount  ← org_db.corporations
    workers_count                 ← deal_db.deals
    vat_rate                      ← payment_db.system_settings (snapshot at call time)
    """
    deal_conn = get_db("deal_db")
    org_conn  = get_db("org_db")
    try:
        deal_cur = deal_conn.cursor()
        deal_cur.execute(
            "SELECT corporation_id, workers_count FROM deals WHERE id=%s AND deleted_at IS NULL",
            (deal_id,)
        )
        deal = deal_cur.fetchone()
        if not deal:
            raise ValueError(f"Deal '{deal_id}' not found")

        corp_cur = org_conn.cursor()
        corp_cur.execute(
            "SELECT commission_per_worker_amount FROM corporations WHERE id=%s AND deleted_at IS NULL",
            (deal["corporation_id"],)
        )
        corp = corp_cur.fetchone()
        if not corp:
            raise ValueError(f"Corporation for deal '{deal_id}' not found")

        commission_per_worker = Decimal(str(corp["commission_per_worker_amount"] or 0))
        workers_count         = int(deal["workers_count"] or 0)
        base_amount           = (commission_per_worker * workers_count).quantize(Decimal("0.01"))

        vat_rate   = Decimal(str(get_setting("vat_rate", 0.18)))
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
