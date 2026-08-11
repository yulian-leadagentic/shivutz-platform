import type { MetadataRoute } from 'next';

// Web App Manifest. Next App Router serves this file at /manifest.webmanifest
// automatically and injects the matching <link rel="manifest"> tag — no
// extra wiring in layout.tsx required.
//
// Pre-launch scope (QA-R3 #18): make the app installable + give it a brand
// icon on the home screen / launcher. Full offline / service-worker
// behaviour is intentionally out of scope.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TagidAI — גיוס עובדים זרים לבנייה',
    short_name: 'TagidAI',
    description: 'מערכת מבוססת AI להתאמת עובדים זרים, שיבוץ וניהול תהליך הגיוס בענף הבנייה.',
    lang: 'he',
    dir: 'rtl',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    background_color: '#ffffff',
    // Mirrors the brand orange used across the marketing surface so the
    // status-bar tint on Android + iOS install reads "TagidAI" at a glance.
    theme_color: '#F78203',
    orientation: 'portrait',
    icons: [
      // Full-fidelity 512 (any) + downscaled 192 for launchers that
      // prefer the smaller size. `maskable` reuses the 512 — the
      // generated icon has ~10% padding around the globe/workers
      // so the safe-zone crop won't lose the crown of the helmet.
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
