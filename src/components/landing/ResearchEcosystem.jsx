import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Database,
  FileText,
  Layers,
  Mail,
  Puzzle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

const TAB_KEYS = ['database', 'skills', 'pubmed', 'pricing', 'plugins', 'docs', 'contact'];
const SKILL_KEYS = ['pubmed', 'literature', 'database', 'analysis', 'writing', 'pipeline'];
const SKILL_ICONS = [Search, BookOpen, Database, BarChart3, FileText, Workflow];
const DATABASE_GROUP_KEYS = ['catalog', 'sources', 'permissions', 'exports'];
const DATABASE_GROUP_ICONS = [Database, Layers, ShieldCheck, FileText];
const PLUGIN_KEYS = ['skillUpload', 'agentRouting', 'privateStack'];
const PLUGIN_ICONS = [Puzzle, Layers, ShieldCheck];
const DOC_KEYS = ['api', 'skills', 'database', 'pipeline'];
const DOC_ICONS = [FileText, Sparkles, Database, Workflow];
const PLAN_KEYS = ['free', 'pro'];

const SKILL_TONE = 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function ResearchEcosystem({ dark }) {
  const { t } = useTranslation('landing');
  const [activeTab, setActiveTab] = useState('database');
  const sectionRef = useRef(null);

  useEffect(() => {
    const syncFromHash = () => {
      const key = window.location.hash.replace('#', '');
      if (!TAB_KEYS.includes(key)) return;
      setActiveTab(key);
      window.requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ block: 'start' });
      });
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  return (
    <section ref={sectionRef} id="research-tabs" className="relative py-16 px-6 overflow-hidden scroll-mt-24">
      {TAB_KEYS.map((key) => (
        <span key={key} id={key} className="absolute top-0" aria-hidden="true" />
      ))}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-current to-transparent ${dark ? 'opacity-[0.06]' : 'opacity-[0.1]'}`} />
      <div className={`absolute top-24 right-[-120px] w-[420px] h-[420px] rounded-full blur-[120px] ${dark ? 'bg-emerald-500/[0.06]' : 'bg-emerald-100/50'}`} />
      <div className={`absolute bottom-[-120px] left-[-120px] w-[420px] h-[420px] rounded-full blur-[120px] ${dark ? 'bg-emerald-500/[0.05]' : 'bg-emerald-100/40'}`} />

      <div className="max-w-7xl mx-auto relative">
        <PanelHeader activeTab={activeTab} dark={dark} />
        {activeTab === 'database' && <DatabasePanel dark={dark} />}
        {activeTab === 'skills' && (
          <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
            <div className="grid sm:grid-cols-2 gap-4">
              {SKILL_KEYS.map((key, index) => {
                const Icon = SKILL_ICONS[index];
                const item = t(`ecosystem.skills.items.${key}`, { returnObjects: true });
                return (
                  <article key={key} className={`rounded-2xl p-6 border transition-all duration-300 ${dark ? 'bg-white/[0.03] border-white/[0.07] hover:border-emerald-500/20 hover:bg-emerald-500/[0.03]' : 'bg-white border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-50'}`}>
                    <div className="flex items-start justify-between gap-4 mb-5">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${SKILL_TONE}`}>
                        <Icon size={20} />
                      </div>
                      <span className={`text-xs rounded-full px-2.5 py-1 ${dark ? 'bg-white/[0.04] text-white/35' : 'bg-gray-50 text-gray-400'}`}>{item.meta}</span>
                    </div>
                    <h3 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{item.title}</h3>
                    <p className={`text-sm leading-relaxed mb-5 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{item.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {asArray(item.tags).map((tag) => (
                        <span key={tag} className={`text-xs rounded-md px-2.5 py-1 border ${dark ? 'border-white/[0.06] bg-white/[0.03] text-white/35' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>{tag}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <PubMedPanel dark={dark} compact />
          </div>
        )}

        {activeTab === 'pubmed' && <PubMedPanel dark={dark} />}
        {activeTab === 'pricing' && <PlansPanel dark={dark} />}
        {activeTab === 'plugins' && <PluginsPanel dark={dark} />}
        {activeTab === 'docs' && <DocsPanel dark={dark} />}
        {activeTab === 'contact' && <ContactPanel dark={dark} />}
      </div>
    </section>
  );
}

