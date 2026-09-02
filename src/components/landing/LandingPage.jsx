import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Navbar from './Navbar';
import HeroSection from './HeroSection';
import TrustBar from './TrustBar';
import ResearchEcosystem from './ResearchEcosystem';
import FeaturesGrid from './FeaturesGrid';
import Pipeline from './Pipeline';
import DataCompatibility from './DataCompatibility';
import FooterCTA from './FooterCTA';

export default function LandingPage() {
  const { i18n } = useTranslation();
  const [dark, setDark] = useState(false);

  return (
    <div className={`${dark ? 'dark' : ''}`}>
      <div className={`min-h-screen overflow-x-hidden transition-colors duration-300 ${dark ? 'bg-[#111318] text-white' : 'bg-white text-gray-900'}`}>
        <Navbar dark={dark} setDark={setDark} />
        <HeroSection dark={dark} />
        <TrustBar dark={dark} />
        <ResearchEcosystem dark={dark} />
        <FeaturesGrid dark={dark} />
        <Pipeline dark={dark} />
        <DataCompatibility dark={dark} />
        <FooterCTA dark={dark} />
      </div>
    </div>
  );
}
