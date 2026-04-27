import type { MatchBundle } from '@/types';
import { heOrigin, heLang } from '@/i18n/he';
import { expMonthsLabel } from './score';

export interface FulfilledLine {
  profession: string;     // already-Hebrew label
  found: number;
}
export interface MissingLine {
  profession: string;
  found: number;          // 0 means none at all; >0 means partial
  needed: number;
}

export interface MismatchInfo {
  /** Per-line-item conflict sentences (origin/language/experience). Empty
   *  when only count issues exist. Drives the existing acknowledgment UI. */
  paragraphs: string[];
  /** True if anything is off — count gap OR conflict. */
  hasMismatch: boolean;
  /** True only for conflicts that require explicit user acknowledgment
   *  (origin / language / experience). Pure count gaps are informational. */
  hasBlockingMismatch: boolean;
  /** Line items where this corporation has matches (full or partial). */
  fulfilled: FulfilledLine[];
  /** Line items not fully covered by this corporation. */
  missing: MissingLine[];
}

/**
 * Inspects a single corporation's match bundle and produces:
 *   - a summary of what THIS corporation can supply (`fulfilled`)
 *   - a list of professions it cannot fully cover (`missing`)
 *   - per-line-item conflict sentences for origin/language/experience issues
 *     (the `paragraphs`, which still need explicit user acknowledgment)
 *
 * Count-only gaps are *informational* — the request will stay open and the
 * platform keeps brokering with other corporations. They do not require a
 * checkbox to send the partial inquiry.
 */
export function detectMismatches(
  bundle: MatchBundle,
  lineItemMap: Record<string, {
    origin_preference?: string[];
    required_languages?: string[];
    min_experience?: number;
  }>,
  profMap: Record<string, string>,
): MismatchInfo {
  const paragraphs: string[] = [];
  const fulfilled: FulfilledLine[] = [];
  const missing: MissingLine[] = [];
  let hasBlockingMismatch = false;

  for (const li of bundle.line_items ?? []) {
    const reqLi = lineItemMap[li.line_item_id];
    if (!reqLi) continue;
    const workers    = li.workers ?? [];
    const profHe     = profMap[li.profession] ?? li.profession;
    const needed     = li.needed;
    const found      = workers.length;
    const reqOrigins = reqLi.origin_preference ?? [];
    const reqLangs   = reqLi.required_languages ?? [];
    const reqExpMon  = reqLi.min_experience ?? 0;

    if (found > 0) fulfilled.push({ profession: profHe, found });
    if (found < needed) missing.push({ profession: profHe, found, needed });

    const foundOrigins = found > 0
      ? [...new Set(workers.map(w => (w.worker.origin_country ?? '').toUpperCase()).filter(Boolean))]
      : [];
    const allWorkerLangs = found > 0
      ? [...new Set(workers.flatMap(w => w.worker.languages ?? []).map(l => l.toLowerCase()))]
      : [];
    const originMismatch = reqOrigins.length > 0
      && foundOrigins.some(o => !reqOrigins.some(r => r.toUpperCase() === o));
    const langMismatch   = reqLangs.length > 0
      && reqLangs.some(rl => !allWorkerLangs.includes(rl.toLowerCase()));
    const expMismatch    = reqExpMon > 0
      && workers.some(w => (w.worker.experience_years ?? 0) * 12 < reqExpMon);

    // Origin / language / experience mismatches require explicit consent —
    // the contractor has to actively confirm they accept workers that don't
    // match their stated preferences.
    if ((originMismatch || langMismatch || expMismatch) && found > 0) {
      hasBlockingMismatch = true;
      const sentence: string[] = [];
      const plural    = found > 1;
      const foundWord = plural ? `${found} עובדי ${profHe}` : `עובד ${profHe} אחד`;
      sentence.push(
        found < needed
          ? `נמצא${plural ? 'ו' : ''} רק ${foundWord} במאגר (מתוך ${needed} שביקשת)`
          : `נמצא${plural ? 'ו' : ''} ${foundWord} במאגר`
      );

      const pronoun = plural ? 'הם' : 'הוא';
      const attrs: string[] = [];
      if (foundOrigins.length > 0) {
        attrs.push(`ממוצא ${foundOrigins.map(heOrigin).join('/')}`);
      }
      if (allWorkerLangs.length > 0) {
        attrs.push(`דובר${plural ? 'י' : ''} ${allWorkerLangs.map(heLang).join(', ')} בלבד`);
      }
      if (attrs.length > 0) {
        sentence[0] += ` — ${pronoun} ${attrs.join(' ו')}`;
      }

      if (originMismatch && reqOrigins.length > 0) {
        sentence.push(`ביקשת עובדים מ-${reqOrigins.map(heOrigin).join('/')}`);
      }
      if (expMismatch && reqExpMon > 0) {
        const underExp = workers.filter(w => (w.worker.experience_years ?? 0) * 12 < reqExpMon);
        if (underExp.length === workers.length) {
          sentence.push(`לא עומד${plural ? 'ים' : ''} בדרישת ניסיון של ${expMonthsLabel(reqExpMon)}`);
        } else {
          sentence.push(`${underExp.length} מהעובדים לא עומדים בדרישת הניסיון`);
        }
      }
      sentence.push('אם זה מתאים לך, תוכל להתקדם עם התאגיד');
      paragraphs.push(sentence.join('. ') + '.');
    }
  }

  const hasMismatch = paragraphs.length > 0 || missing.length > 0;
  return { paragraphs, hasMismatch, hasBlockingMismatch, fulfilled, missing };
}

/** Hebrew helpers for the modal — kept here so the rendering stays declarative. */
export function fulfilledLine(line: FulfilledLine): string {
  return `נמצא מענה ל־${line.found} עובדי ${line.profession}`;
}
export function missingLine(line: MissingLine): string {
  if (line.found === 0) return `כרגע אין זמינות לעובדי ${line.profession}`;
  return `כרגע אין זמינות מלאה לעובדי ${line.profession} (נמצאו ${line.found} מתוך ${line.needed})`;
}
export const PARTIAL_FOOTER = 'הבקשה תישלח ותישאר פתוחה, ואנחנו נמשיך לפעול מול התאגידים כדי להשלים את החוסר.';
