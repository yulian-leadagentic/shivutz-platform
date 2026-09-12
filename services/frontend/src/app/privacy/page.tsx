{/* טיוטה. טרם עברה בדיקת עורך דין. אין לפרסם לפרודקשן ללא אישור משפטי. */}

// L6 · LEG-2 · מדיניות פרטיות. Draft — NOT reviewed by counsel yet.
// Content describes what the CODE actually collects and where it
// goes, per cc_prompt_L6_legal_pages.md §2.2. Third-party names are
// spelled out; contact_reveals is called out explicitly.

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:       'מדיניות פרטיות · TagidAI',
  description: 'מדיניות פרטיות של פלטפורמת TagidAI (טיוטה, ממתין לעריכת עו״ד)',
};

export default function PrivacyPage() {
  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-8 text-slate-800 leading-relaxed">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">מדיניות פרטיות</h1>
        <p className="text-sm text-slate-500 mt-1">
          עודכן לאחרונה: <time dateTime="2026-09-12">12 בספטמבר 2026</time>
        </p>
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <b>טיוטה.</b> המסמך בהכנה וטרם עבר בדיקה משפטית סופית. הנוסח המחייב יפורסם בהמשך.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">1. מיהו האחראי על המידע</h2>
        <p>
          המידע נאסף ומעובד על ידי <b>Lead Agentic</b> (עוסק מורשה <span dir="ltr">032340283</span>),
          רבי יוסף בוכריץ 6, ראשון לציון. פניות בנושא פרטיות — לדוא&quot;ל{' '}
          <a href="mailto:yulian@leadagentic.net" className="text-brand-700 hover:underline">yulian@leadagentic.net</a>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">2. מה אנחנו אוספים בפועל</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 rounded">
            <tbody className="divide-y divide-slate-200">
              <tr><td className="p-2 font-semibold w-1/3 bg-slate-50">מספר טלפון</td><td className="p-2">לזיהוי בכניסה (OTP).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">שם, דוא&quot;ל, ח.פ</td><td className="p-2">בעת הרישום ולצורך שירות שוטף.</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">מסמכים</td><td className="p-2">רישיונות, תעודות ואישורים שהעליתם.</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">התאמה למרשם ממשלתי</td><td className="p-2">התאמת מספר עוסק ורישיון קבלן מול פנקסים ציבוריים (רשם הקבלנים; רשות האוכלוסין).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">שאילתות חיפוש</td><td className="p-2">הטקסט החופשי שהזנתם בחיפוש נשלח לספק AI חיצוני לצורך פירוש (ראו סעיף 3).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">הקלטות קול</td><td className="p-2">אם השתמשתם בחיפוש קולי, ההקלטה נשלחת לספק תמלול חיצוני (ראו סעיף 3).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">רשומות חשיפה</td><td className="p-2">מי חשף פרטי קשר של מי, ומתי (ראו סעיף 4).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">תשלומים</td><td className="p-2">פרטי כרטיס האשראי <b>אינם נשמרים אצלנו</b> — נשמר טוקן בלבד אצל ספק הסליקה (ראו סעיף 3).</td></tr>
              <tr><td className="p-2 font-semibold bg-slate-50">SMS / WhatsApp</td><td className="p-2">מספרי הטלפון שאיתם התכתבתם, לצורך שליחה של הודעות מערכת ותפעול.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">3. צדדים שלישיים</h2>
        <p>
          למען השקיפות, אלה הספקים שאיתם המידע שלכם עשוי להשתתף — בשמם המלא ולפי מטרת השימוש:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li><b>Anthropic (Claude)</b> — פירוש הטקסט של שאילתות החיפוש שהזנתם. השירות פועל מחוץ לישראל.</li>
          <li><b>ElevenLabs</b> — תמלול הקלטות קול לחיפוש הקולי. השירות פועל מחוץ לישראל.</li>
          <li><b>Cardcom</b> — סליקת אשראי וטוקניזציה של אמצעי תשלום. פרטי הכרטיס עצמם מאוחסנים אצל Cardcom, לא אצלנו.</li>
          <li><b>Vonage</b> — שליחת SMS ו-WhatsApp.</li>
          <li><b>Railway / MySQL</b> — תשתית ענן ואחסון בסיס הנתונים של המערכת.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">4. רשומות חשיפה של פרטי קשר</h2>
        <p>
          כאשר קבלן חושף את פרטי הקשר של תאגיד באמצעות הפלטפורמה, נשמרת רשומה של האירוע:
          זהות הקבלן, זהות התאגיד ומודעה, ותאריך החשיפה.
        </p>
        <p>
          המידע הזה משמש אותנו לאכיפת מכסות המנוי, לתמיכה במקרים של מחלוקת ולסטטיסטיקות מוצר.
          <b> בנוסף, לתאגיד המפרסם מוצג מדד מספרי של החשיפות שהמודעה שלו קיבלה</b> — כלומר, לתאגיד יש נראות
          לכמה קבלנים התעניינו במודעה שלו, ולא רק לקבלן. איננו מציגים את זהותו של הקבלן לתאגיד אלא במסגרת
          עסקה שנסגרה בין השניים.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">5. מטרות ובסיס חוקי</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><b>ביצוע החוזה</b> — הפעלת השירות שנרשמתם אליו: הצגת מודעות, חשיפת פרטי קשר, גבייה על מנוי.</li>
          <li><b>חובות חוקיות</b> — הנפקת חשבוניות, שמירת מסמכי חשבונאות, אימות מול מרשמים ממשלתיים.</li>
          <li><b>אינטרס לגיטימי</b> — מניעת שימוש לרעה, אבטחת מידע, שיפור השירות באמצעות דוחות שימוש מצטברים.</li>
          <li><b>הסכמה</b> — שליחת עדכונים שיווקיים (רק אם ניתנה הסכמה נפרדת).</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">6. תקופת שמירה</h2>
        <p>
          המידע נשמר כל עוד החשבון פעיל, וכן לאחר סגירתו לפרק הזמן הנדרש לפי הדין (למשל, שנים מסמכי חשבונאות).
          פרטי כרטיס לא נשמרים אצלנו כלל — רק אצל ספק הסליקה.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">7. הזכויות שלכם</h2>
        <p>
          לכם יש זכות לפי חוק הגנת הפרטיות התשמ&quot;א-1981 (ותיקון 13 שלו):
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li><b>עיון</b> — לבקש לראות איזה מידע נשמר עליכם.</li>
          <li><b>תיקון</b> — לבקש לתקן מידע לא מדויק.</li>
          <li><b>מחיקה</b> — לבקש למחוק מידע (בכפוף לחובות שמירה חוקיות).</li>
          <li><b>הגבלת עיבוד</b> — לבקש להגביל את השימוש במידע במקרים מסוימים.</li>
        </ul>
        <p>
          פנייה למימוש זכות תישלח לדוא&quot;ל שצוין בסעיף 1 עם &quot;פנייה בנושא פרטיות&quot; בכותרת. נשיב תוך זמן סביר בהתאם לחוק.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">8. אבטחה</h2>
        <p>
          אנו נוקטים אמצעים סבירים להגנה על המידע — הצפנת תעבורה (HTTPS), הגבלת גישה,
          אחסון מבודד לפי סוג נתון, וטוקניזציה של פרטי אשראי בצד ספק הסליקה. אין אבטחה מוחלטת;
          במקרה של אירוע אבטחה מהותי נפעל בהתאם להוראות הדין ונודיע לגורמים הרלוונטיים כנדרש.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">9. עוגיות</h2>
        <p>
          האתר משתמש ב<b>עוגיות חיוניות בלבד</b> — בעיקר לשמירת מצב התחברות (טוקן הזדהות ואסימון רענון).
          איננו מפעילים באתר כלי ניתוח מסחריים או פיקסלים שיווקיים של צדדים שלישיים, ולכן אין באנר הסכמה.
          אם ייעשה שינוי בעתיד — יופיע באנר הסכמה מתאים.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">10. שינויים במדיניות</h2>
        <p>
          אנו רשאים לעדכן מדיניות זו מעת לעת. שינויים מהותיים יובאו לידיעתכם דרך הפלטפורמה או בדוא&quot;ל.
          תאריך העדכון בראש העמוד יעודכן בהתאם.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">11. יצירת קשר</h2>
        <p>
          לפניות בנושא פרטיות — <Link href="/contact" className="text-brand-700 hover:underline">עמוד יצירת קשר</Link>.
        </p>
      </section>

      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}
