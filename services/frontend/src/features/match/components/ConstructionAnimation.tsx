export function ConstructionAnimation() {
  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 180" className="w-52 h-48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <style>{`
          @keyframes rise { from { transform: scaleY(0); opacity:0; } to { transform: scaleY(1); opacity:1; } }
          @keyframes crane-swing { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
          @keyframes bob { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
          @keyframes flash { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
          .f1 { transform-origin: 100px 158px; animation: rise 0.45s 0.15s ease-out both; }
          .f2 { transform-origin: 100px 139px; animation: rise 0.45s 0.55s ease-out both; }
          .f3 { transform-origin: 100px 120px; animation: rise 0.45s 0.95s ease-out both; }
          .f4 { transform-origin: 100px 101px; animation: rise 0.45s 1.35s ease-out both; }
          .crane { transform-origin: 163px 44px; animation: crane-swing 2.4s 1.8s ease-in-out infinite; }
          .w1 { transform-origin: 36px 158px; animation: bob 1.1s 0.3s ease-in-out infinite; }
          .w2 { transform-origin: 164px 158px; animation: bob 1.1s 0.8s ease-in-out infinite; }
          .spark { animation: flash 0.9s 1.4s ease-in-out infinite; }
        `}</style>

        {/* Ground */}
        <rect x="8" y="161" width="184" height="4" rx="2" fill="#e2e8f0"/>

        {/* Building — 4 floors (rise bottom-up) */}
        <rect x="52" y="140" width="96" height="21" rx="3" fill="#fb923c" className="f1"/>
        <rect x="55" y="119" width="90" height="21" rx="3" fill="#f97316" className="f2"/>
        <rect x="58" y="98"  width="84" height="21" rx="3" fill="#fb923c" className="f3"/>
        <rect x="62" y="77"  width="76" height="21" rx="3" fill="#f97316" className="f4"/>

        {/* Windows floor 1 */}
        <rect x="65"  y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="80"  y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="109" y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="124" y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>

        {/* Windows floor 2 */}
        <rect x="68"  y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="82"  y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="108" y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="122" y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>

        {/* Crane group */}
        <g className="crane">
          {/* Tower */}
          <rect x="161" y="40" width="7" height="121" rx="1.5" fill="#fbbf24"/>
          {/* Horizontal arm */}
          <rect x="100" y="37" width="71" height="7" rx="1.5" fill="#fbbf24"/>
          {/* Counterweight */}
          <rect x="161" y="37" width="14" height="7" rx="1" fill="#f59e0b"/>
          {/* Cable */}
          <line x1="118" y1="44" x2="118" y2="77" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2"/>
          {/* Hook */}
          <path d="M115 75 Q118 80 121 75" stroke="#f59e0b" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {/* Spark on hook */}
          <circle cx="118" cy="81" r="2.5" fill="#fef08a" className="spark"/>
        </g>

        {/* Worker 1 — left */}
        <g className="w1">
          <circle cx="36" cy="149" r="5.5" fill="#64748b"/>
          <rect x="33" y="154" width="7" height="10" rx="1.5" fill="#475569"/>
          {/* Hard hat */}
          <path d="M30.5 148.5 Q36 142 41.5 148.5" fill="#f97316"/>
          <rect x="30.5" y="148" width="11" height="2.5" rx="1" fill="#f97316"/>
          {/* Tool */}
          <line x1="43" y1="156" x2="50" y2="148" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
        </g>

        {/* Worker 2 — right */}
        <g className="w2">
          <circle cx="164" cy="149" r="5.5" fill="#64748b"/>
          <rect x="161" y="154" width="7" height="10" rx="1.5" fill="#475569"/>
          {/* Hard hat */}
          <path d="M158.5 148.5 Q164 142 169.5 148.5" fill="#f97316"/>
          <rect x="158.5" y="148" width="11" height="2.5" rx="1" fill="#f97316"/>
          {/* Tool */}
          <line x1="157" y1="156" x2="150" y2="148" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
        </g>
      </svg>

      <div className="text-center space-y-2">
        <p className="text-slate-800 font-bold text-xl">מחפש את ההתאמות הטובות ביותר…</p>
        <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
          המערכת סורקת עובדים זמינים לפי מקצוע, אזור, ניסיון, שפות וויזה
        </p>
      </div>

      {/* Bouncing dots */}
      <div className="flex gap-2">
        {[0, 150, 300].map((delay) => (
          <div
            key={delay}
            className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
