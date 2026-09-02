import AgentWorkSections from './AgentWorkSections';
import { useAgentWork } from './useAgentWork';

type ContinueWorkProps = {
  projectName: string;
  onOpen: (sessionId: string, projectName: string) => void;
};

export default function ContinueWork({ projectName, onOpen }: ContinueWorkProps) {
  const { summary, isLoading } = useAgentWork([projectName]);
  const hasWork = Object.values(summary).some((items) => items.length > 0);
  if (!hasWork && !isLoading) return null;

  return (
    <div className="mx-auto mb-4 w-full max-w-3xl px-3 sm:px-4">
      <div className="rounded-xl border border-border bg-card/90 p-3 shadow-sm">
        <div className="mb-2 px-1">
          <h3 className="text-sm font-semibold text-foreground">继续工作</h3>
          <p className="text-xs text-muted-foreground">恢复需要处理、正在运行或最近完成的 Pi agent 任务。</p>
        </div>
        <AgentWorkSections
          compact
          summary={summary}
          isLoading={isLoading}
          onOpen={(item) => item.sessionId && onOpen(item.sessionId, item.projectKey || projectName)}
        />
      </div>
    </div>
  );
}

