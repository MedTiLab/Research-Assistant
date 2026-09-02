import { useState } from 'react';
import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import { Check, Star, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import ConversationShareButton from '../../../share/ConversationShareButton';
import SidebarItemActionsMenu from './SidebarItemActionsMenu';

const STAGE_TAG_TONE_BY_KEY: Record<string, string> = {
  literature: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  survey: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  ideation: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  experiment: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  publication: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
  promotion: 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
};

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isStarred: boolean;
  onToggleStar: () => void;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isStarred,
  onToggleStar,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onSessionSelect,
  onDeleteSession,
  touchHandlerFactory,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const [isDesktopActionsMenuOpen, setIsDesktopActionsMenuOpen] = useState(false);

  const selectMobileSession = () => {
    onSessionSelect(session, project.name);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.name, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.name, session.id, sessionView.sessionName, session.__provider);
  };

  const startEditingSession = () => {
    onStartEditingSession(session.id, session.summary || session.name || t('projects.newSession'));
  };

  const actionsMenu = (desktop = false) => (
    <SidebarItemActionsMenu
      isStarred={isStarred}
      menuLabel={t('tooltips.sessionActions')}
      addFavoriteLabel={t('tooltips.addToFavorites')}
      removeFavoriteLabel={t('tooltips.removeFromFavorites')}
      renameLabel={t('actions.rename')}
      deleteLabel={t('actions.delete')}
      onToggleStar={onToggleStar}
      onRename={startEditingSession}
      onDelete={requestDeleteSession}
      buttonClassName={desktop ? 'h-6 w-6' : 'h-7 w-7'}
      iconClassName={desktop ? 'h-3.5 w-3.5' : undefined}
      onOpenChange={desktop ? setIsDesktopActionsMenuOpen : undefined}
    />
  );

  const modeBadge =
    sessionView.mode === 'workspace_qa' ? (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        {t('sessions.mode.workspaceQa')}
      </Badge>
    ) : null;
  const stageTags = Array.isArray(session.tags)
    ? session.tags.filter((tag) => tag?.tagType === 'stage')
    : [];
  const visibleStageTags = stageTags.slice(0, 2);
  const hiddenStageCount = Math.max(0, stageTags.length - visibleStageTags.length);

  const stageTagBadges = stageTags.length > 0 ? (
    <div className="mt-1 flex flex-wrap gap-1">
      {visibleStageTags.map((tag) => (
        <span
          key={`${session.id}-${tag.id}`}
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium',
            STAGE_TAG_TONE_BY_KEY[tag.tagKey || ''] || 'border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
          )}
        >
          {tag.label}
        </span>
      ))}
      {hiddenStageCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
          +{hiddenStageCount}
        </span>
      ) : null}
    </div>
  ) : null;

  const rightMetaClassName = 'ml-auto flex items-center gap-1.5 flex-shrink-0';

  return (
    <div className="group relative">
      {sessionView.isActive && (
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </div>
      )}

      <div className="md:hidden">
        <div className={cn(
          'p-2 mx-3 my-0.5 rounded-md bg-card border transition-all duration-150 relative',
          !isEditing && 'active:scale-[0.98]',
          isSelected && 'bg-primary/5 border-primary/20',
          isStarred && !isSelected && 'border-yellow-200/60 bg-yellow-50/60 dark:border-yellow-800/50 dark:bg-yellow-900/10',
          !isSelected && !isStarred && sessionView.isActive
            ? 'border-green-500/30 bg-green-50/5 dark:bg-green-900/5'
            : !isSelected && !isStarred && 'border-border/30',
        )} onClick={isEditing ? undefined : selectMobileSession}>
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={editingSessionName}
                onChange={(event) => onEditingSessionNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveEditedSession();
                  if (event.key === 'Escape') onCancelEditingSession();
                }}
                className="min-w-0 flex-1 rounded-md border border-primary/40 bg-background px-2 py-1.5 text-base focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md bg-green-50 dark:bg-green-900/20" onClick={saveEditedSession} title={t('tooltips.save')}>
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              </button>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md bg-muted" onClick={onCancelEditingSession} title={t('tooltips.cancel')}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {isStarred && <Star className="h-3 w-3 flex-shrink-0 fill-current text-yellow-600 dark:text-yellow-400" />}
                <div className="min-w-0 flex-1 text-xs font-medium truncate text-foreground">{sessionView.sessionName}</div>
                <div className={rightMetaClassName}>
                  <Badge variant="secondary" className="text-xs px-1 py-0 min-w-[1.5rem] justify-center">
                    {sessionView.messageCount}
                  </Badge>
                  {modeBadge}
                </div>
              </div>
              {stageTagBadges}
            </div>

            <div className="ml-1 flex items-center gap-1">
              <ConversationShareButton
                project={project}
                session={session}
                variant="sidebar"
                stopPropagation
                buttonClassName="h-7 w-7 rounded-md active:scale-95"
                iconClassName="h-3.5 w-3.5"
              />
              {actionsMenu()}
            </div>
          </div>
          )}
        </div>
      </div>

      <div className="medical-session-row hidden md:block">
        <Button
          variant="ghost"
          className={cn(
            'w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200',
            isSelected && 'bg-accent text-accent-foreground',
            isStarred && !isSelected && 'bg-yellow-50/60 dark:bg-yellow-900/10',
          )}
          onClick={() => onSessionSelect(session, project.name)}
        >
          <div className="flex items-center gap-2 min-w-0 w-full">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {isStarred && <Star className="h-3 w-3 flex-shrink-0 fill-current text-yellow-600 dark:text-yellow-400" />}
                <div className="min-w-0 flex-1 text-[14px] font-normal truncate text-foreground/90">{sessionView.sessionName}</div>
                <div className={`${rightMetaClassName} group-hover:opacity-0 transition-opacity`}>
                  <Badge
                    variant="secondary"
                    className="text-xs px-1 py-0 min-w-[1.5rem] justify-center"
                  >
                    {sessionView.messageCount}
                  </Badge>
                  {modeBadge}
                </div>
              </div>
              {stageTagBadges}
            </div>
          </div>
        </Button>

        <div className={cn(
          'absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 transition-all duration-200',
          isEditing || isDesktopActionsMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}>
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                </button>
                <button
                  className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                </button>
              </>
            ) : (
              <>
                <ConversationShareButton
                  project={project}
                  session={session}
                  variant="sidebar"
                  stopPropagation
                />
                {actionsMenu(true)}
              </>
            )}
        </div>
      </div>

    </div>
  );
}
