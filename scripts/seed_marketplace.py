#!/usr/bin/env python3
"""U2 · seed marketplace_listings with 16 demo rows.

/marketplace is public since U1 §3. The catalogue was empty so the
click-through landed on the empty state. This script seeds ~16
demo listings across the four active categories (housing / equipment
/ services / other) plus two `subcategory` slices under services
(transport + insurance).

All demo listings are marked is_seed=TRUE. Cleanup:
  DELETE FROM marketplace_listings WHERE is_seed = TRUE;

Guardrails baked into the payload set (U2 spec §0.1 + §0.2):
  · Company names are invented — no real Israeli business.
  · Phones are +9720000-XXXX (Israeli unallocated range) so a real
    contractor dialling one never reaches a real business.
  · contact_name is a role (מוקד הזמנות, מחלקת שירות) — no personal
    names.
  · Regulated categories (insurance) don't quote licence / broker /
    insurer names — service description only.
  · images_json stays NULL (U2 forbids pulling images off the web).
    ListingCard renders a color header bar when images are absent
    (services/frontend/src/components/marketplace/ListingCard.tsx:53).

Idempotency: each row's UUID is derived from a stable synthetic key
(corp_id + title) via hashlib.md5, and the INSERT uses
ON DUPLICATE KEY UPDATE to re-run cleanly. Running twice does not
double the row count.

Corporations: spreads across the corps flagged is_seed=TRUE in
org_db.corporations. If fewer than 2 are found, the script prints a
warning and continues on whatever's available — but 3+ is preferred
for a natural-looking distribution.

Usage inside the staging container:
  railway ssh --service user-org 'python3 /scripts/seed_marketplace.py'
"""
from __future__ import annotations
import hashlib
import json
import os
import sys
import uuid
from datetime import date, timedelta
from typing import List, Optional

import pymysql


# ─── The seed set ───────────────────────────────────────────────

# Field order: (title, description, city, region, category,
#               subcategory, price, price_unit, capacity,
#               is_furnished, available_offset_days, contact_role)
#
# Region codes follow the platform's region enum (center, sharon,
# south, north, jerusalem). Categories match marketplace_categories
# codes verified live in DB before seeding.

LISTINGS = [
    # ── דיור · 4 ────────────────────────────────────────────────
    ("דירת 4 חדרים מרוהטת לעובדים",
     "דירה שמורה במרכז העיר, מרוהטת מלאה, כניסה נפרדת לעובדים ומקלחת גדולה. מתאים לצוות שגרתי של קבלן ראשי.",
     "פתח תקווה", "center", "housing", None, 900, "per_month", 8, True, 0, "מוקד הזמנות"),
    ("מתחם מגורים — 3 דירות סמוכות",
     "שלוש דירות בבניין אחד, קרוב לתחנת רכבת ומכולת שכונתית. אפשרות להשכיר ביחד או בנפרד.",
     "אשדוד", "south", "housing", None, 800, "per_month", 24, False, 14, "מחלקת השכרות"),
    ("דירה מרוהטת ליד אזור התעשייה",
     "מרחק הליכה מאזור הבנייה. מרוהטת, מזגן בכל חדר, כיריים חדשות. חשבונות כלולים בעלות.",
     "חיפה", "north", "housing", None, 850, "per_month", 6, True, 7, "מוקד הזמנות"),
    ("חדרים במבנה מגורים מוסדר",
     "מבנה נקי ותקין, שירותים ומקלחות משותפות, מטבחון בכל קומה. אישור אכלוס עדכני.",
     "נתניה", "sharon", "housing", None, 750, "per_month", 12, False, 21, "מחלקת שירות"),

    # ── הסעות · 4 (category='services', subcategory='transport') ──
    ("הסעות יומיות לאתרי בנייה — מיניבוס 20 מקומות",
     "שירות בוקר וערב מהמגורים לאתרים במרכז. נהג קבוע, ביטוח מלא ליוסעים, גמישות בשעות.",
     None, "center", "services", "transport", 3200, "per_month", 20, None, 0, "מוקד הסעות"),
    ("הסעת עובדים בוקר וערב, קו קבוע",
     "קו קבוע השרון–אזור התעשייה. עצירות מוגדרות, GPS למעקב. חוזה חודשי בלבד.",
     None, "sharon", "services", "transport", 2400, "per_month", 14, None, 3, "מוקד הסעות"),
    ("שירות הסעות גמיש לפי דרישה",
     "הזמנה בהתראה של 12 שעות. מתאים לפרויקטים קצרים או משמרות לא סדירות. תמחור לפי יום.",
     None, "south", "services", "transport", 450, "fixed", 16, None, 0, "מוקד הזמנות"),
    ("הסעות לאתרים מרוחקים, כולל סופ״ש",
     "מסלולים ארוכים לפרויקטים בגליל ובעמקים. אפשרות ללינה של הנהג באתר. הזמנה מראש.",
     None, "north", "services", "transport", 3800, "per_month", 20, None, 10, "מחלקת שירות"),

    # ── ביטוח · 3 (category='services', subcategory='insurance') ──
    ("ביטוח רפואי לעובדים זרים — כיסוי מלא",
     "כיסוי לאשפוזים, ניתוחים ובדיקות שגרתיות. תעריף לעובד לחודש, ללא מינימום גודל צוות.",
     None, None, "services", "insurance", 180, "per_month", None, None, 0, "מוקד שירות"),
    ("ביטוח תאונות עבודה וצד ג׳",
     "מותאם לצוותי בנייה. כולל אחריות מקצועית כלפי מזמיני עבודה. חבילה חודשית פר עובד.",
     None, None, "services", "insurance", 240, "per_month", None, None, 0, "מוקד הזמנות"),
    ("חבילת ביטוח משולבת לתאגידים",
     "חבילה שמאחדת ביטוח רפואי, תאונות עבודה, וצד ג׳. חסכון של עד 20% מול חבילות נפרדות.",
     None, None, "services", "insurance", 390, "per_month", None, None, 0, "מחלקת מכירות"),

    # ── ציוד · 3 ────────────────────────────────────────────────
    ("פיגומים להשכרה — מערכת מודולרית",
     "פיגומים בטוחים ומותאמים לגבהים משתנים. הובלה מהמחסן והחזרה כלולות בעלות היומית.",
     "רמלה", "center", "equipment", None, 220, "fixed", None, None, 0, "מחסן ראשי"),
    ("כלי עבודה חשמליים — השכרה חודשית",
     "מקדחות, מנסרות, מכונות שיוף. כל הכלים מכוילים ובבדיקה תקופתית. תיק שירות נלווה.",
     "אשדוד", "south", "equipment", None, 850, "per_month", None, None, 0, "מוקד השכרות"),
    ("ציוד מגן ובטיחות — חבילה חודשית",
     "קסדות, נעלי בטיחות, אפודות זוהרות, אוזניות. חבילה מוזמנת מראש לפי גודל הצוות.",
     "חדרה", "sharon", "equipment", None, 65, "per_month", None, None, 0, "מוקד הזמנות"),

    # ── אחר · 2 ────────────────────────────────────────────────
    ("קורס בטיחות בגובה — הסמכה תקפה",
     "קורס בן יום עסקים, כולל תעודה. מתאים לעובדים חדשים או להסמכה שנתית. הכשרה בסיסית.",
     None, None, "other", None, 350, "fixed", None, None, 0, "רכז הכשרות"),
    ("קורס עברית בסיסית לעובדים",
     "שבועיים אחר-הצהריים, קבוצות של עד 12. דגש על אוצר מילים לאתר בנייה ותקשורת עם המנהל.",
     None, None, "other", None, 950, "fixed", None, None, 0, "מוקד הרשמה"),
]


