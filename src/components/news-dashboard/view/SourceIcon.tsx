import {
  Atom,
  BookOpen,
  FlaskConical,
  Globe2,
  type LucideIcon,
} from 'lucide-react';

import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_ICONS: Partial<Record<NewsSourceKey, LucideIcon>> = {
  pubmed: BookOpen,
  europepmc: Globe2,
  medrxiv: FlaskConical,
  arxiv: Atom,
};

export default function SourceIcon({
  sourceKey,
  className,
}: {
  sourceKey: NewsSourceKey;
  className?: string;
}) {
  const Icon = SOURCE_ICONS[sourceKey];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}
