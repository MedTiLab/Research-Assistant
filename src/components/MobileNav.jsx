import React from 'react';
import { MessageSquare, Folder, BookOpen, FolderSearch, LayoutDashboard, FileCheck2, Newspaper, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAppModuleVisible } from '../config/appModules';

function MobileNav({ activeTab, setActiveTab, isInputFocused, hasSelectedProject }) {
  const { t } = useTranslation('common');

  const projectNavItems = [
    {
      id: 'survey',
      moduleId: 'survey',
      icon: BookOpen,
      label: t('mobileNav.survey'),
      onClick: () => setActiveTab('survey')
    },
    {
      id: 'chat',
      moduleId: 'chat',
      icon: MessageSquare,
      label: t('tabs.chat'),
      onClick: () => setActiveTab('chat')
    },
    {
      id: 'context',
      moduleId: 'context',
      icon: FolderSearch,
      label: t('mobileNav.context'),
      onClick: () => setActiveTab('context')
    },
    {
      id: 'files',
      moduleId: 'files',
      icon: Folder,
      label: t('mobileNav.files'),
      onClick: () => setActiveTab('files')
    },
  ];
  const globalNavItems = [
    { id: 'dashboard', moduleId: 'dashboard', icon: LayoutDashboard, label: t('tabs.dashboard'), onClick: () => setActiveTab('dashboard') },
    { id: 'submissions', moduleId: 'submissions', icon: FileCheck2, label: t('tabs.submissions'), onClick: () => setActiveTab('submissions') },
    { id: 'news', moduleId: 'news', icon: Newspaper, label: t('tabs.news'), onClick: () => setActiveTab('news') },
    { id: 'automation', moduleId: 'automation', icon: Bot, label: t('tabs.automation'), onClick: () => setActiveTab('automation') },
  ];
  const navItems = hasSelectedProject ? projectNavItems : globalNavItems;
  const visibleNavItems = navItems.filter((item) => isAppModuleVisible(item.moduleId));

  if (visibleNavItems.length === 0) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(8px,env(safe-area-inset-bottom))] transform transition-transform duration-300 ease-in-out ${
        isInputFocused ? 'translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="nav-glass mobile-nav-float rounded-2xl border border-border/30">
        <div className="flex items-center justify-around px-1 py-1.5 gap-0.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={item.onClick}
                onTouchStart={(e) => {
                  e.preventDefault();
                  item.onClick();
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl flex-1 relative touch-manipulation transition-all duration-200 active:scale-95 ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-primary/8 dark:bg-primary/12 rounded-xl" />
                )}
                <Icon
                  className={`relative z-10 transition-all duration-200 ${isActive ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={`relative z-10 text-[10px] font-medium transition-all duration-200 ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MobileNav;
