"""R34 4c · the fields a category asks, and a listing's answers.

Three layers: the validator on its own, the five schemas migration 102
seeds (read from the migration file itself, so the test and the data
cannot drift), and the two routes that store the answers.
"""
import json
import re
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from app.routes import marketplace, provider_stats, search
from app.routes.marketplace import ListingCreate, ListingUpdate, create_listing, update_listing
from app.routes.test_provider_plans import CORP, PROVIDER, Cursor, _conn
from app.services import listing_attributes as la
from app.services.listing_attributes import (
    FIELD_TYPES, REGION_MATCH_SQL, attribute_view, card_price, parse_schema,
    single_region, validate_attributes, validate_regions,
)

MIGRATION = Path(__file__).resolve().parents[4] / "db" / "migrations" / "102_r37_listing_attributes.sql"

SCHEMA = {
    "fields": [
        {"key": "name", "label": "שם", "type": "text", "required": True},
        {"key": "seats", "label": "מקומות", "type": "int"},
        {"key": "kind", "label": "סוג", "type": "select", "options": ["א", "ב"]},
        {"key": "tags", "label": "תגיות", "type": "multi", "options": ["x", "y", "z"]},
        {"key": "night", "label": "לילה", "type": "bool"},
        {"key": "when", "label": "מתי", "type": "date"},
        {"key": "price", "label": "מחיר", "type": "money"},
        {"key": "price_unit", "label": "יחידה", "type": "select", "options": ["ליום", "לחודש"]},
        {"key": "p_day", "label": "ליום", "type": "money"},
        {"key": "p_week", "label": "לשבוע", "type": "money"},
    ],
    "require_any": [["p_day", "p_week"]],
    "price": {"amount": "price", "unit": "price_unit"},
}
OK = {"name": "הסעות", "p_day": 100}


def errors_of(attributes, schema=SCHEMA):
    with unittest.TestCase().assertRaises(HTTPException) as ctx:
        validate_attributes(schema, attributes)
    assert ctx.exception.status_code == 400 and ctx.exception.detail["code"] == "invalid_attributes"
    return ctx.exception.detail["fields"]


class ValidateTest(unittest.TestCase):
    def test_good_answers_are_stored_as_given(self):
        clean = validate_attributes(SCHEMA, {**OK, "seats": 19, "kind": "ב", "night": False, "when": "2026-12-01",
                                             "price": 250.5, "price_unit": "ליום"})
        self.assertEqual(clean, {"name": "הסעות", "seats": 19, "kind": "ב", "night": False, "when": "2026-12-01",
                                 "price": 250.5, "price_unit": "ליום", "p_day": 100})

    def test_an_unknown_key_is_rejected(self):
        self.assertEqual(errors_of({**OK, "is_admin": True}), {"is_admin": "שדה לא מוכר בקטגוריה זו"})

    def test_a_category_with_no_schema_takes_no_attributes(self):
        self.assertEqual(validate_attributes(None, None), {})
        self.assertEqual(validate_attributes(None, {}), {})
        self.assertIn("anything", errors_of({"anything": 1}, schema=None))

    def test_attributes_must_be_an_object(self):
        for bad in ([], "x", 3):
            with self.assertRaises(HTTPException) as ctx:
                validate_attributes(SCHEMA, bad)
            self.assertEqual(ctx.exception.status_code, 400)

    def test_empty_answers_are_not_stored_and_false_is_an_answer(self):
        clean = validate_attributes(SCHEMA, {**OK, "seats": None, "kind": "", "tags": [], "night": False})
        self.assertEqual(clean, {"name": "הסעות", "night": False, "p_day": 100})

    def test_required(self):
        self.assertEqual(errors_of({"p_day": 1}), {"name": "שדה חובה"})
        self.assertEqual(errors_of({"name": "   ", "p_day": 1}), {"name": "שדה חובה"})

    def test_at_least_one_of_a_group(self):
        errs = errors_of({"name": "x"})
        self.assertEqual(set(errs), {"p_day", "p_week"})
        self.assertIn("לפחות אחד", errs["p_day"])
        self.assertEqual(validate_attributes(SCHEMA, {"name": "x", "p_week": 5}), {"name": "x", "p_week": 5})

    def test_types(self):
        for key, bad in (("seats", "19"), ("seats", 1.5), ("seats", True), ("seats", -1),
                         ("kind", "ג"), ("kind", ["א"]), ("tags", "x"), ("tags", ["x", "q"]), ("tags", [1]),
                         ("night", "true"), ("night", 1), ("when", "01/12/2026"), ("when", "2026-13-01"),
                         ("price", "100"), ("price", -5), ("price", True), ("price", 10.555),
                         ("name", 5), ("name", "x" * 201)):
            errs = errors_of({**OK, "price_unit": "ליום", "price": 1, key: bad})
            self.assertIn(key, errs, (key, bad))

    def test_multi_keeps_the_schemas_order_once_each(self):
        self.assertEqual(validate_attributes(SCHEMA, {**OK, "tags": ["z", "x", "z"]})["tags"], ["x", "z"])

    def test_money_is_a_whole_number_when_it_is_one(self):
        clean = validate_attributes(SCHEMA, {**OK, "p_day": 100.0, "p_week": Decimal("99.90")})
        self.assertEqual((clean["p_day"], clean["p_week"]), (100, 99.9))
        self.assertIsInstance(clean["p_day"], int)

    def test_a_price_and_its_unit_go_together(self):
        self.assertEqual(errors_of({**OK, "price": 100}), {"price_unit": "יש למלא מחיר ויחידת מחיר יחד"})
        self.assertEqual(errors_of({**OK, "price_unit": "ליום"}), {"price": "יש למלא מחיר ויחידת מחיר יחד"})


