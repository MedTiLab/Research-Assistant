import { Library } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import GlobalReferencesDashboard from '../../references/view/GlobalReferencesDashboard';
import { formatReferenceChatPrompt, type Reference } from '../../references/types';

import { ExplorerPage, explorerItemClass } from '../../explorer/ExplorerPage';
import PubMedDashboard from './PubMedDashboard';

type NewsDashboardProps = {
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
};

type LiteratureViewKey = 'pubmed' | 'zotero';

export default function NewsDashboard({
  chatTargetProject = null,
  onStartResearchPrompt,
}: NewsDashboardProps) {
  const { t } = useTranslation('news');
  const [activeSource, setActiveSource] = useState<LiteratureViewKey>('pubmed');
  const [zoteroHeaderTarget, setZoteroHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [pubmedHeaderTarget, setPubmedHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [pubmedResultCount, setPubmedResultCount] = useState(0);
  const handleChatFromReference = useCallback((project: Project, reference: Reference) => {
    onStartResearchPrompt?.(project, formatReferenceChatPrompt(reference));
  }, [onStartResearchPrompt]);

  return (
    <ExplorerPage
      eyebrow="Literature"
      title={t('hero.title')}
      countLabel="2"
      sidebar={(
        <>
          <button type="button" onClick={() => setActiveSource('pubmed')} className={explorerItemClass(activeSource === 'pubmed')}>
            <span className="min-w-0 truncate">PubMed</span>
            <span className="text-xs font-normal text-muted-foreground">{pubmedResultCount}</span>
          </button>
          <button type="button" onClick={() => setActiveSource('zotero')} className={explorerItemClass(activeSource === 'zotero')}>
            <span className="flex min-w-0 items-center gap-2 truncate">
              <Library className="h-3.5 w-3.5 shrink-0" />
              {t('sources.zoteroLibrary')}
            </span>
            <span className="text-[10px] font-normal text-muted-foreground">{t('zotero.import')}</span>
          </button>
        </>
      )}
      resultsEyebrow={t('hero.title')}
      resultsTitle={activeSource === 'zotero' ? t('sources.zoteroLibrary') : 'PubMed'}
      resultsDescription={activeSource === 'zotero'
        ? t('zotero.description')
        : '输入关键词或 PubMed 检索式，查找文献并直接导入文献库。'}
      resultsActions={activeSource === 'zotero' ? (
        <div ref={setZoteroHeaderTarget} className="min-h-9" />
      ) : (
        <div ref={setPubmedHeaderTarget} className="min-h-10 w-full sm:w-[440px]" />
      )}
    >
      {activeSource === 'zotero' ? (
        <GlobalReferencesDashboard
          embedded
          headerPortalTarget={zoteroHeaderTarget}
          chatTargetProject={chatTargetProject}
          onChatFromReference={chatTargetProject && onStartResearchPrompt
            ? handleChatFromReference
            : undefined}
        />
      ) : (
        <PubMedDashboard
          embedded
          headerPortalTarget={pubmedHeaderTarget}
          chatTargetProject={chatTargetProject}
          onStartResearchPrompt={onStartResearchPrompt}
          onResultCountChange={setPubmedResultCount}
        />
      )}
    </ExplorerPage>
  );
}
