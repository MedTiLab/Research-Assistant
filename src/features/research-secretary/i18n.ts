import type { TFunction } from 'i18next';

export function workbenchLocale(language: string) {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function formatDuration(minutes: number, t: TFunction) {
  if (minutes < 1) return t('duration.lessThanMinute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('duration.minutes', { count: rest });
  if (rest === 0) return t('duration.hours', { count: hours });
  return t('duration.hoursAndMinutes', { hours, minutes: rest });
}
