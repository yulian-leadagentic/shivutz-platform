{/* L6 · LEG-1 · הצהרת נגישות. Content mirrors
     docs/accessibility_statement.md — that markdown is the source of
     truth (kept in the repo so a copy edit anywhere goes through
     git). If you edit here, mirror the change back there. */}

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:       'הצהרת נגישות · TagidAI',
  description: 'הצהרת נגישות לפי תקנות שוויון זכויות לאנשים עם מוגבלות',
};

export default function AccessibilityPage() {
  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-8 text-slate-800 leading-relaxed">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">הצהרת נגישות — TagidAI</h1>
        <p className="text-sm text-slate-500 mt-1">
          עודכן לאחרונה: <time dateTime="2026-09-12">12 בספטמבר 2026</time>
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">1. המחויבות שלנו</h2>
        <p>
          אנו רואים חשיבות רבה במתן שירות שוויוני לכלל הציבור, לרבות אנשים עם מוגבלות.
          אנו פועלים להנגשת האתר בהתאם ל<b>תקן הישראלי ת&quot;י 5568</b> ולתקנות שוויון זכויות לאנשים עם מוגבלות
          (התאמות נגישות לשירות), התשע&quot;ג-2013.
        </p>
        <p>
          האתר נמצא בתהליך השלמת התאמות נגישות. בהצהרה זו מפורטות ההתאמות שכבר בוצעו,
          וכן דרכי הפנייה לקבלת סיוע או לדיווח על תקלה.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">2. התאמות שבוצעו</h2>

        <h3 className="text-base font-semibold text-slate-900 mt-2">2.1 ניווט והפעלה</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>ניתן להפעיל את רכיבי האתר באמצעות מקלדת.</li>
          <li>חלונות קופצים כוללים ניהול מיקוד: המיקוד עובר לחלון בעת פתיחתו, נלכד בתוכו כל עוד הוא פתוח, וחוזר לנקודת המוצא בעת סגירתו.</li>
          <li>ניתן לסגור חלונות קופצים באמצעות מקש Esc.</li>
        </ul>

        <h3 className="text-base font-semibold text-slate-900 mt-2">2.2 תצוגה וקריאות</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>האתר בנוי בעברית עם תמיכה מלאה בכיווניות מימין לשמאל.</li>
          <li>ניגודיות הצבעים ברכיבים המרכזיים נבדקה ועומדת ברמה AA.</li>
          <li>מידע אינו מועבר באמצעות צבע בלבד; סימונים ותגיות כוללים טקסט.</li>
          <li>האתר מכבד את העדפת המערכת להפחתת אנימציות.</li>
        </ul>

        <h3 className="text-base font-semibold text-slate-900 mt-2">2.3 טפסים והודעות</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>שדות הטופס כוללים תוויות מפורשות.</li>
          <li>שדה קוד האימות החד-פעמי תומך במילוי אוטומטי בהתקנים נתמכים.</li>
          <li>הודעות שגיאה מנוסחות בעברית ומסבירות מה קרה וכיצד להמשיך.</li>
          <li>שינויי מצב בתהליך החיפוש — טעינה, מספר תוצאות, שגיאה — מוכרזים לטכנולוגיות מסייעות.</li>
        </ul>

        <h3 className="text-base font-semibold text-slate-900 mt-2">2.4 מבנה</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>שימוש במבנה סמנטי ובכותרות היררכיות.</li>
          <li>לרכיבים אינטראקטיביים שמות נגישים.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">3. התאמות שטרם הושלמו</h2>
        <p>
          אנו ממשיכים לבדוק ולתקן. נכון למועד עדכון הצהרה זו טרם הושלמה סקירת נגישות מקיפה של כלל מסכי האתר.
        </p>
        <p><b>אם נתקלתם בקושי — נשמח שתפנו אלינו, ונפעל לתקן.</b></p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">4. רכז הנגישות</h2>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-y-1 gap-x-3 text-sm">
          <div className="font-semibold">שם</div><div>יוליאן אברמוביץ</div>
          <div className="font-semibold">טלפון</div><div><a href="tel:+972525278625" dir="ltr" className="text-brand-700 hover:underline">052-527-8625</a></div>
          <div className="font-semibold">דוא&quot;ל</div><div><a href="mailto:yulian@leadagentic.net" className="text-brand-700 hover:underline">yulian@leadagentic.net</a></div>
          <div className="font-semibold">כתובת</div><div>רבי יוסף בוכריץ 6, ראשון לציון 7511404</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">5. דיווח על בעיית נגישות</h2>
        <p>נתקלתם בבעיה? נשמח לשמוע. כדי שנוכל לטפל במהירות, ציינו:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>את <b>כתובת העמוד</b> שבו נתקלתם בקושי.</li>
          <li><b>תיאור קצר של הבעיה</b> ומה ניסיתם לעשות.</li>
          <li>ה<b>דפדפן והמכשיר</b> שבהם השתמשתם, ואם רלוונטי — טכנולוגיה מסייעת.</li>
        </ul>
        <p>
          נטפל בפנייה ונשיב בהקדם, ובכל מקרה <b>בתוך 60 ימים</b> בהתאם לתקנות.
        </p>
      </section>

      <section className="space-y-2 text-sm text-slate-500">
        <p><b>Lead Agentic</b> · עוסק מורשה <span dir="ltr">032340283</span> · רבי יוסף בוכריץ 6, ראשון לציון 7511404</p>
      </section>

      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}
