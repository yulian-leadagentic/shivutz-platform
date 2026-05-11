// Wave 5 (2026-05): /contractor/searches merged into
// /contractor/deals — the latter now shows every original request
// (including those with zero proposals yet) with its proposal sub-
// rows. Keeping this file as a redirect so existing bookmarks /
// stale SMS links don't 404.

import { redirect } from 'next/navigation';

export default function ContractorSearchesRedirect() {
  redirect('/contractor/deals');
}
