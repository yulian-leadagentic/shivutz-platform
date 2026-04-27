'use client';

import { useState } from 'react';
import LandingNav from '@/components/landing/LandingNav';
import HeroSection from '@/components/landing/HeroSection';
import TrustBar from '@/components/landing/TrustBar';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import MarketplacePreview from '@/components/landing/MarketplacePreview';
import RegistrationCTASection from '@/components/landing/RegistrationCTASection';
import LandingFooter from '@/components/landing/LandingFooter';
import LeadCaptureModal from '@/components/landing/LeadCaptureModal';

export default function LandingPage() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <>
      {/* Fixed nav — sits above everything */}
      <LandingNav onLeadCapture={() => setLeadModalOpen(true)} />

      <main>
        {/* 1. Full-screen dark hero */}
        <HeroSection onLeadCapture={() => setLeadModalOpen(true)} />

        {/* 2. Trust/stats bar */}
        <TrustBar />

        {/* 3. How it works — 3-step visual */}
        <HowItWorksSection />

        {/* 4. Live marketplace preview */}
        <MarketplacePreview />

        {/* 5. Registration CTA — contractor / corporation */}
        <RegistrationCTASection onLeadCapture={() => setLeadModalOpen(true)} />
      </main>

      {/* Footer */}
      <LandingFooter />

      {/* Lead capture modal (portal-like, fixed) */}
      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </>
  );
}
