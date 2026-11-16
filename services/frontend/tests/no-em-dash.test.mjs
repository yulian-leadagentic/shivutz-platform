// R38 item 2 · the lock: no em dash (U+2014) in text a user reads.
//
// Rule (Yulian, 16.11.2026). The scan is scripts/em-dash-scan.mjs: every
// string literal, template literal and JSX text node in the frontend, the
// notification service, the gateway and auth. Comments are not text a
// user reads and are not scanned. A planted dash must fail the check and
// the same dash in a comment must not.
//
// Run: npm test   (node --test tests/*.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRoots, scanSource, EM_DASH } from '../../../scripts/em-dash-scan.mjs';

const where = (hits) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

test('no em dash in any string or JSX text a user can read', () => {
  const hits = scanRoots();
  assert.equal(hits.length, 0, `replace these with a colon, a comma or a full stop, never a hyphen:\n${where(hits)}`);
});

test('a dash in JSX text is caught', () => {
  const src = `export const A = () => <p>חשבונך אושר ${EM_DASH} ברוך הבא</p>;`;
  assert.equal(scanSource('a.tsx', src).length, 1);
});

test('a dash in a user-facing attribute is caught', () => {
  for (const attr of ['title', 'aria-label', 'placeholder']) {
    const src = `export const A = () => <input ${attr}="שם ${EM_DASH} מלא" />;`;
    assert.equal(scanSource('a.tsx', src).length, 1, attr);
  }
});

test('a dash in a toast, an error and a template literal is caught', () => {
  const src = [
    `toast.error('נכשל ${EM_DASH} נסו שוב');`,
    `throw new Error("שגיאה ${EM_DASH} פנו לתמיכה");`,
    `const sms = \`TagidAI ${EM_DASH} \${name}\`;`,
  ].join('\n');
  assert.equal(scanSource('a.ts', src).length, 3);
});

test('a dash in a comment is not text a user reads', () => {
  const src = [
    `// a line comment ${EM_DASH} fine`,
    `/* a block comment ${EM_DASH} fine */`,
    `export const A = () => (<p>{/* jsx comment ${EM_DASH} fine */}שלום</p>);`,
  ].join('\n');
  assert.equal(scanSource('a.tsx', src).length, 0);
});

test('an en dash in a number range is allowed', () => {
  assert.equal(scanSource('a.tsx', 'export const A = () => <p>5–10 עובדים</p>;').length, 0);
});

test('Hebrew quote marks in JSX text do not confuse the scan', () => {
  const src = `export const A = () => <p>אג'נטיק טכנולוגיות בע"מ ${EM_DASH} ח"פ</p>;`;
  assert.equal(scanSource('a.tsx', src).length, 1);
});
