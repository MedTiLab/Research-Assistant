import { useTranslation } from 'react-i18next';
import type { AppTab, ProjectSession } from '../../../../types/app';
import type { MainContentTitleProps } from '../../types/types';
import { stripInternalContextPrefix } from '../../../../utils/sessionFormatting';

function getTabTitle(activeTab: AppTab, isMobile: boolean, t: (key: string) => string) {
  if (activeTab === 'files') {
    return isMobile ? t('fileTree.files') : t('mainContent.projectFiles');
  }

  if (activeTab === 'context') {
    return t('tabs.context');
  }

  if (activeTab === 'dashboard') {
    return t('projectDashboard.title');
  }

  if (activeTab === 'trash') {
    return t('projectDashboard.trashTitle');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'survey') {
    return t('tabs.survey');
  }

  if (activeTab === 'skills') {
    return t('tabs.skills');
  }

  if (activeTab === 'news') {
    return t('tabs.news');
  }

  if (activeTab === 'memorySummary') {
    return t('tabs.memorySummary');
  }

  if (activeTab === 'variableOverview') {
    return t('tabs.variableOverview');
  }

  if (activeTab === 'variableKnowledgePubmedDiscovery') {
    return t('tabs.variableKnowledgePubmedDiscovery');
  }

  if (activeTab === 'medlibrary') {
    return t('tabs.medlibrary');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  const name = (session.summary as string) || (session.name as string) || 'New Session';
    
  return stripInternalContextPrefix(name) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  isMobile,
  compact = false,
}: MainContentTitleProps) {
  const { t } = useTranslation();

  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const isDashboard = activeTab === 'dashboard';
  const isTrash = activeTab === 'trash';
  const isGlobalSkills = activeTab === 'skills' && !selectedProject;
  const isGlobalNews = activeTab === 'news' && !selectedProject;
  const isConversationHistory = activeTab === 'conversationHistory';
  const isMedLibrary = activeTab === 'medlibrary'
    || activeTab === 'variableKnowledgePubmedDiscovery'
    || activeTab === 'variableOverview'
    || activeTab === 'memorySummary';
  const selectedProjectLabel = selectedProject?.isDefaultWorkspace
    ? t('sidebar:projects.conversations')
    : selectedProject?.displayName;
  return (
    <div className="min-w-0 flex items-center gap-2 flex-1 overflow-hidden">
      <div className="min-w-0 flex-1">
        {isDashboard ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {t('projectDashboard.title')}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
                {t('projectDashboard.subtitle')}
              </div>
            )}
          </div>
        ) : isTrash ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {t('projectDashboard.trashTitle')}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
                {t('projectDashboard.trashSubtitle')}
              </div>
            )}
          </div>
        ) : isGlobalSkills ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {t('projectDashboard.skillsTitle')}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
                {t('projectDashboard.skillsDescription')}
              </div>
            )}
          </div>
        ) : isGlobalNews ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {t('newsDashboard.title', '文献动态')}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">
                {t('newsDashboard.subtitle', '从 PubMed、Europe PMC、medRxiv 与 arXiv 发现最新研究成果，并基于相关性、时效性、关注度与质量进行自动评分。')}
              </div>
            )}
          </div>
        ) : isConversationHistory ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {t('tabs.conversationHistory')}
            </h2>
          </div>
        ) : isMedLibrary ? (
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground truncate leading-tight">
              {getTabTitle(activeTab, isMobile, t)}
            </h2>
          </div>
        ) : activeTab === 'chat' && selectedSession && selectedProject ? (
          <div className="min-w-0">
            <h2
              className="text-[15px] font-bold text-foreground truncate leading-tight"
              title={getSessionTitle(selectedSession)}
            >
              {getSessionTitle(selectedSession)}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProjectLabel}</div>
            )}
          </div>
        ) : showChatNewSession && selectedProject ? (
          <div className="min-w-0">
            <h2
              className="text-[15px] font-bold text-foreground truncate leading-tight"
              title={t('mainContent.newSession')}
            >
              {t('mainContent.newSession')}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProjectLabel}</div>
            )}
          </div>
        ) : selectedProject ? (
          <div className="min-w-0">
            <h2
              className="text-[15px] font-bold text-foreground truncate leading-tight"
              title={getTabTitle(activeTab, isMobile, t)}
            >
              {getTabTitle(activeTab, isMobile, t)}
            </h2>
            {!compact && (
              <div className="text-[12px] text-muted-foreground truncate leading-tight mt-0.5">{selectedProjectLabel}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
