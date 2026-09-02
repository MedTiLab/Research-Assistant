import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X, Globe, Sun, Moon } from 'lucide-react';

export default function Navbar({ dark, setDark }) {
  const { t, i18n } = useTranslation('landing');
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeHash, setActiveHash] = useState(() => window.location.hash.replace('#', '') || 'intro');

  const isZh = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');
  const toggleLang = () => i18n.changeLanguage(isZh ? 'en' : 'zh-CN');

  const NAV_LINKS = [
    { label: t('nav.intro'), href: '#intro' },
    { label: t('nav.database'), href: '#database' },
    { label: t('nav.skills'), href: '#skills' },
    { label: t('nav.pubmed'), href: '#pubmed' },
    { label: t('nav.plugins'), href: '#plugins' },
    { label: t('nav.pricing'), href: '#pricing' },
    { label: t('nav.docs'), href: '#docs' },
    { label: t('nav.contact'), href: '#contact' },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    const onHashChange = () => setActiveHash(window.location.hash.replace('#', '') || 'intro');
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const scrollBg = dark
    ? 'bg-[#111318]/85 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl shadow-black/30'
    : 'bg-white/85 backdrop-blur-xl border-b border-gray-200/60 shadow-lg shadow-gray-200/30';

  return (
    <>
      <div className="relative z-50 bg-gradient-to-r from-emerald-600 to-teal-600 text-center text-sm py-2.5 px-4 text-white/95">
        <span className="inline-flex items-center gap-2 flex-wrap justify-center">
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-wide">{t('announcement.badge')}</span>
          {t('announcement.text')}
          <a href="#skills" className="underline underline-offset-2 hover:text-white ml-1">{t('announcement.link')}</a>
        </span>
      </div>

      <nav className={`sticky top-0 z-40 transition-all duration-300 ${scrolled ? scrollBg : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/icons/medhelp-logo-transparent.png" alt="MedHelp" className="h-8 w-auto rounded-md" />
            <span className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-gray-900'}`}>MedHelp<span className="text-emerald-500">®</span></span>
          </Link>

          <div className="hidden xl:flex items-center gap-4">
            {NAV_LINKS.map((l) => {
              const active = activeHash === l.href.replace('#', '');
              return (
                <a key={l.href} href={l.href} className={`text-sm font-medium transition-colors duration-200 ${active ? 'text-emerald-500' : dark ? 'text-white/55 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{l.label}</a>
              );
            })}
          </div>

          <div className="hidden xl:flex items-center gap-2">
            <button onClick={() => setDark(!dark)} className={`p-2 rounded-lg transition-colors ${dark ? 'text-white/50 hover:text-white hover:bg-white/[0.05]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={toggleLang} className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors ${dark ? 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}>
              <Globe size={15} />
              {isZh ? 'EN' : '中文'}
            </button>
            <Link to="/login" className={`text-sm px-4 py-2 transition-colors ${dark ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('nav.signIn')}</Link>
            <Link to="/login" className="text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-emerald-500/25">
              {t('nav.getStarted')}
            </Link>
          </div>

          <div className="flex xl:hidden items-center gap-2">
            <button onClick={() => setDark(!dark)} className={`p-2 rounded-lg ${dark ? 'text-white/50' : 'text-gray-400'}`}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={() => setMobileOpen(!mobileOpen)} className={`p-2 ${dark ? 'text-white/70' : 'text-gray-500'}`}>
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className={`xl:hidden px-6 pb-6 border-t ${dark ? 'bg-[#111318]/95 backdrop-blur-xl border-white/[0.06]' : 'bg-white/95 backdrop-blur-xl border-gray-100'}`}>
            {NAV_LINKS.map((l) => {
              const active = activeHash === l.href.replace('#', '');
              return (
                <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className={`block py-3 border-b font-medium ${active ? 'text-emerald-500' : dark ? 'text-white/55 hover:text-white border-white/[0.04]' : 'text-gray-500 hover:text-gray-900 border-gray-100'}`}>{l.label}</a>
              );
            })}
            <button onClick={toggleLang} className={`flex items-center gap-1.5 text-sm py-3 border-b w-full ${dark ? 'text-white/50 border-white/[0.04]' : 'text-gray-400 border-gray-100'}`}>
              <Globe size={15} />
              {isZh ? 'English' : '中文'}
            </button>
            <div className="flex gap-3 mt-4">
              <Link to="/login" className={`flex-1 text-center text-sm rounded-lg py-2.5 border ${dark ? 'text-white/70 border-white/10' : 'text-gray-600 border-gray-200'}`}>{t('nav.signIn')}</Link>
              <Link to="/login" className="flex-1 text-center text-sm font-medium bg-emerald-500 text-white rounded-lg py-2.5">{t('nav.getStarted')}</Link>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
