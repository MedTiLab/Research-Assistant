import { MessageSquarePlus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';

type SidebarProjectControlsProps = {
  onCreateConversation: () => void;
  t: TFunction;
};

export default function SidebarProjectControls({
  onCreateConversation,
  t,
}: SidebarProjectControlsProps) {
  return (
    <div className="px-3 md:px-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nav-control-surface h-10 min-w-0 justify-start rounded-xl border-0 px-2 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:h-9"
        onClick={onCreateConversation}
        title={t('tooltips.newConversation')}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('projects.newConversation')}</span>
      </Button>
    </div>
  );
}
