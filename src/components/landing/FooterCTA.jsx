import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, Mail } from 'lucide-react';

export default function FooterCTA({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <>
      {/* CTA Section */}
      <section className="relative py-24 px-6 overflow-hidden">
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full blur-[120px] ${dark ? 'bg-emerald-500/[0.07]' : 'bg-emerald-100/50'}`} />

        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className={`text-4xl sm:text-5xl font-bold mb-6 leading-tight ${dark ? 'text-white' : 'text-gray-900'}`}>
            {t('cta.title')}<br />
            <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 bg-clip-text text-transparent">{t('cta.titleHighlight')}</span>
          </h2>
          <p className={`text-lg max-w-2xl mx-auto mb-10 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('cta.subtitle')}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/login" className="group flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-8 py-4 rounded-xl transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/25 hover:-translate-y-0.5">
              {t('cta.deploy')}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a href="/help.html"
              className={`group flex items-center gap-2 border font-medium px-8 py-4 rounded-xl transition-all duration-300 ${dark ? 'border-white/10 hover:border-white/20 bg-white/[0.04] text-white/80' : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700 shadow-sm'}`}>
              <BookOpen size={16} className="text-emerald-500" />
              {t('cta.docs')}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={`border-t ${dark ? 'border-white/[0.06] bg-[#0d0f13]' : 'border-gray-100 bg-gray-50'}`}>
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <img src="/icons/medhelp-logo-transparent.png" alt="MedHelp" className="h-7 w-auto rounded-md" />
                <span className={`text-base font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>MedHelp<span className="text-emerald-500">®</span></span>
              </div>
              <p className={`text-sm leading-relaxed mb-4 ${dark ? 'text-white/30' : 'text-gray-400'}`}>{t('footer.tagline')}</p>
              <div className="flex items-center gap-3">
                <a href="mailto:contact@medhelp.com" className={`transition-colors ${dark ? 'text-white/25 hover:text-white/60' : 'text-gray-300 hover:text-gray-500'}`}><Mail size={18} /></a>
              </div>
            </div>

            {[
              { title: t('footer.product'), keys: ['database', 'skills', 'pricing', 'pipeline', 'formats'], anchors: true },
              { title: t('footer.resources'), items: [
                { k: 'docs', href: '/help.html' },
                { k: 'api', href: '/api-docs.html' },
              ]},
              { title: t('footer.support'), items: [
                { k: 'contact', href: 'mailto:contact@medhelp.com' },
              ]},
            ].map((col) => (
              <div key={col.title}>
                <h4 className={`text-sm font-semibold mb-4 ${dark ? 'text-white/60' : 'text-gray-600'}`}>{col.title}</h4>
                <ul className="space-y-2.5">
                  {col.anchors ? col.keys.map(k => (
                    <li key={k}><a href={`#${k === 'formats' ? 'compatibility' : k}`} className={`text-sm transition-colors ${dark ? 'text-white/30 hover:text-white/60' : 'text-gray-400 hover:text-gray-600'}`}>{t(`footer.links.${k}`)}</a></li>
                  )) : col.items.map(l => (
                    <li key={l.k}><a href={l.href} className={`text-sm transition-colors ${dark ? 'text-white/30 hover:text-white/60' : 'text-gray-400 hover:text-gray-600'}`}>{t(`footer.links.${l.k}`)}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </>
  );
}
