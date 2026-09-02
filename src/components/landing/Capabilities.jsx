import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, BookOpen, Bot, Database, Workflow, LayoutDashboard } from 'lucide-react';

const ICONS = [GitBranch, BookOpen, Bot, Database, Workflow, LayoutDashboard];
const KEYS = ['pipeline', 'skills', 'backends', 'formats', 'agents', 'workspace'];

function AnimatedNumber({ value, inView }) {
  const [display, setDisplay] = useState(value);
  const isNumeric = /^\d+$/.test(value);
  useEffect(() => {
    if (!inView || !isNumeric) { setDisplay(value); return; }
    const target = parseInt(value, 10);
    let current = 0;
    const step = Math.max(1, Math.floor(target / 20));
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { setDisplay(String(target)); clearInterval(timer); }
      else setDisplay(String(current));
    }, 40);
    return () => clearInterval(timer);
  }, [inView, value, isNumeric]);
  return <>{display}</>;
}

export default function Capabilities({ dark }) {
  const { t } = useTranslation('landing');
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.2 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="relative py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${dark ? 'text-white' : 'text-gray-900'}`}>{t('capabilities.title')}</h2>
          <p className={`text-lg max-w-2xl mx-auto ${dark ? 'text-white/40' : 'text-gray-500'}`}>{t('capabilities.subtitle')}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {KEYS.map((key, i) => {
            const Icon = ICONS[i];
            const item = t(`capabilities.items.${key}`, { returnObjects: true });
            return (
              <div key={key} className={`group relative rounded-2xl p-6 text-center transition-all duration-500 ${dark ? 'bg-white/[0.03] border border-white/[0.07] hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]' : 'bg-white border border-gray-100 shadow-sm hover:border-emerald-200 hover:shadow-emerald-100/50 hover:shadow-md'}`}>
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="flex justify-center mb-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${dark ? 'bg-emerald-500/10 group-hover:bg-emerald-500/20' : 'bg-emerald-50 group-hover:bg-emerald-100'}`}>
                    <Icon size={20} className="text-emerald-500" />
                  </div>
                </div>
                <div className={`text-3xl sm:text-4xl font-bold mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>
                  <AnimatedNumber value={item.value} inView={inView} />
                </div>
                <div className={`text-sm font-medium mb-2 ${dark ? 'text-white/70' : 'text-gray-700'}`}>{item.label}</div>
                <div className={`text-xs leading-relaxed ${dark ? 'text-white/30' : 'text-gray-400'}`}>{item.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
