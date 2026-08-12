import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://frontend-pivot-staging.up.railway.app';

// Two viewport "projects" — same spec runs against both, with the
// viewport + slug prefix passed via env inside the spec. The RTL app
// wants `he-IL` locale so date/number formatting matches production
// user experience.
export default defineConfig({
  testDir: '.',
  // Per-test timeout. Bumped from 60s so the authed test can absorb up
  // to 3 send-otp retries × ~60s each when staging's 10 OTPs/IP/10min
  // cap has been recently exhausted. The retry backoff itself is
  // capped to 90s per retry in postWithRateLimitRetry.
  timeout: 300_000,
  // Serial run. Two workers would each hit send-otp before either
  // writes the token cache, so both burn an OTP against the same IP
  // cap and both 429. Sequential lets the second run reuse the
  // cached tokens from the first with zero contention.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../../screens-export/.playwright-artifacts',
  use: {
    baseURL: BASE_URL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    // Wait for network-idle by default so React Server Components +
    // enum fetches settle before the shot. Individual pages that
    // never idle (rare) can override with a domcontentloaded wait.
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'mobile',
      // Chromium-based mobile emulation. Using WebKit here would need a
      // separate 300MB browser install; Chromium with the right
      // viewport + userAgent + isMobile flags matches the layout that
      // real iOS Safari users see closely enough for a visual audit.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
});
