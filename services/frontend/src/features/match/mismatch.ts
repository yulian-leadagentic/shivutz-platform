import type { MatchBundle } from '@/types';
import { heOrigin, heLang } from '@/i18n/he';
import { expMonthsLabel } from './score';

export interface MismatchInfo {
  /** Natural Hebrew sentences, one per line-item with issues. */
  paragraphs: string[];
  hasMismatch: boolean;
}

/**
 * Generates conversational Hebrew paragraphs describing what was found vs.
 * what the contractor requested, e.g.:
 *   "נמצא רק עובד טייח אחד במאגר (מתוך 34 שביקשת) — הוא ממוצא אוקראינה
 *    ודובר אוקראינית בלבד. אם זה מתאים לך, תוכל להתקדם עם התאגיד.
 *    הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש."
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

    const foundOrigins = found > 0
      ? [...new Set(workers.map(w => (w.worker.origin_country ?? '').toUpperCase()).filter(Boolean))]
      : [];
    const allWorkerLangs = found > 0
      ? [...new Set(workers.flatMap(w => w.worker.languages ?? []).map(l => l.toLowerCase()))]
      : [];
    const countIssue     = found < needed;
    const originMismatch = reqOrigins.length > 0
      && foundOrigins.some(o => !reqOrigins.some(r => r.toUpperCase() === o));
    const langMismatch   = reqLangs.length > 0
      && reqLangs.some(rl => !allWorkerLangs.includes(rl.toLowerCase()));
    const expMismatch    = reqExpMon > 0
      && workers.some(w => (w.worker.experience_years ?? 0) * 12 < reqExpMon);

    if (!countIssue && !originMismatch && !langMismatch && !expMismatch) continue;

    // No workers found at all
    if (found === 0) {
      paragraphs.push(
        `לא נמצאו עובדי ${profHe} פנויים במאגר כרגע. ` +
        `הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש.`
      );
      continue;
    }

    // Build sentence
    const sentence: string[] = [];
    const plural    = found > 1;
    const foundWord = plural ? `${found} עובדי ${profHe}` : `עובד ${profHe} אחד`;
    sentence.push(
      countIssue
        ? `נמצא${plural ? 'ו' : ''} רק ${foundWord} במאגר (מתוך ${needed} שביקשת)`
        : `נמצא${plural ? 'ו' : ''} ${foundWord} במאגר`
    );

    if (originMismatch || langMismatch || expMismatch) {
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
    sentence.push('הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש');

    paragraphs.push(sentence.join('. ') + '.');
  }

  return { paragraphs, hasMismatch: paragraphs.length > 0 };
}
