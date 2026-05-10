// Matcher waiting-state animation.
//
// Wave 5: replaced the synthetic SVG construction scene with the
// brand's spinning-earth video lockup (the BuildUp logo in motion).
// The video autoplays muted on loop — required for autoplay to work
// in Chrome/Safari. The previous SVG is gone; the file's name is
// kept so existing call sites don't have to change.

export function ConstructionAnimation() {
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <video
        src="/brand/buildup-logo-spinning.mp4"
        autoPlay
        loop
        muted
        playsInline
        className="w-52 h-52 object-contain rounded-2xl"
        aria-hidden="true"
      />

      <div className="text-center space-y-2">
        <p className="text-slate-800 font-bold text-xl">מחפש את ההתאמות הטובות ביותר…</p>
        <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
          המערכת סורקת עובדים זמינים לפי מקצוע, אזור, ניסיון, שפות וויזה
        </p>
      </div>

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
