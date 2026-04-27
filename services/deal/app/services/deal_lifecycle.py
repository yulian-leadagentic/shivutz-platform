"""
Legacy stub — the old report-based deal lifecycle was replaced by the
explicit endpoint-driven lifecycle in routes/deals.py (commit, approve,
reject, cancel, replace_worker).

The two functions below are kept as no-ops so older imports
(routes/reports.py) don't break — they will never trigger a state change
under the new model. Remove once reports.py is retired.
"""


def transition(deal_id: str, new_status: str, performed_by: str):
    raise RuntimeError(
        "deal_lifecycle.transition is deprecated; use the explicit lifecycle endpoints "
        "in routes/deals.py (commit/approve/reject/cancel/replace_worker)."
    )


def check_discrepancy(deal_id: str):
    """No-op — discrepancy reporting was removed from the deal model."""
    return False
