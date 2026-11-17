# R41 report · 17.11.2026

1. **Commit.** `4a2d66c` on `pivot/v2` and `staging`. On `main` it went alone, as `477993f` (cherry-pick of `4a2d66c` onto `569b0fb`). That commit touches only `app/coming-soon/page.tsx` and a new `app/coming-soon/layout.tsx`. Production's own logo path (`buildup-lockup.png`) is kept.
2. **Production deploy.** Done. Before it, `main` carried nothing unreleased: every production service ran `569b0fb`, and the frontend ran `f3825e3`, whose frontend tree is the same. Frontend `477993f` built and went live at 12:02. Gateway, user-org, auth and notification skipped it.
3. **HTML check.** `https://www.tagidai.com` (200) serves, in the server HTML:
   - "TagidAI" as text;
   - "פלטפורמה לקבלנים ולתאגידי כוח אדם בענף הבנייה";
   - "TagidAI מופעל על ידי אג'נטיק טכנולוגיות והחזקות בע"מ · ח.פ 517362620";
   - `mailto:tagid@tagidai.com`;
   - `<title>TagidAI · השקה בקרוב</title>`, with the platform line as the meta description;
   - no em dash.

   Before this change the HTML held only a spinner: the whole page sat behind Suspense, so none of its text was in the HTML. Now only the bypass effect (logic unchanged) sits behind Suspense.

Next step for Yulian: resubmit the display name in Meta.

## The full legal name on the rest of the site (staging only)

Commit `7284aa8`, on `pivot/v2` and `staging`, not on production. It changes:
- the footer, `/contact` ("עודכן לאחרונה" set to 17.11.2026) and how-it-works;
- the em-dash lock's test fixture;
- the R36 prompt file.

Migration 111 updates the stored terms and privacy text and the `company_legal_name` setting. It ran on staging at 10:00:36 (ledger): terms v6 and privacy v3 carry the full name, and versions 5 and 2 are in `legal_document_history`. Migration 100 was not edited.

How each place was checked:
- **Staging HTML** shows "טכנולוגיות והחזקות" and no short form on `/contact`, `/how-it-works`, `/terms` and `/privacy`.
- **Home footer** renders in the browser, so it was checked on the local frontend, which runs the same code: "© 2026 אג'נטיק טכנולוגיות והחזקות בע"מ · ח.פ 517362620 · כל הזכויות שמורות".

## Where the short name remains

The search covered every apostrophe form (`'`, `׳`, `&#39;`, SQL `''`). Nothing uses `׳`. There are no English forms in `services/`. Every text column in the staging app databases (284) now has the full name, except one `legal_document_history` row, which is kept on purpose as a record.

Still on the short name:
- `db/migrations/100_r36_operating_company.sql`: left as it ran, as instructed.
- `db/migrations/111_…sql`: the short name is the text it searches for.
- `docs/cc-prompts/r37_report_1115.md`: a past report.
- `docs/accessibility_statement.md:61`, `docs/meta_verification_checklist.md:2,4` and `docs/whatsapp_setup_guide.md:2`: untracked working docs, not edited.
- `.claude/worktrees/agent-*` (3): leftover worktrees of the R38 background agents, holding old copies of the tree.