class CardPriceAndViewTest(unittest.TestCase):
    def test_amount_and_unit(self):
        self.assertEqual(card_price(SCHEMA, {"price": 250, "price_unit": "ליום"}), (250, "ליום"))
        self.assertEqual(card_price(SCHEMA, {}), (None, None))

    def test_first_of_several_prices(self):
        schema = {"fields": [], "price": {"first_of": [["a", "ליום"], ["b", "לשבוע"]]}}
        self.assertEqual(card_price(schema, {"b": 700}), (700, "לשבוע"))
        self.assertEqual(card_price(schema, {"a": 120, "b": 700}), (120, "ליום"))

    def test_a_category_that_quotes(self):
        self.assertEqual(card_price({"fields": [], "price": {"note": "הצעת מחיר"}}, {}), (None, "הצעת מחיר"))

    def test_view_is_in_schema_order_with_schema_labels(self):
        view = attribute_view(SCHEMA, json.dumps({"night": False, "seats": 4, "name": "x", "gone": 1}))
        self.assertEqual([(v["key"], v["label"], v["value"]) for v in view],
                         [("name", "שם", "x"), ("seats", "מקומות", 4), ("night", "לילה", False)])
        self.assertEqual(attribute_view(None, {"a": 1}), [])
        self.assertEqual(attribute_view(SCHEMA, None), [])

    def test_view_leaves_the_card_price_to_the_price_line(self):
        view = attribute_view(SCHEMA, {"name": "x", "price": 250, "price_unit": "ליום", "p_day": 90})
        self.assertEqual([v["key"] for v in view], ["name", "p_day"])

    def test_parse_schema(self):
        self.assertEqual(parse_schema(json.dumps(SCHEMA)), SCHEMA)
        for nothing in (None, "", "not json", "[]", json.dumps({"fields": "x"})):
            self.assertIsNone(parse_schema(nothing))


