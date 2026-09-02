import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, ThumbsUp, ThumbsDown } from 'lucide-react';

const PRO_KEYS = ['chat', 'evidence', 'knowledge', 'pubmed', 'files', 'tasks', 'agents', 'artifacts'];
const CON_KEYS = ['evidence', 'knowledge', 'pubmed', 'tasks', 'agents', 'artifacts', 'context', 'workflow'];

function ConsCard({ dark, compact, t }) {
  return (
    <div className={`h-full overflow-hidden ${compact ? 'flex flex-col' : ''} ${dark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-gray-100'} ${compact ? 'border-r' : `rounded-2xl border ${dark ? '' : 'shadow-lg shadow-gray-100/50'}`}`}>
      <div className={`border-b ${compact ? 'px-3 py-3' : 'px-6 py-5'} ${dark ? 'border-white/[0.06] bg-rose-500/[0.04]' : 'border-gray-100 bg-rose-50/60'}`}>
        <div className="flex items-center gap-2.5">
          <div className={`rounded-lg flex items-center justify-center shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10 rounded-xl'} ${dark ? 'bg-rose-500/10' : 'bg-rose-100'}`}>
            <ThumbsDown size={compact ? 15 : 18} className="text-rose-500" />
          </div>
          <div className="min-w-0">
            <h3 className={`font-semibold leading-tight ${compact ? 'text-sm' : 'text-lg'} ${dark ? 'text-white' : 'text-gray-900'}`}>{t('prosCons.cons.title')}</h3>
            {!compact && <p className={`text-sm mt-0.5 ${dark ? 'text-white/35' : 'text-gray-500'}`}>{t('prosCons.cons.subtitle')}</p>}
          </div>
        </div>
      </div>
      <ul className={compact ? 'grid flex-1 grid-rows-[repeat(8,minmax(0,1fr))] px-3 py-0' : 'px-6 py-2'}>
        {CON_KEYS.map((key, i) => (
          <li
            key={key}
            className={`flex gap-2 ${compact ? 'min-h-0 items-center py-0' : 'items-start py-3.5 gap-3'} ${i < CON_KEYS.length - 1 ? (dark ? 'border-b border-white/[0.04]' : 'border-b border-gray-50') : ''}`}
          >
            <div className={`${compact ? '' : 'mt-0.5'} rounded-full flex items-center justify-center shrink-0 ${compact ? 'w-4 h-4' : 'w-6 h-6'} ${dark ? 'bg-rose-500/10' : 'bg-rose-50'}`}>
              <X size={compact ? 10 : 14} className="text-rose-500/80" />
            </div>
            <span className={`leading-snug ${compact ? 'text-[11px] sm:text-xs' : 'text-sm leading-relaxed'} ${dark ? 'text-white/55' : 'text-gray-600'}`}>{t(`prosCons.cons.items.${key}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProsCard({ dark, compact, t }) {
  return (
    <div className={`h-full overflow-hidden ${compact ? 'flex flex-col' : ''} ${dark ? 'bg-white/[0.03] border-emerald-500/20' : 'bg-white border-emerald-100'} ${compact ? '' : `rounded-2xl border ${dark ? '' : 'shadow-lg shadow-emerald-100/40'}`}`}>
      <div className={`border-b ${compact ? 'px-3 py-3' : 'px-6 py-5'} ${dark ? 'border-emerald-500/10 bg-emerald-500/[0.06]' : 'border-emerald-100 bg-emerald-50/70'}`}>
        <div className="flex items-center gap-2.5">
          <div className={`rounded-lg flex items-center justify-center shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10 rounded-xl'} ${dark ? 'bg-emerald-500/15' : 'bg-emerald-100'}`}>
            <ThumbsUp size={compact ? 15 : 18} className="text-emerald-500" />
          </div>
          <div className="min-w-0">
            <h3 className={`font-semibold leading-tight ${compact ? 'text-sm' : 'text-lg'} ${dark ? 'text-white' : 'text-gray-900'}`}>{t('prosCons.pros.title')}</h3>
            {!compact && <p className={`text-sm mt-0.5 ${dark ? 'text-white/35' : 'text-gray-500'}`}>{t('prosCons.pros.subtitle')}</p>}
          </div>
        </div>
      </div>
      <ul className={compact ? 'grid flex-1 grid-rows-[repeat(8,minmax(0,1fr))] px-3 py-0' : 'px-6 py-2'}>
        {PRO_KEYS.map((key, i) => (
          <li
            key={key}
            className={`flex gap-2 ${compact ? 'min-h-0 items-center py-0' : 'items-start py-3.5 gap-3'} ${i < PRO_KEYS.length - 1 ? (dark ? 'border-b border-white/[0.04]' : 'border-b border-gray-50') : ''}`}
          >
            <div className={`${compact ? '' : 'mt-0.5'} rounded-full flex items-center justify-center shrink-0 ${compact ? 'w-4 h-4' : 'w-6 h-6'} ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
              <Check size={compact ? 10 : 14} className="text-emerald-500" />
            </div>
            <span className={`leading-snug ${compact ? 'text-[11px] sm:text-xs' : 'text-sm leading-relaxed'} ${dark ? 'text-white/70' : 'text-gray-700'}`}>{t(`prosCons.pros.items.${key}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProsCons({ dark, variant = 'section' }) {
  const { t } = useTranslation('landing');
  const compact = variant === 'hero';

  if (compact) {
    return (
      <div id="pros-cons" className={`grid grid-cols-2 h-full min-h-0 scroll-mt-24 rounded-xl overflow-hidden border shadow-2xl ${dark ? 'border-white/[0.08] shadow-black/50' : 'border-gray-200 shadow-gray-300/40'}`}>
        <ConsCard dark={dark} compact t={t} />
        <ProsCard dark={dark} compact t={t} />
      </div>
    );
  }

  return (
    <section id="pros-cons" className="relative py-24 px-6 scroll-mt-24">
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>
            {t('prosCons.title')} <span className="text-emerald-500">{t('prosCons.titleHighlight')}</span>{t('prosCons.titleEnd')}
          </h2>
          <p className={`text-lg max-w-2xl mx-auto ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('prosCons.subtitle')}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <ConsCard dark={dark} compact={false} t={t} />
          <ProsCard dark={dark} compact={false} t={t} />
        </div>
      </div>
    </section>
  );
}
