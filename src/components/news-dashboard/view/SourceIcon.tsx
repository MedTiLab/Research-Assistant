import {
  Atom,
  BookOpen,
  FlaskConical,
  Globe2,
  MessageCircle,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';

import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_ICONS: Partial<Record<NewsSourceKey, LucideIcon>> = {
  pubmed: BookOpen,
  europepmc: Globe2,
  medrxiv: FlaskConical,
  arxiv: Atom,
  wechat: MessageCircle,
  xiaohongshu: NotebookPen,
};

const SOURCE_IMAGE_ICONS: Partial<Record<NewsSourceKey, string>> = {
  wechat: '/icons/news/wechat.svg',
};

export default function SourceIcon({
  sourceKey,
  className,
}: {
  sourceKey: NewsSourceKey;
  className?: string;
}) {
  const imageIcon = SOURCE_IMAGE_ICONS[sourceKey];
  if (imageIcon) {
    return <img src={imageIcon} alt="" className={className} aria-hidden="true" />;
  }

  const Icon = SOURCE_ICONS[sourceKey];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}