class RegionsTest(unittest.TestCase):
    def test_stored_form(self):
        self.assertIsNone(validate_regions(None))
        self.assertIsNone(validate_regions([]))
        self.assertEqual(validate_regions(["south", "center", "south"]), ["center", "south"])
        self.assertEqual(validate_regions(["center", "national"]), ["national"])

    def test_a_code_no_search_can_ask_for_is_refused(self):
        for bad in (["sharon"], ["center", 5], "center"):
            with self.assertRaises(HTTPException) as ctx:
                validate_regions(bad)
            self.assertEqual(ctx.exception.detail["code"], "invalid_regions")

    def test_the_single_value_column(self):
        self.assertEqual(single_region(["north"]), "north")
        self.assertEqual(single_region(["national"]), "national")
        self.assertIsNone(single_region(["center", "north"]))
        self.assertIsNone(single_region(None))

    def test_the_search_and_the_listings_page_share_one_predicate(self):
        self.assertEqual(REGION_MATCH_SQL.count("%s"), 2)
        self.assertIn("JSON_CONTAINS(ml.regions, JSON_QUOTE(%s))", REGION_MATCH_SQL)
        self.assertIn("ml.region = 'national'", REGION_MATCH_SQL)
        for module in (search, marketplace):
            source = Path(module.__file__).read_text(encoding="utf8")
            self.assertIn("conditions.append(REGION_MATCH_SQL)", source)
            self.assertIn("params.extend([region, region])", source)
            self.assertNotIn('"(ml.region = %s OR ml.region IS NULL)"', source)
            self.assertNotIn('conditions.append("ml.region = %s")', source)

    def test_demand_scope_reads_every_region_a_listing_serves(self):
        listings = [
            {"status": "active", "category": "transport", "region": None, "regions": json.dumps(["center", "north"])},
            {"status": "active", "category": "transport", "region": "south", "regions": None},
            {"status": "active", "category": "courses", "region": None, "regions": '["national"]'},
            {"status": "active", "category": "insurance", "region": None, "regions": None},
            {"status": "paused", "category": "equipment", "region": "south", "regions": None},
        ]
        scope, source = provider_stats.demand_scope(listings, None)
        self.assertEqual(source, "listings")
        self.assertEqual(scope, {"transport": {"center", "north", "south"}, "courses": None, "insurance": None})


SPEC_KEYS = {
    "transport": ["vehicle_types", "max_passengers", "service_type", "nights_weekends", "licensed", "price_from", "price_unit"],
    "insurance": ["insurance_types", "insurers", "agent_license_no", "service_languages"],
    "equipment": ["equipment_type", "deal_type", "delivery", "delivery_fee", "with_operator",
                  "certified_operator_required", "price_day", "price_week", "price_month"],
    "scaffolding": ["scaffold_types", "services", "licensed_installer", "engineer_supervision", "insured",
                    "price", "price_unit", "delivery_fee"],
    "courses": ["course_type", "certifying_body", "duration", "languages", "delivery_mode",
                "certificate_validity_months", "next_date", "price", "price_unit"],
}


def seeded_schemas():
    text = MIGRATION.read_text(encoding="utf8")
    found = re.findall(r"SET field_schema = '(\{.*?\})'\s+WHERE code = '(\w+)' AND field_schema IS NULL;", text, re.S)
    return {code: json.loads(blob) for blob, code in found}


