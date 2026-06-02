'use client';

import { useState } from 'react';
import LandingNav from '@/components/landing/LandingNav';
import HeroSection from '@/components/landing/HeroSection';
import TrustBar from '@/components/landing/TrustBar';
import LiveActivityFeed from '@/components/landing/LiveActivityFeed';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import MarketplacePreview from '@/components/landing/MarketplacePreview';
import LandingFooter from '@/components/landing/LandingFooter';
import LeadCaptureModal from '@/components/landing/LeadCaptureModal';

export default function LandingPage() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <>
      {/* Fixed nav — sits above everything */}
      <LandingNav onLeadCapture={() => setLeadModalOpen(true)} />

      {/* Flex column with min-h-screen so the dark footer always sits at
          the viewport bottom even on short content, and iOS overscroll
          bounce doesn't reveal a white strip below it (R2 #3). */}
      <div className="min-h-screen flex flex-col">
        <main className="flex-1">
          {/* 1. Full-screen dark hero */}
          <HeroSection onLeadCapture={() => setLeadModalOpen(true)} />

          {/* 2. Trust/stats bar */}
          <TrustBar />

          {/* 3. How it works — 3-step visual */}
          <HowItWorksSection />

          {/* 4. Live marketplace preview */}
          <MarketplacePreview />

          {/* The "מוכנים להתחיל?" / RegistrationCTA section was removed
              per QA round-3 #34 — the role tiles in the hero are now
              the single registration entry point, so the bullet-list
              sell at the bottom was redundant. */}
        </main>

        {/* Footer */}
        <LandingFooter />
      </div>

      {/* Lead capture modal (portal-like, fixed) */}
      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />

      {/* Floating live-activity bubble — pops up bottom-corner with a
          new activity update every few seconds, then slides away. Pure
          overlay; not part of document flow. Phase 1: mock data. */}
      <LiveActivityFeed />
    </>
  );
}
