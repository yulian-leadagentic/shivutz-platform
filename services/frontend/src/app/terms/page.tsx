{/* טיוטה. טרם עברה בדיקת עורך דין. אין לפרסם לפרודקשן ללא אישור משפטי. */}

// L6 · LEG-2 · תנאי שימוש. Draft — NOT reviewed by counsel yet.
// The launch report must call this out; do NOT mark the L6 item as
// closed until legal has signed off. See docs/cc-prompts/cc_prompt_L6_legal_pages.md
// §0 for the wording rules.

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:       'תנאי שימוש · TagidAI',
  description: 'תנאי השימוש בפלטפורמת TagidAI (טיוטה, ממתין לעריכת עו״ד)',
};

export default function TermsPage() {
  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-8 text-slate-800 leading-relaxed">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">תנאי שימוש</h1>
        <p className="text-sm text-slate-500 mt-1">
          עודכן לאחרונה: <time dateTime="2026-09-12">12 בספטמבר 2026</time>
        </p>
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <b>טיוטה.</b> המסמך בהכנה וטרם עבר בדיקה משפטית סופית. הנוסח המחייב יפורסם בהמשך.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">1. מיהו נותן השירות</h2>
        <p>
          פלטפורמת TagidAI מופעלת על ידי <b>Lead Agentic</b> (עוסק מורשה <span dir="ltr">032340283</span>), רבי יוסף בוכריץ 6, ראשון לציון 7511404 (להלן: &quot;הפלטפורמה&quot;).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">2. מהות השירות</h2>
        <p>
          הפלטפורמה היא <b>שירות תיווך מידע</b> בין קבלנים בענף הבנייה לבין תאגידי כוח אדם המורשים להעסיק עובדים זרים.
          הפלטפורמה מאפשרת לתאגידים לפרסם מודעות זמינות עובדים ולקבלנים לחפש ולפנות ישירות לתאגיד.
        </p>
        <p className="bg-slate-50 border border-slate-200 rounded p-3">
          <b>הפלטפורמה איננה צד לעסקה</b> בין הקבלן לתאגיד. איננו מעסיקים עובדים, איננו מספקים עובדים בעצמנו,
          איננו מבצעים תשלומים בין הצדדים ואיננו אחראים לביצוע ההסכם, לזמינות העובדים או לאיכות השירות.
          כל התקשרות, הסכם ותנאיו — נחתמים ומבוצעים ישירות בין הקבלן לתאגיד.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">3. כשירות להשתמש בשירות</h2>
        <p>
          השירות מיועד ל<b>משתמשים עסקיים בלבד</b> — בגירים המורשים לחייב את הארגון שאליו הם רשומים.
          המשתמש מצהיר כי הפרטים שמסר נכונים וכי הוא מוסמך לפעול בשם הישות שאליה הוא רשום.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">4. מנוי, ביטול והחזרים</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>לחלק מהמסלולים תקופת ניסיון ללא תשלום; פרטי המסלול מוצגים בדף החיוב.</li>
          <li>המנוי מתחדש אוטומטית מדי חודש עד לביטול על ידי המשתמש.</li>
          <li>ניתן לבטל את המנוי בכל עת דרך דף החיוב. הביטול נכנס לתוקף בתום התקופה שבעדה כבר שולם.</li>
          <li>לא יינתן זיכוי חלקי על ימים לא מנוצלים בתקופה קיימת.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">5. חשיפות פרטי קשר</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>המסלול קובע מכסת חשיפות חודשית של פרטי קשר לתאגידים.</li>
          <li>המכסה <b>אינה נצברת</b> — מכסה שלא נוצלה החודש אינה מועברת לחודש הבא.</li>
          <li>חשיפה שנוצלה — נספרת, ולא ניתנת להחזרה, גם אם ההתקשרות בפועל לא יצאה לפועל.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">6. תוכן המשתמשים</h2>
        <p>
          המפרסם אחראי אישית לנכונות המידע במודעה שהעלה ולזכותו לפרסמו. אנו רשאים להסיר תוכן החורג מהתקנון,
          מהוראות הדין או מפוגע בזכויות צד שלישי.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">7. הגבלת אחריות</h2>
        <p>
          הפלטפורמה מוצעת &quot;כמות שהיא&quot; (AS IS). איננו נותנים אחריות לדיוק המידע במודעות,
          לזמינות עובדים בפועל, להתאמת התאגיד או הקבלן לצרכי הצד השני, או לתוצאות התקשרות שנעשתה בעקבות שימוש בפלטפורמה.
          איננו אחראים לנזק ישיר או עקיף שנגרם כתוצאה מהשימוש בפלטפורמה.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">8. הפסקת השירות</h2>
        <p>
          אנו רשאים להשעות או לסגור חשבון משתמש במקרים של הפרת התנאים, פרסום מטעה, פעילות בלתי חוקית או ניסיון לעקוף
          מגבלות טכניות של הפלטפורמה. במקרים מתאימים תישלח הודעה מקדימה.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">9. שינויים בתנאים</h2>
        <p>
          אנו רשאים לעדכן את התנאים מעת לעת. שינויים מהותיים יובאו לידיעת המשתמש באמצעות התראה בפלטפורמה או בדוא&quot;ל,
          ותאריך העדכון בראש עמוד זה יעודכן בהתאם.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">10. דין ושיפוט</h2>
        <p>
          על השימוש בשירות יחול הדין הישראלי בלבד. סמכות השיפוט הבלעדית בכל מחלוקת תהיה נתונה לבתי המשפט המוסמכים
          במחוז תל אביב-יפו.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">11. יצירת קשר</h2>
        <p>
          לשאלות בנוגע לתנאים אלה — פנו אלינו בעמוד <Link href="/contact" className="text-brand-700 hover:underline">יצירת קשר</Link>{' '}
          או דרך <Link href="/support" className="text-brand-700 hover:underline">התמיכה</Link>.
        </p>
      </section>

      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}