@unittest.skipUnless(MIGRATION.exists(), "migration 102 is not on this path")
class SeededSchemasTest(unittest.TestCase):
    def setUp(self):
        self.schemas = seeded_schemas()

    def test_the_five_provider_categories_and_only_they(self):
        self.assertEqual(sorted(self.schemas), sorted(SPEC_KEYS))

    def test_each_asks_exactly_what_the_list_says(self):
        for code, keys in SPEC_KEYS.items():
            self.assertEqual([f["key"] for f in self.schemas[code]["fields"]], keys, code)

    def test_every_field_is_well_formed(self):
        for code, schema in self.schemas.items():
            keys = [f["key"] for f in schema["fields"]]
            self.assertEqual(len(keys), len(set(keys)), code)
            for f in schema["fields"]:
                self.assertIn(f["type"], FIELD_TYPES, (code, f["key"]))
                self.assertTrue(f["label"].strip(), (code, f["key"]))
                if f["type"] in ("select", "multi"):
                    self.assertGreaterEqual(len(f["options"]), 2, (code, f["key"]))
                    self.assertEqual(len(f["options"]), len(set(f["options"])), (code, f["key"]))
                else:
                    self.assertNotIn("options", f, (code, f["key"]))
                if "show_if" in f:
                    self.assertIn(f["show_if"], keys, (code, f["key"]))
            for group in schema.get("require_any", []):
                self.assertTrue(set(group) <= set(keys), code)
            price = schema.get("price", {})
            for key in [price.get("amount"), price.get("unit")] + [k for k, _ in price.get("first_of", [])]:
                if key:
                    self.assertIn(key, keys, code)

    def test_the_price_rules_of_the_list(self):
        s = self.schemas
        self.assertEqual(s["equipment"]["require_any"], [["price_day", "price_week", "price_month"]])
        self.assertEqual(s["insurance"]["price"], {"note": "הצעת מחיר"})
        self.assertEqual(s["transport"]["price"], {"amount": "price_from", "unit": "price_unit"})
        units = {code: next(f["options"] for f in s[code]["fields"] if f["key"] == "price_unit")
                 for code in ("transport", "scaffolding", "courses")}
        self.assertEqual(units, {"transport": ["לנסיעה", "ליום", "לחודש"],
                                 "scaffolding": ["ליחידה לחודש", "למ״ר לחודש"],
                                 "courses": ["למשתתף", "לקבוצה"]})

    def test_nothing_is_required_that_the_list_does_not_require(self):
        for code, schema in self.schemas.items():
            self.assertEqual([f["key"] for f in schema["fields"] if f.get("required")], [], code)
        self.assertEqual([c for c, s in self.schemas.items() if s.get("require_any")], ["equipment"])

    def test_a_filled_form_of_each_category_validates(self):
        samples = {
            "transport": {"vehicle_types": ["אוטובוס"], "max_passengers": 50, "nights_weekends": True,
                          "price_from": 450, "price_unit": "לנסיעה"},
            "insurance": {"insurance_types": ["חבות מעבידים", "צד ג׳"], "insurers": "לפי בקשה", "service_languages": ["רוסית"]},
            "equipment": {"equipment_type": "גנרטורים", "deal_type": ["השכרה"], "delivery": True, "delivery_fee": 150,
                          "price_week": 900},
            "scaffolding": {"scaffold_types": ["פיגום נייד"], "insured": True, "price": 35, "price_unit": "למ״ר לחודש"},
            "courses": {"course_type": "עבודה בגובה", "languages": ["עברית", "סינית"], "delivery_mode": ["באתר הלקוח"],
                        "certificate_validity_months": 24, "next_date": "2026-12-14", "price": 350, "price_unit": "למשתתף"},
        }
        prices = {"transport": (450, "לנסיעה"), "insurance": (None, "הצעת מחיר"), "equipment": (900, "לשבוע"),
                  "scaffolding": (35, "למ״ר לחודש"), "courses": (350, "למשתתף")}
        for code, sample in samples.items():
            clean = validate_attributes(self.schemas[code], sample)
            self.assertEqual(clean, sample, code)
            self.assertEqual(card_price(self.schemas[code], clean), prices[code], code)
            price = self.schemas[code]["price"]
            in_price_line = len({price.get("amount"), price.get("unit")} & set(sample))
            self.assertEqual(len(attribute_view(self.schemas[code], clean)), len(sample) - in_price_line, code)

    def test_equipment_needs_one_of_its_three_prices(self):
        errs = errors_of({"equipment_type": "מלגזות"}, schema=self.schemas["equipment"])
        self.assertEqual(set(errs), {"price_day", "price_week", "price_month"})

    def test_no_em_dash_anywhere_in_the_migration(self):
        self.assertNotIn("—", MIGRATION.read_text(encoding="utf8"))


TRANSPORT = {
    "fields": [
        {"key": "max_passengers", "label": "מספר נוסעים מקסימלי", "type": "int"},
        {"key": "price_from", "label": "מחיר החל מ", "type": "money"},
        {"key": "price_unit", "label": "יחידת מחיר", "type": "select", "options": ["לנסיעה", "ליום"]},
    ],
    "price": {"amount": "price_from", "unit": "price_unit"},
}


def _create_rules(schema=TRANSPORT, plan=True):
    return [
        ("SELECT field_schema FROM marketplace_categories", [{"field_schema": json.dumps(schema) if schema else None}]),
        ("FROM marketplace_subscriptions", [{"id": "sub-1", "slot_count": 5}] if plan else []),
        ("SELECT COUNT(*) AS n FROM marketplace_listings", [{"n": 0}]),
        ("INSERT INTO marketplace_listings", []),
    ]


