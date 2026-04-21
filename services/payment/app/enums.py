"""Payment status enums."""
from enum import Enum


class PaymentStatus(str, Enum):
    # ── Pattern B (token + scheduled charge) — legacy, kept working ──────────
    PENDING_CHARGE      = "pending_charge"       # grace period — not yet charged
    CHARGED             = "charged"               # manually approved + charged
    CHARGED_AUTO        = "charged_auto"          # auto-charge after grace period
    CANCELLED_BY_CORP   = "cancelled_by_corp"     # corp cancelled during grace period
    CANCELLED_BY_ADMIN  = "cancelled_by_admin"    # admin cancelled
    CHARGE_FAILED       = "charge_failed"         # failed, retry pending
    CHARGE_FAILED_FINAL = "charge_failed_final"   # 3 failures — needs admin action
    ON_HOLD_ADMIN       = "on_hold_admin"         # blocked by discrepancy/dispute/admin
    REFUNDED            = "refunded"              # full or partial refund

    # ── Pattern A (J5 pre-authorization) ─────────────────────────────────────
    PENDING_AUTH          = "pending_auth"          # commit initiated, waiting for J5 to complete at Cardcom
    AUTHORIZED            = "authorized"            # J5 hold placed — inside grace window
    AUTH_FAILED           = "auth_failed"           # J5 declined by Cardcom / card issuer
    CAPTURED              = "captured"              # J5 captured = real charge, settled
    CAPTURE_FAILED        = "capture_failed"        # capture attempt failed; retry scheduled
    CAPTURE_FAILED_FINAL  = "capture_failed_final"  # max retries exhausted — needs admin
    VOIDED_BY_CORP        = "voided_by_corp"        # corp cancelled in grace → Cardcom void
    VOIDED_BY_ADMIN       = "voided_by_admin"       # admin cancelled → Cardcom void


class PaymentMethodStatus(str, Enum):
    ACTIVE   = "active"
    EXPIRED  = "expired"
    REMOVED  = "removed"
    FAILED   = "failed"


# Statuses where no further state transition is expected.
TERMINAL_STATUSES = {
    PaymentStatus.CHARGED,
    PaymentStatus.CHARGED_AUTO,
    PaymentStatus.CANCELLED_BY_CORP,
    PaymentStatus.CANCELLED_BY_ADMIN,
    PaymentStatus.CHARGE_FAILED_FINAL,
    PaymentStatus.REFUNDED,
    # Pattern A
    PaymentStatus.CAPTURED,
    PaymentStatus.CAPTURE_FAILED_FINAL,
    PaymentStatus.VOIDED_BY_CORP,
    PaymentStatus.VOIDED_BY_ADMIN,
    PaymentStatus.AUTH_FAILED,
}

# Statuses that guard a deal from being committed again (any active tx).
ACTIVE_STATUSES = {
    PaymentStatus.PENDING_CHARGE,
    PaymentStatus.CHARGE_FAILED,
    PaymentStatus.ON_HOLD_ADMIN,
    PaymentStatus.PENDING_AUTH,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CAPTURE_FAILED,
}
