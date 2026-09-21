/**
 * R24 §5b · consent line placed under the first submit button of each
 * registration flow.
 *
 * A registration flow's first commit point is where the user hands
 * over their phone number — that is the earliest moment consent is
 * meaningful, and the moment R24 §5b flagged for the guardrail. Per
 * the R24 decision this is NOT a mandatory checkbox (Yulian's rule:
 * "בלי צ׳קבוקס חובה — הוא מוריד המרה"); it's an inline confirmation
 * line with two real links, so the user can read the docs before
 * pressing send-code but the click isn't gated.
 *
 * The contractor + corporation flows also carry a hard-required
 * tc_accepted checkbox further downstream (register/contractor
 * step 3, register/corporation step 3) — that stays; it's the
 * legal acceptance record, and this line is the pre-notice.
 */
import Link from 'next/link';

export function ConsentLine() {
  return (
    <p className="text-[11px] leading-relaxed text-slate-500 text-center pt-2">
      בהרשמה אני מאשר את{' '}
      <Link
        href="/terms"
        target="_blank"
        rel="noopener"
        className="underline underline-offset-2 hover:text-brand-700"
      >
        תנאי השימוש
      </Link>
      {' '}ואת{' '}
      <Link
        href="/privacy"
        target="_blank"
        rel="noopener"
        className="underline underline-offset-2 hover:text-brand-700"
      >
        מדיניות הפרטיות
      </Link>
      .
    </p>
  );
}
