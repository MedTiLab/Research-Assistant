import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, ArrowRight } from 'lucide-react';
import ProsCons from './ProsCons';

const HERO_METRIC_KEYS = ['pipeline', 'backends', 'skills', 'formats', 'agents', 'workspace'];

export default function HeroSection({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <section id="intro" className="relative min-h-[90vh] flex flex-col items-center justify-center px-6 pb-20 overflow-hidden scroll-mt-24">
      {dark ? (
        <>
          <div className="absolute inset-0 bg-[#111318]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-emerald-500/[0.08] blur-[120px] animate-landing-pulse" />
          <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-teal-500/[0.06] blur-[100px]" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/50 via-white to-white" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-emerald-100/60 blur-[120px] animate-landing-pulse" />
          <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-teal-100/40 blur-[100px]" />
        </>
      )}

      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)'} 1px, transparent 1px)`,
        backgroundSize: '60px 60px'
      }} />

      <div className="relative z-10 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.08] rounded-full px-4 py-1.5 mb-8 animate-landing-fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm text-emerald-600 font-medium">{t('hero.badge')}</span>
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6 animate-landing-fade-in-up">
          <span className={dark ? 'text-white' : 'text-gray-900'}>{t('hero.titleLine1')}</span>
          <br />
          <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 bg-clip-text text-transparent">
            {t('hero.titleLine2')}
          </span>
        </h1>

        <p className={`text-lg sm:text-xl max-w-3xl mx-auto mb-10 leading-relaxed animate-landing-fade-in-up [animation-delay:100ms] ${dark ? 'text-white/50' : 'text-gray-500'}`}>
          {t('hero.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-landing-fade-in-up [animation-delay:200ms]">
          <Link to="/login"
            className="group flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-8 py-3.5 rounded-xl transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/25 hover:-translate-y-0.5">
            {t('hero.ctaPrimary')}
            <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <a href="#pipeline"
            className={`group flex items-center gap-2 border font-medium px-8 py-3.5 rounded-xl transition-all duration-300 ${dark ? 'border-white/10 hover:border-white/20 bg-white/[0.04] text-white/80' : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700 shadow-sm'}`}>
            <Play size={16} className="text-emerald-500" />
            {t('hero.ctaSecondary')}
          </a>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-6 sm:gap-x-8 max-w-3xl mx-auto animate-landing-fade-in-up [animation-delay:300ms]">
          {HERO_METRIC_KEYS.map((key) => {
            const m = t(`hero.metrics.${key}`, { returnObjects: true });
            return (
              <div key={key} className="text-center">
                <div className={`text-3xl sm:text-4xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{m.value}</div>
                <div className={`text-sm mt-1 ${dark ? 'text-white/40' : 'text-gray-400'}`}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pros/cons and demo video */}
      <div className="relative z-10 mt-16 w-full max-w-7xl mx-auto animate-landing-fade-in-up [animation-delay:400ms]">
        <div className="grid lg:grid-cols-2 gap-5 items-stretch">
          <ProsCons dark={dark} variant="hero" />

          <div className={`relative rounded-xl overflow-hidden border shadow-2xl ${dark ? 'border-white/[0.08] shadow-black/50' : 'border-gray-200 shadow-gray-300/40'}`}>
            <div className={`h-12 border-b px-4 flex items-center gap-2 ${dark ? 'bg-[#1c1e24] border-white/[0.06]' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <span className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className={`rounded-md px-4 py-1 text-xs w-full max-w-[300px] text-center ${dark ? 'bg-[#111318] text-white/30' : 'bg-white text-gray-400 border border-gray-200'}`}>demo.mp4</div>
              </div>
            </div>
            <div className={dark ? 'bg-black' : 'bg-gray-950'}>
              <video
                src="/videos/medhelp-landing-demo.mp4"
                className="block aspect-[16/9] w-full object-contain"
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
              />
            </div>
          </div>
        </div>

        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[80%] h-32 bg-emerald-500/[0.06] blur-[80px] rounded-full" />
      </div>

      <div className={`absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t ${dark ? 'from-[#111318]' : 'from-white'} to-transparent`} />
    </section>
  );
}
