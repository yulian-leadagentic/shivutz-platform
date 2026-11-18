# Fixes list ג · item 4 report · 18.11.2026

Cardcom document wording and document type. Staging only, `PAYMENT_FAKE_MODE` stays 1, production untouched. Nothing was charged and nothing was sent to Cardcom.

## What changed
- **One place for the wording:** `services/payment/app/services/invoice_lines.py`. {MM/YYYY} is the month of the charge, Israel time. Plan names are the Hebrew ones `/billing` shows, not the tier code.

  | Charge | Line on the document |
  |---|---|
  | Contractor or corporation plan, start and renewal | מנוי לפלטפורמת TagidAI, מסלול בסיסי/מתקדם/פרו, MM/YYYY |
  | Extra users on a plan | משתמש נוסף (or "N משתמשים נוספים") במנוי לפלטפורמת TagidAI, מסלול …, MM/YYYY |
  | Service-provider advertising plan | פרסום בפלטפורמת TagidAI, קטגוריית {שם הקטגוריה}, MM/YYYY |
  | Contact reveal on an import request, once it is charged | חשיפת פרטי קשר בפלטפורמת TagidAI |

- **No default wording.** Both `"עמלת שיבוץ עובדים זרים"` defaults in `cardcom.py` are gone, and so is `"מנוי {tier}, פלטפורמת שיבוץ"` in `subscriptions.py`. A document without a line raises `invoice_description_missing` before anything is sent, so nothing is charged either. This check runs before the fake-mode branch, so it also fails in fake mode and in tests.
- **Document type sent explicitly:** `Document.DocumentTypeToCreate = "TaxInvoiceAndReceipt"` (חשבונית מס קבלה). Field name and value were checked against Cardcom's v11 swagger: `DocumentTran.DocumentTypeToCreate`, enum `DocumentToCreate`. Without the field Cardcom uses `"Auto"`, which takes the terminal's admin setting.

## Tests
- payment suite: **145 OK** (133 before).
- New `test_invoice_lines.py`, 9 tests:
  - the expected line for every charge kind;
  - the month in Israel time;
  - an unknown tier gets no line;
  - no line contains placement, commission or "עובדים";
  - no `.py` file in the payment service contains "שיבוץ", "עמלה" or "עמלת".
- `test_cardcom_requests.py`, 3 new tests:
  - the document type is sent;
  - a document without a line sends nothing;
  - the same failure in fake mode.
- `test_marketplace_charges.py`: the expected provider line is updated.

## Decisions for you
1. **Extra users** were not in item 4. Before this change they would have been invoiced as the plan itself. I used "משתמש נוסף / N משתמשים נוספים במנוי לפלטפורמת TagidAI, מסלול …, MM/YYYY". Confirm or reword.
2. **Provider plan:** the line follows item 4 exactly, so it no longer names the tier or the number of days ("· בסיסי · 30 ימים"). If the category name cannot be read, the line drops it ("פרסום בפלטפורמת TagidAI, MM/YYYY") rather than failing the charge.

## Found, not changed
- `cardcom.capture_transaction` (J5 capture) has no callers, and it posts to `TransactionByDealNumber`, which is not in the v11 API. Only its wording default was removed and the same check added. It can be deleted.
- `"Languge": "he"` on the document (R37) is not a field of `DocumentTran` in the v11 swagger. Cardcom probably ignores it. Worth checking on the first real test charge.
- Outside the payment service, "פלטפורמת שיבוץ" appears only in old migrations (011, 017) whose text 039 already replaced.
