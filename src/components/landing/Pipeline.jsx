import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Microscope, BarChart3, Share2 } from 'lucide-react';

const STAGE_ICONS = [Search, FileText, Microscope, BarChart3, Share2];
const STAGE_KEYS = ['intake', 'design', 'execution', 'reporting', 'dissemination'];

export default function Pipeline({ dark }) {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState(0);
  const stages = STAGE_KEYS.map((key, i) => ({
    ...t(`pipeline.stages.${key}`, { returnObjects: true }),
    icon: STAGE_ICONS[i],
  }));
  const ActiveIcon = stages[active].icon;

  return (
    <section id="pipeline" className="relative py-24 px-6 overflow-hidden">
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[100px] ${dark ? 'bg-emerald-500/[0.04]' : 'bg-emerald-100/30'}`} />
      <div className="max-w-7xl mx-auto relative">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-4 py-1.5 mb-6">
            <span className="text-xs text-emerald-600 font-medium tracking-wide uppercase">{t('pipeline.badge')}</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>{t('pipeline.title')}</h2>
          <p className={`text-lg max-w-2xl mx-auto ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('pipeline.subtitle')}</p>
        </div>

        {/* Desktop timeline */}
        <div className="hidden lg:block mb-12">
          <div className="relative flex items-center justify-between max-w-4xl mx-auto">
            <div className={`absolute top-6 left-[10%] right-[10%] h-px ${dark ? 'bg-white/[0.08]' : 'bg-gray-200'}`} />
            <div className="absolute top-6 left-[10%] h-px bg-gradient-to-r from-emerald-500 to-emerald-500/0 transition-all duration-700" style={{ width: `${(active / (stages.length - 1)) * 80}%` }} />
            <div className="absolute top-[19px] w-3 h-3 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50 transition-all duration-700 z-20" style={{ left: `calc(${10 + (active / (stages.length - 1)) * 80}% - 6px)` }}>
              <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-30" />
            </div>
            {stages.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === active;
              const isPast = i < active;
              return (
                <button key={i} onClick={() => setActive(i)} className="relative z-10 flex flex-col items-center gap-3 group">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 ${isActive ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30 scale-110' : isPast ? 'bg-emerald-500/20 border border-emerald-500/30' : dark ? 'bg-white/[0.05] border border-white/[0.08] group-hover:border-white/20' : 'bg-gray-50 border border-gray-200 group-hover:border-gray-300'}`}>
                    <Icon size={20} className={isActive ? 'text-white' : isPast ? 'text-emerald-500' : dark ? 'text-white/40 group-hover:text-white/60' : 'text-gray-400 group-hover:text-gray-600'} />
                  </div>
                  <span className={`text-xs font-medium transition-colors ${isActive ? 'text-emerald-500' : dark ? 'text-white/30 group-hover:text-white/50' : 'text-gray-400 group-hover:text-gray-600'}`}>{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile selector */}
        <div className="lg:hidden flex gap-2 overflow-x-auto pb-4 mb-8 px-2 scrollbar-hide">
          {stages.map((s, i) => (
            <button key={i} onClick={() => setActive(i)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${i === active ? 'bg-emerald-500 text-white' : dark ? 'bg-white/[0.05] text-white/40 border border-white/[0.06]' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
              {s.title}
            </button>
          ))}
        </div>

        <div className="max-w-3xl mx-auto">
          <div className={`rounded-2xl p-8 sm:p-10 transition-all duration-500 ${dark ? 'bg-white/[0.03] border border-white/[0.07]' : 'bg-white border border-gray-100 shadow-lg shadow-gray-100/50'}`}>
            <div className="flex items-start gap-5">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
                <ActiveIcon size={26} className="text-emerald-500" />
              </div>
              <div>
                <span className="text-xs font-mono text-emerald-500/60">Stage {active + 1} / {stages.length}</span>
                <h3 className={`text-xl font-semibold mb-3 mt-1 ${dark ? 'text-white' : 'text-gray-900'}`}>{stages[active].title}</h3>
                <p className={`leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{stages[active].desc}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
