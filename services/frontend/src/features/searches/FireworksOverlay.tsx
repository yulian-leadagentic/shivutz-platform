'use client';

// Celebration overlay for the post-match success screen.
//
// Tries to play /brand/fireworks.mp4 first (a brand asset the user
// can drop into public/brand/). If that asset isn't on disk (the
// fetch HEAD or the <video> element errors), we fall back to a
// CSS confetti burst — purely client-side, zero dependencies.
//
// CSS lives in app/globals.css under @keyframes fwFall.

import { useEffect, useRef, useState } from 'react';

const PIECE_COUNT = 36;
const COLORS = [
  '#ef4444', '#f97316', '#facc15', '#22c55e',
  '#06b6d4', '#3b82f6', '#a855f7', '#ec4899',
];

export function FireworksOverlay() {
  const [hasVideo, setHasVideo] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/brand/fireworks.mp4', { method: 'HEAD' })
      .then((r) => { if (!cancelled && !r.ok) setHasVideo(false); })
      .catch(() => { if (!cancelled) setHasVideo(false); });
    return () => { cancelled = true; };
  }, []);

  // When the clip ends, hold on the last frame for 1.5s before
  // restarting — that gives the user time to register the final
  // "✓" / fireworks frame instead of it snapping straight back to
  // frame 0 mid-loop. Native HTMLVideoElement `loop` is too tight;
  // we replicate with onended → pause → setTimeout → play.
  function handleEnded() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => { /* autoplay blocked, leave it */ });
      }
    }, 1500);
  }

  if (hasVideo) {
    // Foreground celebration: video sits ON TOP of the spinning
    // logo + text (z-50). pointer-events-none keeps the CTAs
    // underneath clickable through it. No blend mode — the
    // user's clip washes out into white with mix-blend-screen.
    return (
      <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden rounded-2xl">
        <video
          ref={videoRef}
          src="/brand/fireworks.mp4"
          autoPlay
          muted
          playsInline
          onEnded={handleEnded}
          onError={() => setHasVideo(false)}
          className="w-full h-full object-cover"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden rounded-2xl">
      {Array.from({ length: PIECE_COUNT }).map((_, i) => {
        const left  = Math.random() * 100;
        const delay = Math.random() * 0.8;
        const dur   = 1.6 + Math.random() * 1.4;
        const rot   = Math.random() * 360;
        const size  = 6 + Math.random() * 8;
        const color = COLORS[i % COLORS.length];
        return (
          <span
            key={i}
            className="fw-piece absolute top-[-10%] inline-block rounded-sm"
            style={{
              left:              `${left}%`,
              width:             size,
              height:            size * 0.4,
              backgroundColor:   color,
              transform:         `rotate(${rot}deg)`,
              animationDelay:    `${delay}s`,
              animationDuration: `${dur}s`,
            }}
          />
        );
      })}
    </div>
  );
}
