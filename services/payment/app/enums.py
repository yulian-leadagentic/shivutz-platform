"""Payment status enums."""
from enum import Enum


class PaymentStatus(str, Enum):
    PENDING_CHARGE      = "pending_charge"       # grace period — not yet charged
    CHARGED             = "charged"               # manually approved + charged
    CHARGED_AUTO        = "charged_auto"          # auto-charge after grace period
    CANCELLED_BY_CORP   = "cancelled_by_corp"     # corp cancelled during grace period
    CANCELLED_BY_ADMIN  = "cancelled_by_admin"    # admin cancelled
    CHARGE_FAILED       = "charge_failed"         # failed, retry pending
    CHARGE_FAILED_FINAL = "charge_failed_final"   # 3 failures — needs admin action
    ON_HOLD_ADMIN       = "on_hold_admin"         # blocked by discrepancy/dispute/admin
    REFUNDED            = "refunded"              # full or partial refund


class PaymentMethodStatus(str, Enum):
    ACTIVE   = "active"
    EXPIRED  = "expired"
    REMOVED  = "removed"
    FAILED   = "failed"


TERMINAL_STATUSES = {
    PaymentStatus.CHARGED,
    PaymentStatus.CHARGED_AUTO,
    PaymentStatus.CANCELLED_BY_CORP,
    PaymentStatus.CANCELLED_BY_ADMIN,
    PaymentStatus.CHARGE_FAILED_FINAL,
    PaymentStatus.REFUNDED,
}