# ─── Helpers ────────────────────────────────────────────────────

def _connect(db_name: str) -> pymysql.Connection:
    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ["MYSQL_ROOT_PASSWORD"],
        database=db_name,
        charset="utf8mb4",
        autocommit=True,
    )


def _stable_uuid(corp_id: str, title: str) -> str:
    """Deterministic UUID per (corp_id, title). Rerunning the seeder
    hits the same id → ON DUPLICATE KEY UPDATE rather than a fresh
    row, keeping the run idempotent."""
    h = hashlib.md5(f"u2-seed|{corp_id}|{title}".encode("utf-8")).hexdigest()
    # Format as 8-4-4-4-12
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def _phones() -> List[str]:
    """+9720000-XXXX unallocated range, one per listing so each demo
    has a distinct number in the UI without any of them ringing a
    real business."""
    return [f"+9720000{i:04d}" for i in range(101, 101 + len(LISTINGS))]


def _pick_seed_corps() -> List[str]:
    org = _connect("org_db")
    try:
        cur = org.cursor()
        cur.execute(
            """SELECT id FROM corporations
                WHERE is_seed=1 AND deleted_at IS NULL
                  AND approval_status='approved'
                ORDER BY created_at"""
        )
        rows = cur.fetchall()
        return [r[0] for r in rows]
    finally:
        org.close()


def _ensure_min_corps(min_corps: int = 2) -> List[str]:
    """Returns is_seed=TRUE approved corp ids. If fewer than
    min_corps exist, this is a hard error — the spec's §2.1 rule
    says listings must spread across multiple corps."""
    ids = _pick_seed_corps()
    if len(ids) < min_corps:
        # A single-corp fallback isn't in the spec but running against
        # exactly one corp is a distinctness signal we should surface
        # loudly rather than silently attributing 16 rows to one corp.
        print(
            f"[u2-seed] only {len(ids)} is_seed=TRUE approved corp(s) — "
            f"spec §2.1 wants ≥ {min_corps} for a natural distribution. "
            "Mark more corps with scripts/mark_seed_entities.py or by "
            "flipping is_seed=1 directly, then rerun.",
            file=sys.stderr,
        )
        if not ids:
            sys.exit(2)
    return ids


def _spread_corps(corp_ids: List[str], n: int) -> List[str]:
    """Round-robin over available corps so no single corp owns > ~ceil(n/k)."""
    if not corp_ids:
        raise RuntimeError("no seed corps to attribute listings to")
    return [corp_ids[i % len(corp_ids)] for i in range(n)]


