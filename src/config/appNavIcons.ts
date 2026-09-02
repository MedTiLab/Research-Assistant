import { Database, History, LayoutDashboard, Newspaper, type LucideIcon } from 'lucide-react';

export type GlobalNavModuleId = 'dashboard' | 'medlibrary' | 'news' | 'conversationHistory';

export const GLOBAL_NAV_ICONS: Record<GlobalNavModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  medlibrary: Database,
  news: Newspaper,
  conversationHistory: History,
};
