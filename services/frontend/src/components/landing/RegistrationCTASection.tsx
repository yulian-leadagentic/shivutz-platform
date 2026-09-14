import Link from 'next/link';
import { HardHat, Building2, Wrench, Check, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * U7 · shared 3-card registration CTA.
 *
 * Two variants:
 *   - "full"    · landing page. Larger cards, longer benefit lists,
 *                 optional secondary lead-capture button.
 *   - "compact" · marketplace inline row. Denser cards, one CTA each.
 *
 * The three roles are contractor, corporation, and (U7) service
 * provider. Every role is a live, free registration path — nothing
 * says "coming soon".
 */

interface RegistrationCTASectionProps {
  variant?:        'full' | 'compact';
  onLeadCapture?:  () => void;   // only used in "full"; when undefined the secondary button is hidden
}

interface RoleCard {
  href:     string;
  title:    string;
  tagline:  string;
  cta:      string;
  benefits: string[];
  Icon:     typeof HardHat;
  colors: {
    iconBg:  string;
    iconFg:  string;
    check:   string;
    btnBg:   string;
    btnHov:  string;
    btnText: string;
  };
}

const CARDS: RoleCard[] = [
  {
    href:    '/register/contractor',
    title:   'אני קבלן',
    tagline: 'מחפש עובדים זרים מיומנים לפרויקטים? מצא, בחר ושבץ — הכל דיגיטלי.',
    cta:     'הצטרף עכשיו כקבלן — בחינם',
    benefits: [
      'גישה לאלפי עובדים זרים מיומנים',
      'מנוע התאמה אוטומטי — תוצאות בשניות',
      'ניהול עסקאות ודיווח בפלטפורמה',
      'תשלום מאובטח ושקוף',
    ],
    Icon: HardHat,
    colors: {
      iconBg:  'bg-brand-100',
      iconFg:  'text-brand-600',
      check:   'text-brand-700',
      btnBg:   'bg-brand-600',
      btnHov:  'hover:bg-brand-800',
      btnText: 'text-slate-900',
    },
  },
  {
    href:    '/register/corporation',
    title:   'אני תאגיד',
    tagline: 'תאגיד כוח אדם? פרסם עובדיך לקבלנים מאושרים ברחבי הארץ.',
    cta:     'הצטרף עכשיו כתאגיד — בחינם',
    benefits: [
      'פרסום עובדים ודיור בשוק הפתוח',
      'קבלת בקשות מקבלנים מאומתים',
      'ניהול עובדים, ויזות וזמינות',
      'דשבורד עסקאות ועמלות',
    ],
    Icon: Building2,
    colors: {
      iconBg:  'bg-navy-100',
      iconFg:  'text-navy-600',
      check:   'text-navy-500',
      btnBg:   'bg-navy-600',
      btnHov:  'hover:bg-navy-500',
      btnText: 'text-white',
    },
  },
  {
    href:    '/register/provider',
    title:   'אני ספק שירות',
    tagline: 'הובלות, ביטוח, ציוד, קורסים? פרסם את השירותים שלך לקבלנים ותאגידים.',
    cta:     'הצטרף עכשיו כספק — בחינם',
    benefits: [
      'עמוד ספק עם לוגו וקישור לאתר',
      'פרסום בקטגוריות שירות של השוק',
      'ליד ישיר מקבלנים ותאגידים',
      'ללא דמי מנוי — חינם עד סוף 2026',
    ],
    Icon: Wrench,
    colors: {
      iconBg:  'bg-emerald-100',
      iconFg:  'text-emerald-700',
      check:   'text-emerald-700',
      btnBg:   'bg-emerald-600',
      btnHov:  'hover:bg-emerald-700',
      btnText: 'text-white',
    },
  },
];

export default function RegistrationCTASection({
  variant = 'full',
  onLeadCapture,
}: RegistrationCTASectionProps) {
  if (variant === 'compact') {
    return <CompactCards />;
  }
  return <FullSection onLeadCapture={onLeadCapture} />;
}

function FullSection({ onLeadCapture }: { onLeadCapture?: () => void }) {
  return (
    <section className="bg-white py-24 border-t border-slate-100">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">מוכנים להתחיל?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">הצטרפו לפלטפורמה המובילה</h2>
          <p className="text-slate-500">קבלנים, תאגידים וספקי שירות — לכולם יש כאן מקום</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {CARDS.map((card) => (
            <FullCard key={card.href} card={card} onLeadCapture={onLeadCapture} />
          ))}
        </div>

        <p className="text-center text-sm text-slate-400 mt-8">
          כבר יש לך חשבון?{' '}
          <Link href="/login" className="text-brand-600 hover:text-brand-700 font-semibold">התחבר כאן</Link>
        </p>
      </div>
    </section>
  );
}

function FullCard({ card, onLeadCapture }: { card: RoleCard; onLeadCapture?: () => void }) {
  const { Icon, colors } = card;
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-card p-8 hover:shadow-card-md transition-shadow flex flex-col">
      <div className={`h-12 w-12 rounded-2xl ${colors.iconBg} flex items-center justify-center mb-5`}>
        <Icon className={`h-6 w-6 ${colors.iconFg}`} />
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-1">{card.title}</h3>
      <p className="text-sm text-slate-500 mb-5 leading-relaxed">{card.tagline}</p>
      <ul className="space-y-2.5 mb-7 flex-1">
        {card.benefits.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700">
            <Check className={`h-4 w-4 shrink-0 ${colors.check} mt-0.5`} />
            {b}
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Link
          href={card.href}
          className={`flex items-center justify-between w-full ${colors.btnBg} ${colors.btnHov} ${colors.btnText} font-semibold text-sm px-5 py-3 rounded-xl transition-colors`}
        >
          <span>{card.cta}</span>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {onLeadCapture && (
          <Button type="button" variant="outline" onClick={onLeadCapture} className="w-full">
            השאר פרטים לחזרה
          </Button>
        )}
      </div>
    </div>
  );
}

function CompactCards() {
  return (
    <section className="bg-slate-50 border-y border-slate-200 mt-16">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CARDS.map((card) => (
            <CompactCard key={card.href} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CompactCard({ card }: { card: RoleCard }) {
  const { Icon, colors } = card;
  return (
    <Link
      href={card.href}
      className="group bg-white rounded-2xl border border-slate-200 hover:border-slate-300 shadow-sm hover:shadow-card transition-all p-5 flex items-center gap-4"
    >
      <div className={`h-11 w-11 rounded-xl ${colors.iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-5 w-5 ${colors.iconFg}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-slate-900">{card.title}</h3>
        <p className="text-xs text-slate-500 truncate">{card.tagline}</p>
      </div>
      <ArrowLeft className={`h-4 w-4 shrink-0 ${colors.iconFg} group-hover:translate-x-[-2px] transition-transform`} />
    </Link>
  );
}
