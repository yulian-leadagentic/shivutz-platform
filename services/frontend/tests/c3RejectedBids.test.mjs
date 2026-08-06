// verify(C3) — the contractor's tender detail must show rejected bids
// with the admin's rejection reason. Previously rejected bids were
// silently filtered out, so contractors couldn't tell WHY an offer
// disappeared.
//
// Contract:
//   * visibleBids drops withdrawn + pending_admin only; rejected stay
//   * liveBids further drops rejected — used to gate the selection UI
//     (checkboxes, sticky submit)
//   * offersByLine is built from visibleBids (so rejected rows render)
//   * a rejected row renders opacity-60 + red XCircle + reason block

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, '..', 'src', 'app', 'contractor', 'tenders', '[id]', 'page.tsx');
const src = readFileSync(PAGE, 'utf8');

test('visibleBids drops only withdrawn + pending_admin (keeps rejected)', () => {
  const m = src.match(/const\s+visibleBids\s*=\s*[^;]+;/);
  assert.ok(m, 'visibleBids helper must exist');
  const line = m[0];
  assert.match(line, /!==\s*'withdrawn'/,      'excludes withdrawn');
  assert.match(line, /!==\s*'pending_admin'/,  'excludes pending_admin');
  assert.doesNotMatch(line, /!==\s*'rejected'/, 'must NOT exclude rejected — that was the bug');
});

test('liveBids gates the selection flow — rejected still excluded', () => {
  const m = src.match(/const\s+liveBids\s*=\s*visibleBids\.filter[^;]+;/);
  assert.ok(m, 'liveBids derives from visibleBids');
  assert.match(m[0], /!==\s*'rejected'/, 'liveBids drops rejected so it never appears in the sticky submit picker');
});

test('offersByLine walks visibleBids so rejected rows render', () => {
  // Grep the flatMap source — must be `visibleBids`, not `liveBids`.
  const m = src.match(/const\s+offersByLine[\s\S]*?visibleBids\.flatMap/);
  assert.ok(m, 'offersByLine builds from visibleBids (not liveBids)');
});

test('offer row exposes rejectionReason to the render', () => {
  // The map spreads b.rejection_reason so the row template can render it.
  assert.match(
    src,
    /rejectionReason:\s*b\.rejection_reason\s*\?\?\s*null/,
    'rejectionReason must be threaded from bid.rejection_reason into the offer object',
  );
});

test('rejected row renders dimmed + XCircle + the rejection-reason paragraph', () => {
  assert.match(src, /const\s+isRejected\s*=\s*bidStatus\s*===\s*'rejected'/, 'isRejected flag computed per offer');
  // Wrapper takes opacity-60 + rose-tinted background when rejected.
  assert.match(src, /isRejected\s*\?\s*'bg-slate-50 opacity-60'/, 'row dimmed when rejected');
  // Non-clickable red XCircle in place of the checkbox.
  assert.match(src, /isRejected\s*\?\s*\(\s*[\s\S]*?<XCircle/m, 'XCircle replaces the checkbox for rejected rows');
  // The rejection-reason block itself.
  assert.match(src, /isRejected\s*&&\s*\(\s*[\s\S]*?סיבת דחייה/m, 'renders "סיבת דחייה" block for rejected bids');
  assert.match(src, /rejectionReason\s*\|\|\s*'לא צוינה/, 'gracefully handles null reason with a fallback');
});
