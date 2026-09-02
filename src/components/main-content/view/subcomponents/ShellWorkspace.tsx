import { useEffect, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import StandaloneShell from '../../../StandaloneShell';
import type { Project, ProjectSession } from '../../../../types/app';

type ShellWorkspaceProps = {
  project: Project;
  session?: ProjectSession | null;
};

const AnyStandaloneShell = StandaloneShell as any;

export default function ShellWorkspace({ project, session = null }: ShellWorkspaceProps) {
  const { t } = useTranslation('chat');
  const sessionShellId = session ? `session-shell:${session.id}` : null;
  const [isSessionShellVisible, setIsSessionShellVisible] = useState<boolean>(Boolean(sessionShellId));

  useEffect(() => {
    setIsSessionShellVisible(Boolean(sessionShellId));
  }, [sessionShellId]);

  const sessionTitle = session
    ? (
        session.summary ||
        session.title ||
        session.name ||
        t('shell.workspace.currentSession')
      )
    : null;

  if (!session || !sessionShellId || !sessionTitle || !isSessionShellVisible) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 p-6 text-center">
        <div>
          <div className="text-sm font-medium text-gray-100">{t('shell.disabled.title')}</div>
          <div className="mt-2 max-w-md text-sm text-gray-400">{t('shell.disabled.description')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="border-b border-gray-800 bg-gray-950/80 px-3 py-2">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2">
          <div className="text-sm font-medium text-blue-100">
            {t('shell.historyEdit.bannerTitle')}
          </div>
          <div className="mt-1 text-xs text-blue-100/80">
            {t('shell.historyEdit.bannerDescription')}
          </div>
        </div>
      </div>

      <div className="border-b border-gray-800 bg-gray-950/80 px-2 py-2">
        <div className="group inline-flex items-center gap-1 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-1.5 text-sm text-white">
          <button
            type="button"
            className="flex items-center gap-2 whitespace-nowrap"
            title={sessionTitle}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>{sessionTitle}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSessionShellVisible(false)}
            className="rounded p-0.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('shell.workspace.closeShell', { title: sessionTitle })}
            title={t('shell.workspace.closeShell', { title: sessionTitle })}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <AnyStandaloneShell
          key={session.id}
          project={project}
          session={session}
          showHeader={false}
        />
      </div>
    </div>
  );
}
