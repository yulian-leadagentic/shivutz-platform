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
    // status-bar tint on Android + iOS install reads "BuildUp" at a glance.
    theme_color: '#F78203',
    orientation: 'portrait',
    icons: [
      // The PNGs in public/brand are square LEGO renders of the logo — fine
      // as a maskable icon since the safe-zone padding is baked in.
      {
        src: '/brand/buildup-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/brand/buildup-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/buildup-logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