function PanelHeader({ activeTab, dark }) {
  const { t } = useTranslation('landing');

  const content = {
    skills: {
      badge: t('ecosystem.tabs.skills'),
      title: `${t('ecosystem.title')} ${t('ecosystem.titleHighlight')}`,
      desc: t('ecosystem.subtitle'),
    },
    database: {
      badge: t('ecosystem.tabs.database'),
      title: t('ecosystem.database.title'),
      desc: t('ecosystem.database.subtitle'),
    },
    pubmed: {
      badge: t('ecosystem.tabs.pubmed'),
      title: t('ecosystem.spotlight.title'),
      desc: t('ecosystem.spotlight.desc'),
    },
    pricing: {
      badge: t('ecosystem.tabs.pricing'),
      title: t('plans.title'),
      desc: t('plans.subtitle'),
    },
    plugins: {
      badge: t('ecosystem.tabs.plugins'),
      title: t('ecosystem.plugins.title'),
      desc: t('ecosystem.plugins.subtitle'),
    },
    docs: {
      badge: t('ecosystem.tabs.docs'),
      title: t('ecosystem.docs.title'),
      desc: t('ecosystem.docs.subtitle'),
    },
    contact: {
      badge: t('ecosystem.tabs.contact'),
      title: t('ecosystem.contact.title'),
      desc: t('ecosystem.contact.desc'),
    },
  }[activeTab];

  return (
    <div className="mb-8 max-w-3xl">
      <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-3 py-1 mb-4">
        <Sparkles size={13} className="text-emerald-500" />
        <span className="text-xs text-emerald-600 font-medium tracking-wide uppercase">{content.badge}</span>
      </div>
      <h2 className={`text-2xl sm:text-3xl font-bold mb-3 leading-tight ${dark ? 'text-white' : 'text-gray-900'}`}>{content.title}</h2>
      <p className={`text-base leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{content.desc}</p>
    </div>
  );
}

function DatabasePanel({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-6 sm:p-8 border ${dark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-gray-100 shadow-lg shadow-gray-100/60'}`}>
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6 items-center">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
              <Database size={22} className="text-emerald-500" />
            </div>
            <div>
              <h3 className={`text-xl font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{t('ecosystem.database.featureTitle')}</h3>
              <p className={`text-sm mt-1 leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('ecosystem.database.featureDesc')}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-4 gap-3">
            {asArray(t('ecosystem.database.metrics', { returnObjects: true })).map((item) => (
              <div key={item.label} className={`min-h-28 rounded-xl p-4 border flex flex-col justify-center ${dark ? 'border-white/[0.06] bg-white/[0.025]' : 'border-gray-100 bg-gray-50/70'}`}>
                <div className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{item.value}</div>
                <div className={`text-sm mt-1 leading-snug ${dark ? 'text-white/45' : 'text-gray-500'}`}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        {DATABASE_GROUP_KEYS.map((key, index) => {
          const Icon = DATABASE_GROUP_ICONS[index];
          const item = t(`ecosystem.database.groups.${key}`, { returnObjects: true });
          return (
            <article key={key} className={`h-full rounded-2xl p-6 border transition-all duration-300 flex flex-col ${dark ? 'bg-white/[0.03] border-white/[0.07] hover:border-emerald-500/20' : 'bg-white border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-50'}`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-5 shrink-0 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
                <Icon size={20} className="text-emerald-500" />
              </div>
              <h4 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{item.title}</h4>
              <p className={`text-sm leading-relaxed mb-5 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{item.desc}</p>
              <div className="mt-auto flex flex-wrap gap-2">
                {asArray(item.tags).map((tag) => (
                  <span key={tag} className={`text-xs rounded-md px-2.5 py-1 border ${dark ? 'border-white/[0.06] bg-white/[0.03] text-white/35' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>{tag}</span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PubMedPanel({ dark, compact = false }) {
  const { t } = useTranslation('landing');
  const details = asArray(t('ecosystem.spotlight.details', { returnObjects: true }));

  return (
    <div className={`rounded-2xl p-6 sm:p-8 border ${dark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-gray-100 shadow-lg shadow-gray-100/60'}`}>
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
          <RefreshCw size={22} className="text-emerald-500" />
        </div>
        <div>
          <h3 className={`text-xl font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{t('ecosystem.spotlight.title')}</h3>
          <p className={`text-sm mt-1 leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('ecosystem.spotlight.desc')}</p>
        </div>
      </div>

      <div className={`grid ${compact ? 'gap-3' : 'md:grid-cols-3 gap-4'} mb-6`}>
        {asArray(t('ecosystem.spotlight.steps', { returnObjects: true })).map((step, index) => (
          <div key={step} className={`rounded-xl px-4 py-3 border ${dark ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-gray-50/70 border-gray-100'}`}>
            <span className="text-xs font-mono text-emerald-500/70">0{index + 1}</span>
            <p className={`text-sm font-medium mt-1 leading-snug ${dark ? 'text-white/70' : 'text-gray-700'}`}>{step}</p>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="grid md:grid-cols-3 gap-4">
          {details.map((detail) => (
            <div key={detail.title} className={`rounded-xl p-4 border ${dark ? 'border-white/[0.06] bg-white/[0.025]' : 'border-gray-100 bg-gray-50/70'}`}>
              <h4 className={`text-sm font-semibold mb-2 ${dark ? 'text-white/80' : 'text-gray-800'}`}>{detail.title}</h4>
              <p className={`text-sm leading-relaxed ${dark ? 'text-white/35' : 'text-gray-500'}`}>{detail.desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlansPanel({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <div className="mx-auto grid max-w-4xl md:grid-cols-2 gap-4">
      {PLAN_KEYS.map((key) => {
        const plan = t(`plans.items.${key}`, { returnObjects: true });
        const featured = Boolean(plan.featured);
        return (
          <article key={key} className={`relative rounded-2xl p-6 border transition-all duration-300 ${featured ? (dark ? 'bg-emerald-500/[0.08] border-emerald-500/30 shadow-2xl shadow-emerald-950/20' : 'bg-emerald-50/50 border-emerald-200 shadow-lg shadow-emerald-100/60') : (dark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-gray-100 shadow-sm')}`}>
            {featured && (
              <span className="absolute right-5 top-5 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white">{t('plans.recommended')}</span>
            )}
            <div className="mb-6">
              <h3 className={`text-xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{plan.name}</h3>
              <p className={`text-sm mt-1 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{plan.desc}</p>
            </div>
            <div className="mb-6">
              <div className={`text-2xl font-bold ${featured ? 'text-emerald-500' : dark ? 'text-white' : 'text-gray-900'}`}>{plan.price}</div>
              <div className={`text-xs mt-1 ${dark ? 'text-white/30' : 'text-gray-400'}`}>{plan.period}</div>
            </div>
            <ul className="space-y-3 mb-7">
              {asArray(plan.features).map((feature) => (
                <li key={feature} className={`flex gap-2 text-sm leading-relaxed ${dark ? 'text-white/50' : 'text-gray-600'}`}>
                  <Check size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link to="/login" className={`group inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${featured ? 'bg-emerald-500 text-white hover:bg-emerald-600' : dark ? 'bg-white/[0.05] text-white/75 hover:bg-white/[0.08]' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
              {plan.cta}
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </article>
        );
      })}
    </div>
  );
}

function PluginsPanel({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {PLUGIN_KEYS.map((key, index) => {
        const Icon = PLUGIN_ICONS[index];
        const item = t(`ecosystem.plugins.items.${key}`, { returnObjects: true });
        return (
          <article key={key} className={`rounded-2xl p-6 border transition-all duration-300 ${dark ? 'bg-white/[0.03] border-white/[0.07] hover:border-emerald-500/20' : 'bg-white border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-50'}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
              <Icon size={22} className="text-emerald-500" />
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{item.title}</h3>
            <p className={`text-sm leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{item.desc}</p>
          </article>
        );
      })}
    </div>
  );
}

function DocsPanel({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
      {DOC_KEYS.map((key, index) => {
        const Icon = DOC_ICONS[index];
        const item = t(`ecosystem.docs.items.${key}`, { returnObjects: true });
        const href = key === 'api'
          ? '/api-docs.html'
          : key === 'database'
            ? '/help.html#resources'
            : key === 'pipeline'
              ? '/help.html#workflow'
              : '/help.html#skills';
        return (
          <a key={key} href={href} className={`group rounded-2xl p-6 border transition-all duration-300 ${dark ? 'bg-white/[0.03] border-white/[0.07] hover:border-emerald-500/20' : 'bg-white border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-50'}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
              <Icon size={22} className="text-emerald-500" />
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>{item.title}</h3>
            <p className={`text-sm leading-relaxed ${dark ? 'text-white/40' : 'text-gray-500'}`}>{item.desc}</p>
          </a>
        );
      })}
    </div>
  );
}

function ContactPanel({ dark }) {
  const { t } = useTranslation('landing');

  return (
    <div className={`rounded-2xl p-8 border ${dark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-gray-100 shadow-lg shadow-gray-100/60'}`}>
      <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-8 items-center">
        <div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${dark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
            <Mail size={22} className="text-emerald-500" />
          </div>
          <h3 className={`text-2xl font-bold mb-3 ${dark ? 'text-white' : 'text-gray-900'}`}>{t('ecosystem.contact.title')}</h3>
          <p className={`text-sm leading-relaxed mb-6 ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('ecosystem.contact.desc')}</p>
          <a href="mailto:contact@medhelp.com" className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600">
            {t('ecosystem.contact.cta')}
            <ArrowRight size={16} />
          </a>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {asArray(t('ecosystem.contact.items', { returnObjects: true })).map((item) => (
            <div key={item.title} className={`rounded-xl p-4 border ${dark ? 'border-white/[0.06] bg-white/[0.025]' : 'border-gray-100 bg-gray-50/70'}`}>
              <h4 className={`text-sm font-semibold mb-2 ${dark ? 'text-white/80' : 'text-gray-800'}`}>{item.title}</h4>
              <p className={`text-sm leading-relaxed ${dark ? 'text-white/35' : 'text-gray-500'}`}>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
