# GO_LIVE_BILLING — flipping the switch from free launch to real billing

Written 2026-09-18 while the R9 pieces were fresh. The point of the
doc: when Cardcom is finally live, whoever is holding the pager
should not have to reverse-engineer the code to know what to flip
and in what order.

**Precondition:** the system is running with `PAYMENT_FAKE_MODE=1`
and a bunch of subscriptions in `trialing`, `active`, or `comped`
statuses. Nobody has a real payment method on file. See R9 §1 for
why that isn't a bug.

---

## Step 0 · confirm the picture on staging first

Never do this on production first, ever.

```sql
-- how many subs of each status exist?
SELECT status, COUNT(*) FROM payment_db.subscriptions GROUP BY status;

-- how many payment methods exist?
SELECT provider, COUNT(*)
  FROM payment_db.payment_methods
 WHERE deleted_at IS NULL
 GROUP BY provider;

-- what did the free launch cost us so far this quarter?
SELECT DATE_FORMAT(created_at, '%Y-%m') AS mo,
       COUNT(*) AS skips,
       SUM(amount_nis) AS forgone
  FROM payment_db.payment_events
 WHERE kind='renewal'
   AND outcome='skipped_no_payment_method'
   AND created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
 GROUP BY mo
 ORDER BY mo;
```

If any of these numbers surprise you, stop and investigate before
flipping anything.

---

## Step 1 · set the real Cardcom keys on the payment service

Cardcom gives you three things:
- terminal number
- API user / password
- (optionally) a Cardcom webhook signing secret

Set them on Railway:

```bash
railway variables -s payment \
  --set CARDCOM_TERMINAL_NUMBER=…              \
  --set CARDCOM_API_USER=…                     \
  --set CARDCOM_API_PASSWORD=…                 \
  --set CARDCOM_WEBHOOK_SECRET=…               \
  --set PAYMENT_FAKE_MODE=0                    \
  --set TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

⚠️ **`TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes.** Staging
had one that decoded to 48 bytes and every real Cardcom call would
have crashed inside `decrypt_token`. Verify before you continue:

```bash
railway ssh -s payment -- python -c \
  "import os,base64;k=os.environ['TOKEN_ENCRYPTION_KEY'];print('bytes:',len(base64.b64decode(k)))"
# expect: bytes: 32
```

Restart is automatic. Confirm the flag actually took effect:

```bash
curl -s https://staging.yourapp.com/api/payments/subscriptions/me \
  -H "authorization: Bearer <admin token>" | jq .payment_mode
# expect: "real"  (was "fake")
```

---

## Step 2 · restart the notification renewal cron

The daily renewal cron reads `INTERNAL_BATCH_SECRET`; it was already
set alongside R9 §3. Confirm both services still see it and the
cron isn't printing "skipping":

```bash
railway ssh -s notification -- 'node -e "console.log(process.env.INTERNAL_BATCH_SECRET ? \"set\" : \"MISSING\")"'
railway ssh -s payment      -- 'python -c "import os;print(\"set\" if os.getenv(\"INTERNAL_BATCH_SECRET\") else \"MISSING\")"'
```

The next cron tick will pick up every `active` sub whose
`current_period_end` has passed. Subs without a payment method still
get the `skipped_no_payment_method` treatment (R9 §3) — they are NOT
about to be suspended on the first real run.

---

## Step 3 · surface an "Add payment method" affordance

Every account should have a way to add a card *before* their trial
runs out. The path today is the tier picker on `/billing` (Cardcom
hosted flow inlines into that click). Confirm both surfaces:

- **`trialing`** subs — tier picker shows current tier as "current",
  other tiers as "upgrade" and route into the Cardcom flow.
- **`comped`** subs — same picker is available. Buying a tier from
  comped **does NOT** flip status: the sub stays `comped`. This is
  deliberate (§6). Un-comping is an admin action.

---

## Step 4 · exercise the first real charge

Pick a real staging sub that has just paid via Cardcom. Confirm:

```sql
SELECT id, kind, outcome, amount_nis, provider_transaction_id,
       invoice_number, invoice_url, created_at
  FROM payment_db.payment_events
 WHERE entity_id = '<uuid>'
   AND kind IN ('subscription_start','renewal')
 ORDER BY created_at DESC
 LIMIT 5;
```

- `provider_transaction_id` should look like a Cardcom deal id (NOT
  `FAKE-<hex>`).
- `invoice_number` and `invoice_url` should be non-null on the first
  successful charge — Cardcom returns them in the same call.

Then wait for the daily cron and re-check. A subscription that
charged successfully advances `current_period_end` by one period and
does not appear in `skip-summary`.

---

## Step 5 · production

Everything above happened on staging. When you're satisfied:

1. Merge `staging` → `main`.
2. Repeat steps 1–4 against prod. Same env-var names, prod values.
3. Watch `/admin/subscriptions` for the first 48 hours. The skip
   counter should be a small number (only the accounts that haven't
   added a card yet) and NOT the whole user base.
4. If it *is* the whole user base, that means the tier picker isn't
   reaching Cardcom successfully — revert `PAYMENT_FAKE_MODE=0` back
   to `1` and investigate before more customers get billed
   incorrectly.

---

## Guardrails to keep after go-live

- **`comped` never bills.** Renewal batch's SELECT is `active` +
  `past_due` only. If a change here starts to bill comped subs,
  that's a regression, not a feature.
- **`declined` still means declined.** R9 softened `no_payment_method`
  only; a real Cardcom decline still enters `_apply_failure` and the
  three-strikes chain.
- **The skip counter is a tile, not an email.** During launch it will
  be dozens per day. If it ever becomes an email-per-skip flow, some
  admin will filter it into a folder and stop reading.