class CreateWithAttributesTest(unittest.TestCase):
    def _post(self, cursor, body, **headers):
        self.conn = _conn(cursor)
        with mock.patch.object(marketplace, "get_db", return_value=self.conn):
            # R38 3a · a provider names who the listing is for.
            if headers.get("x_entity_type") == "service_provider":
                body = {"audience": "both", **body}
            return create_listing(ListingCreate(**body), **headers)

    def test_answers_regions_and_the_card_price_are_stored(self):
        cur = Cursor(_create_rules())
        self._post(cur, {"category": "transport", "title": "הסעות", "regions": ["north", "center"],
                         "attributes": {"max_passengers": 19, "price_from": 450, "price_unit": "לנסיעה"}}, **PROVIDER)
        sql, params = cur.ran("INSERT INTO marketplace_listings")[0]
        self.assertIn("attributes, regions, audience)", sql)
        self.assertEqual(json.loads(params[-3]), {"max_passengers": 19, "price_from": 450, "price_unit": "לנסיעה"})
        self.assertEqual(json.loads(params[-2]), ["center", "north"])
        self.assertEqual(params[-1], "both")
        # city, region, price, price_unit: two regions leave the single column empty
        self.assertEqual(params[9:13], (None, None, 450, "לנסיעה"))

    def test_one_region_also_fills_the_single_column(self):
        cur = Cursor(_create_rules())
        self._post(cur, {"category": "transport", "title": "הסעות", "regions": ["national"]}, **PROVIDER)
        _, params = cur.ran("INSERT INTO marketplace_listings")[0]
        self.assertEqual((params[10], json.loads(params[-2]), params[-3]), ("national", ["national"], None))

    def test_a_wrong_answer_is_refused_before_the_plan_is_looked_at(self):
        cur = Cursor(_create_rules(plan=False))
        with self.assertRaises(HTTPException) as ctx:
            self._post(cur, {"category": "transport", "title": "הסעות", "attributes": {"max_passengers": "many"}}, **PROVIDER)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail["code"], "invalid_attributes")
        self.assertEqual(list(ctx.exception.detail["fields"]), ["max_passengers"])
        self.assertEqual(cur.ran("FROM marketplace_subscriptions"), [])
        self.assertEqual(cur.ran("INSERT"), [])

    def test_an_unknown_key_and_an_unknown_region_are_refused(self):
        for body in ({"attributes": {"vip": True}}, {"regions": ["sharon"]}):
            cur = Cursor(_create_rules())
            with self.assertRaises(HTTPException) as ctx:
                self._post(cur, {"category": "transport", "title": "הסעות", **body}, **PROVIDER)
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertEqual(cur.ran("INSERT"), [])

    def test_corporation_housing_is_stored_as_it_always_was(self):
        cur = Cursor(_create_rules(schema=None))
        self._post(cur, {"category": "housing", "title": "דירה", "city": "נתניה", "region": "center",
                         "price": 3500, "price_unit": "per_month"}, **CORP)
        _, params = cur.ran("INSERT INTO marketplace_listings")[0]
        self.assertEqual(params[9:13], ("נתניה", "center", Decimal("3500"), "per_month"))
        self.assertEqual(params[-3:], (None, None, "both"))   # corporation housing defaults to both
        self.assertEqual(cur.ran("FROM marketplace_subscriptions"), [])


class UpdateWithAttributesTest(unittest.TestCase):
    def _patch(self, body):
        row = {"id": "l-1", "corporation_id": None, "advertiser_entity_id": "prov-1",
               "advertiser_entity_type": "service_provider", "category": "transport", "status": "active"}
        cur = Cursor([("FROM marketplace_listings WHERE id=%s", [row]),
                      ("SELECT field_schema FROM marketplace_categories", [{"field_schema": json.dumps(TRANSPORT)}]),
                      ("UPDATE marketplace_listings", [])])
        with mock.patch.object(marketplace, "get_db", return_value=_conn(cur)):
            return update_listing("l-1", ListingUpdate(**body), x_entity_id="prov-1", x_org_id="prov-1"), cur

    def test_new_answers_replace_the_old_and_move_the_card_price(self):
        _, cur = self._patch({"attributes": {"price_from": 500, "price_unit": "ליום"}})
        sql, params = cur.ran("UPDATE marketplace_listings")[0]
        self.assertIn("attributes=%s, price=%s, price_unit=%s", sql)
        self.assertEqual((json.loads(params[0]), params[1], params[2]), ({"price_from": 500, "price_unit": "ליום"}, 500, "ליום"))

    def test_regions_move_both_columns(self):
        _, cur = self._patch({"regions": ["south"]})
        sql, params = cur.ran("UPDATE marketplace_listings")[0]
        self.assertIn("regions=%s, region=%s", sql)
        self.assertEqual(params[:2], ('["south"]', "south"))

    def test_a_wrong_answer_changes_nothing(self):
        with self.assertRaises(HTTPException) as ctx:
            self._patch({"attributes": {"price_from": 500}})
        self.assertEqual(ctx.exception.detail["code"], "invalid_attributes")


if __name__ == "__main__":
    unittest.main()
