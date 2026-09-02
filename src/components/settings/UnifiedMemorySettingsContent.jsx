import { useEffect, useState } from 'react';
import { BrainCircuit, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import LongTermMemorySettingsContent from './LongTermMemorySettingsContent';
import PreferenceSettingsContent from './MemorySettingsContent';

export default function UnifiedMemorySettingsContent({ projects = [], initialSection = 'longTerm' }) {
  const { t } = useTranslation('settings');
  const [section, setSection] = useState(initialSection === 'preferences' ? 'preferences' : 'longTerm');

  useEffect(() => {
    setSection(initialSection === 'preferences' ? 'preferences' : 'longTerm');
  }, [initialSection]);

  const sections = [
    { id: 'longTerm', icon: BrainCircuit, label: t('memoryHub.longTerm') },
    { id: 'preferences', icon: SlidersHorizontal, label: t('memoryHub.preferences') },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <h3 className="text-base font-semibold text-foreground">{t('memoryHub.title')}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('memoryHub.description')}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2" role="tablist" aria-label={t('memoryHub.title')}>
          {sections.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => setSection(id)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${section === id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {section === 'longTerm'
        ? <LongTermMemorySettingsContent />
        : <PreferenceSettingsContent projects={projects} />}
    </div>
  );
}
