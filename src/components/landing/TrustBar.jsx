import React from 'react';
import { useTranslation } from 'react-i18next';

const INSTITUTIONS = [
  {
    name: { zh: '北京大学', en: 'Peking University' },
    logo: '/institutions/peking-university.svg',
    markClassName: 'h-24 w-24',
  },
  {
    name: { zh: '复旦大学', en: 'Fudan University' },
    logo: '/institutions/fudan-university.svg',
    markClassName: 'h-24 w-24',
  },
  {
    name: { zh: '浙江大学', en: 'Zhejiang University' },
    logo: '/institutions/zhejiang-university.svg',
    markClassName: 'h-20 w-36',
  },
  {
    name: { zh: '北京协和医学院', en: 'Peking Union Medical College' },
    logo: '/institutions/pumc.png',
    markClassName: 'h-20 w-44',
  },
  {
    name: { zh: '上海交通大学', en: 'Shanghai Jiao Tong University' },
    logo: '/institutions/shanghai-jiao-tong.png',
    markClassName: 'h-24 w-24',
  },
  {
    name: { zh: '中山大学', en: 'Sun Yat-sen University' },
    logo: '/institutions/sun-yat-sen.png',
    markClassName: 'h-24 w-24',
  },
];

export default function TrustBar({ dark }) {
  const { t, i18n } = useTranslation('landing');
  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');

  return (
    <section className={`relative py-20 border-y ${dark ? 'border-white/[0.05]' : 'border-gray-100'}`}>
      <div className="max-w-7xl mx-auto px-6">
        <p className={`text-center text-sm tracking-widest uppercase mb-10 ${dark ? 'text-white/30' : 'text-gray-400'}`}>
          {t('trust.title')}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {INSTITUTIONS.map((institution) => {
            const name = isZh ? institution.name.zh : institution.name.en;

            return (
              <div
                key={institution.name.en}
                className={`group flex h-44 flex-col items-center justify-center rounded-lg border px-4 py-5 transition-all duration-300 ${
                  dark
                    ? 'border-white/[0.06] bg-white/[0.025] hover:border-emerald-500/25 hover:bg-white/[0.045]'
                    : 'border-gray-100 bg-gray-50/60 hover:border-emerald-200 hover:bg-white hover:shadow-lg hover:shadow-emerald-950/5'
                }`}
              >
                <div className={`flex h-28 w-full items-center justify-center rounded-md ${dark ? 'bg-white' : 'bg-white'}`}>
                  <img
                    src={institution.logo}
                    alt={name}
                    className={`${institution.markClassName} object-contain transition-transform duration-300 group-hover:scale-105`}
                    loading="lazy"
                  />
                </div>
                <span className={`mt-4 text-center text-sm font-medium leading-5 ${dark ? 'text-white/60' : 'text-gray-600'}`}>
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
