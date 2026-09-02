import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';

export default function PiPluginsSettings() {
  const { t } = useTranslation('settings');
  const label = (key: string, options = {}) => t(`piPlugins.${key}`, options);
  return <section className="space-y-5">
    <div><h3 className="flex items-center gap-2 text-lg font-medium"><Puzzle className="h-5 w-5" />{label('title')}</h3><p className="mt-1 text-sm text-muted-foreground">{label('description')}</p></div>
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/30 p-4 dark:bg-amber-950/10"><h4 className="font-medium">{label('nativeTitle')}</h4></div>
  </section>;
}