def _dedupe_category_codes(org: pymysql.Connection) -> set:
    cur = org.cursor()
    cur.execute("SELECT code FROM marketplace_categories WHERE is_active=1")
    return {r[0] for r in cur.fetchall()}


# ─── main ───────────────────────────────────────────────────────

def main() -> int:
    corp_ids = _ensure_min_corps(min_corps=2)
    attribution = _spread_corps(corp_ids, len(LISTINGS))
    phones = _phones()

    org = _connect("org_db")
    try:
        # Sanity — every category we're seeding must be active.
        active_cats = _dedupe_category_codes(org)
        used_cats = {row[4] for row in LISTINGS}
        missing = used_cats - active_cats
        if missing:
            print(
                f"[u2-seed] FATAL: LISTINGS uses categories {missing} that "
                f"are not is_active=1 in marketplace_categories. Live active "
                f"set: {sorted(active_cats)}. Update LISTINGS or activate the "
                "missing codes before running.",
                file=sys.stderr,
            )
            return 2

        cur = org.cursor()
        n_inserted = 0
        n_updated = 0
        today = date.today()

        for i, (title, desc, city, region, category, subcategory,
                price, price_unit, capacity, is_furnished,
                offset_days, contact_role) in enumerate(LISTINGS):
            corp_id = attribution[i]
            listing_id = _stable_uuid(corp_id, title)
            phone = phones[i]
            available_from = today + timedelta(days=offset_days)

            # ON DUPLICATE KEY UPDATE keys on PRIMARY KEY (id) → the
            # deterministic id means a rerun updates the same row
            # in-place. Non-mutable fields (id, corp_id, is_seed)
            # aren't in the UPDATE clause.
            cur.execute(
                """INSERT INTO marketplace_listings
                     (id, corporation_id, subscription_id,
                      advertiser_entity_type, advertiser_entity_id,
                      category, subcategory, title, description,
                      city, region, price, price_unit, capacity,
                      is_furnished, available_from,
                      status, is_seed, contact_phone, contact_name,
                      images_json)
                   VALUES (%s, %s, NULL, 'corporation', %s,
                           %s, %s, %s, %s,
                           %s, %s, %s, %s, %s,
                           %s, %s,
                           'active', 1, %s, %s,
                           NULL)
                   ON DUPLICATE KEY UPDATE
                     subcategory=VALUES(subcategory),
                     title=VALUES(title),
                     description=VALUES(description),
                     city=VALUES(city),
                     region=VALUES(region),
                     price=VALUES(price),
                     price_unit=VALUES(price_unit),
                     capacity=VALUES(capacity),
                     is_furnished=VALUES(is_furnished),
                     available_from=VALUES(available_from),
                     status=VALUES(status),
                     contact_phone=VALUES(contact_phone),
                     contact_name=VALUES(contact_name),
                     images_json=VALUES(images_json)""",
                (
                    listing_id, corp_id, corp_id,
                    category, subcategory, title, desc,
                    city, region, price, price_unit, capacity,
                    is_furnished, available_from,
                    phone, contact_role,
                ),
            )
            if cur.rowcount == 1:
                n_inserted += 1
            elif cur.rowcount == 2:   # MySQL: 2 = row updated
                n_updated += 1

        print(f"[u2-seed] done — inserted {n_inserted}, updated {n_updated}, "
              f"across {len(corp_ids)} corp(s).")

        # Post-run stats — pipe into the U2 report table.
        cur.execute(
            """SELECT category, IFNULL(subcategory,''), COUNT(*)
                 FROM marketplace_listings
                WHERE is_seed=1 AND deleted_at IS NULL
                GROUP BY category, subcategory
                ORDER BY category, subcategory"""
        )
        print("[u2-seed] category × subcategory breakdown:")
        for row in cur.fetchall():
            cat, sub, n = row
            print(f"  {cat:<12} {sub:<12} {n}")

        cur.execute(
            """SELECT c.company_name_he, COUNT(*) AS n
                 FROM marketplace_listings ml
                 LEFT JOIN corporations c ON ml.corporation_id = c.id
                WHERE ml.is_seed=1 AND ml.deleted_at IS NULL
                GROUP BY ml.corporation_id
                ORDER BY n DESC"""
        )
        print("[u2-seed] listings per seed corp:")
        for row in cur.fetchall():
            print(f"  {row[0]:<40} {row[1]}")

        # Guardrail check — phones must all be in the unallocated range.
        cur.execute(
            """SELECT COUNT(*) FROM marketplace_listings
                WHERE is_seed=1 AND contact_phone NOT LIKE '+9720000%'"""
        )
        n_bad_phones = cur.fetchone()[0]
        if n_bad_phones:
            print(f"[u2-seed] FATAL: {n_bad_phones} seed rows with unexpected "
                  "phone prefix — should be impossible with this script; "
                  "someone changed the seed set without updating _phones().",
                  file=sys.stderr)
            return 1

        return 0
    finally:
        org.close()


if __name__ == "__main__":
    sys.exit(main())
