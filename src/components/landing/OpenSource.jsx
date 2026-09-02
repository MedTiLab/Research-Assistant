import React from 'react';
import { useTranslation } from 'react-i18next';
import { Github, Puzzle, Server, Plug } from 'lucide-react';

const CARD_KEYS = ['skills', 'mcp', 'selfhost'];
const CARD_ICONS = [Puzzle, Plug, Server];

export default function OpenSource({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <section id="opensource" className="relative py-24 px-6">
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <div className={`inline-flex items-center gap-2 border rounded-full px-4 py-1.5 mb-6 ${dark ? 'border-white/10 bg-white/[0.04]' : 'border-gray-200 bg-gray-50'}`}>
            <Github size={14} className={dark ? 'text-white/60' : 'text-gray-500'} />
            <span className={`text-xs font-medium tracking-wide uppercase ${dark ? 'text-white/60' : 'text-gray-500'}`}>{t('opensource.badge')}</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>{t('opensource.title')}</h2>
          <p className={`text-lg max-w-2xl mx-auto mb-8 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('opensource.subtitle')}</p>
          <a href="https://github.com/MedTiLab/Research-Assistant" target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 border rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-300 ${dark ? 'bg-white/[0.06] hover:bg-white/[0.1] border-white/10 hover:border-white/20 text-white/80 hover:text-white' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 hover:border-gray-300 text-gray-700'}`}>
            <Github size={18} />
            {t('opensource.github')}
          </a>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {CARD_KEYS.map((key, i) => {
            const Icon = CARD_ICONS[i];
            const card = t(`opensource.cards.${key}`, { returnObjects: true });
            return (
              <div key={key} className={`group relative rounded-2xl p-7 transition-all duration-500 ${dark ? 'bg-white/[0.03] border border-white/[0.07] hover:border-emerald-500/20' : 'bg-white border border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-50'}`}>
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${dark ? 'bg-emerald-500/10 group-hover:bg-emerald-500/15' : 'bg-emerald-50 group-hover:bg-emerald-100'}`}>
                      <Icon size={22} className="text-emerald-500" />
                    </div>
                    <span className="text-xs font-mono text-emerald-500/60 border border-emerald-500/15 rounded-full px-3 py-1">{card.badge}</span>
                  </div>
                  <h3 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{card.title}</h3>
                  <p className={`text-sm leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{card.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
