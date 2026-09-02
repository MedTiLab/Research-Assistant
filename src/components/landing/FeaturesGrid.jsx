import React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, FlaskConical, BookOpen, GitBranch, ListChecks } from 'lucide-react';

const FEATURES = [
  { key: 'chat', icon: MessageSquare },
  { key: 'evidence', icon: FlaskConical },
  { key: 'knowledge', icon: BookOpen },
  { key: 'files', icon: GitBranch },
  { key: 'tasks', icon: ListChecks },
];

export default function FeaturesGrid({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <section id="features" className="relative py-24 px-6">
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-4 py-1.5 mb-6">
            <span className="text-xs text-emerald-600 font-medium tracking-wide uppercase">{t('features.badge')}</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>
            {t('features.title')}<br />
            <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">{t('features.titleHighlight')}</span>
          </h2>
          <p className={`text-lg max-w-2xl mx-auto ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('features.subtitle')}</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            const item = t(`features.items.${f.key}`, { returnObjects: true });
            return (
              <div key={f.key} className={`group relative rounded-2xl p-7 transition-all duration-500 ${dark ? 'bg-white/[0.03] border border-white/[0.07] hover:border-emerald-500/20 hover:bg-emerald-500/[0.03]' : 'bg-white border border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-50'}`}>
                <div className="relative">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-colors ${dark ? 'bg-emerald-500/10 group-hover:bg-emerald-500/15' : 'bg-emerald-50 group-hover:bg-emerald-100'}`}>
                    <Icon size={22} className="text-emerald-500" />
                  </div>
                  <h3 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{item.title}</h3>
                  <p className={`text-sm leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
