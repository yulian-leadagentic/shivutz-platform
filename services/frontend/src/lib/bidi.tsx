import type { ReactNode } from 'react';

// R30 §28 · number pairs flip on screen in Hebrew.
//
// In a paragraph whose base direction is RTL, `×` between two numbers
// is a NEUTRAL character, so it inherits the base direction. The two
// LTR runs then lay out right-to-left and `300×600` READS as
// `600×300`. The data is correct; the rendering is not.
//
// The damage is not cosmetic. The sponsor form says "מומלץ 1200×628";
// a Hebrew reader sees "628×1200", orders a creative at the reversed
// size, and the R29 §2 dimension check rejects it. The advertiser
// blames themselves for a bug we rendered.
//
// `<bdi>` isolates its contents from the surrounding bidi context —
// this is exactly what it is for. `unicode-bidi: isolate` (NOT
// `embed`: embed still lets the neutral character resolve against the
// outer paragraph, which is the bug) is the browser default for
// <bdi>, restated explicitly in globals.css so a CSS reset can't
// quietly remove it.
//
// Applied at RENDER time rather than by editing strings, because the
// same flip hits copy that comes from the database — the side_rail
// seed row stores 'סלוט צד · 300×600' correctly and still displayed
// reversed. A formatter fixes every such string, including ad copy we
// do not control.

// Matches a dimension pair (300×600, 1200 x 628) or a numeric range
// written with an en-dash or ellipsis (10–20, 5..9).
//
// Deliberately NOT matching a plain hyphen: `052-526-7879` is a phone
// number, and those already carry dir="ltr" on their own field from
// §15. Grabbing hyphens here would double-wrap them and risk
// splitting values that are not ranges at all.
const NUMBER_PAIR = /(\d+(?:[.,]\d+)?\s*(?:[×xX*]|–|\.\.)\s*\d+(?:[.,]\d+)?)/g;

/**
 * Split `text` on number pairs and wrap each match in an isolated
 * <bdi>. Returns a ReactNode array safe to render directly.
 *
 * Plain text in, React out — no dangerouslySetInnerHTML, so a
 * database string can never inject markup.
 */
export function isolateNumberPairs(text: string): ReactNode[] {
  // String.split with ONE capturing group interleaves the results:
  // [text, match, text, match, …]. Matches are therefore always at
  // odd indices.
  //
  // Using that parity rather than re-testing each part, because
  // NUMBER_PAIR carries the /g flag and RegExp.test() is stateful —
  // it advances lastIndex between calls, so consecutive .test() calls
  // on the same regex return alternating wrong answers. A classic way
  // to ship a formatter that works in the unit test and misbehaves on
  // the second paragraph of a real page.
  const parts = text.split(NUMBER_PAIR);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <bdi key={i} dir="ltr">{part}</bdi>
      : part
  );
}

/**
 * Drop-in for a Hebrew string that may contain dimensions or ranges.
 *
 *   <BidiText>{`מידה נדרשת: ${w}×${h}`}</BidiText>
 */
export function BidiText({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return <>{isolateNumberPairs(children)}</>;
}
