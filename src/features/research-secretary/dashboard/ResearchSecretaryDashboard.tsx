import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  Bot,
  BookOpenCheck,
  CircleAlert,
  ClipboardCheck,
  FileCheck2,
  FilePenLine,
  MessageSquareText,
  Newspaper,
  Presentation,
  Sparkles,
  Target,
} from 'lucide-react';
import type { AppTab, Project } from '../../../types/app';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { isAppTabVisible } from '../../../config/appModules';
import type { LiteratureAlert, ResearchTask, SubmissionStatus, WorkbenchAttendanceLog, WorkbenchFocusSession, WorkbenchTodayStatus } from '../domain/types';
import { WorkbenchPage } from '../components/WorkbenchUi';
import { useResearchSecretarySnapshot } from '../services/useResearchSecretarySnapshot';
import { workbenchStateApi } from '../services/workbenchStateApi';
import { researchTrackingApi } from '../services/researchTrackingApi';
import {
  selectActiveAgentRuns,
  selectNextMeeting,
  selectOpenTasks,
} from '../domain/selectors';
import HomeHero from './home/HomeHero';
import HomeToday from './home/HomeToday';
import { toLocalDateKey } from './home/today/calendarGrid';
import type { CalendarTodo } from './home/today/agenda';
import HomeInbox, { type InboxNote } from './home/HomeInbox';
import { NextMeetingCard, SignalList, type HomeSignal } from './home/HomeSpotlight';
import { QuickLinkRow, type QuickLink } from './home/HomeAssistants';
import { Panel, PanelHead } from './home/HomeUi';
import type { WorkbenchCommand, WorkbenchEntity } from '../domain/workbenchCommand';

type Props = {
  projects: Project[];
  onNavigate: (tab: AppTab) => void;
  onCommand?: (command: WorkbenchCommand) => Promise<void> | void;
  onMenuClick?: () => void;
};

const FOCUS_STORAGE_KEY = 'research-secretary:daily-focus';
const GOAL_STORAGE_KEY = 'research-secretary:daily-goal';
const INBOX_STORAGE_KEY = 'research-secretary:inbox';
const CALENDAR_STORAGE_KEY = 'research-secretary:calendar-todos';

const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: '撰写中',
  journal_selected: '已选期刊',
  presubmission_check: '投稿前检查',
  submitted: '已投稿',
  with_editor: '编辑处理中',
  under_review: '外审中',
  minor_revision: '小修',
  major_revision: '大修',
  rejected: '被拒',
  resubmitted: '已重投',
  accepted: '已接收',
  proof: '校样',
  published: '已发表',
};

const ATTENTION_SUBMISSION_STATUSES: SubmissionStatus[] = [
  'minor_revision',
  'major_revision',
  'presubmission_check',
  'rejected',
  'proof',
];

function readStoredText(key: string) {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) || '';
}

function readStoredNotes(): InboxNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INBOX_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is InboxNote => Boolean(item && typeof item.text === 'string' && typeof item.id === 'string'));
  } catch {
    return [];
  }
}

function readStoredCalendarTodos(): CalendarTodo[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CALENDAR_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CalendarTodo => Boolean(
      item
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      && typeof item.completed === 'boolean'
      && typeof item.createdAt === 'string',
    ));
  } catch {
    return [];
  }
}

export default function ResearchSecretaryDashboard({
  projects,
  onNavigate,
  onCommand,
  onMenuClick,
}: Props) {
  const { latestMessage } = useWebSocket();
  const { api, snapshot, isLoading, error, refresh: refreshSnapshot } = useResearchSecretarySnapshot(projects);
  const [now, setNow] = useState(() => new Date());
  const [focus, setFocus] = useState(() => readStoredText(FOCUS_STORAGE_KEY));
  const [goal, setGoal] = useState(() => readStoredText(GOAL_STORAGE_KEY));
  const [planSaved, setPlanSaved] = useState(false);
  const [inboxDraft, setInboxDraft] = useState('');
  const [inboxNotes, setInboxNotes] = useState<InboxNote[]>(() => readStoredNotes());
  const [calendarTodos, setCalendarTodos] = useState<CalendarTodo[]>(() => readStoredCalendarTodos());
  const [stateError, setStateError] = useState<string | null>(null);
  const [todayStatus, setTodayStatus] = useState<WorkbenchTodayStatus | null>(null);
  const [attendanceLogs, setAttendanceLogs] = useState<WorkbenchAttendanceLog[]>([]);
  const [focusSessions, setFocusSessions] = useState<WorkbenchFocusSession[]>([]);
  const stateLoadStarted = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * The snapshot numbers and the check-in / focus segments describe the same day and are changed by
   * the same actions (including the pomodoro auto-starting work), so they always refresh together.
   */
  const refreshTodayStatus = useCallback(() => {
    void Promise.all([
      researchTrackingApi.getTodayStatus(),
      researchTrackingApi.listAttendance(),
      researchTrackingApi.listFocusSessions(),
    ]).then(([status, logs, sessions]) => {
      setTodayStatus(status);
      setAttendanceLogs(logs);
      setFocusSessions(sessions);
    }).catch((cause) => {
      setStateError(cause instanceof Error ? cause.message : '加载今日状态失败');
    });
  }, []);

  useEffect(() => { refreshTodayStatus(); }, [refreshTodayStatus]);

  useEffect(() => {
    if (latestMessage?.type !== 'workbench-updated') return;
    const scope = typeof latestMessage.scope === 'string' ? latestMessage.scope : '';
    if (['today', 'habit', 'review', 'submission', 'calendar'].includes(scope)) refreshTodayStatus();
  }, [latestMessage, refreshTodayStatus]);

  useEffect(() => {
    if (latestMessage?.type !== 'workbench-updated') return;
    const scope = typeof latestMessage.scope === 'string' ? latestMessage.scope : '';
    if (scope !== 'calendar' && scope !== 'note') return;
    const day = toLocalDateKey(new Date());
    void Promise.all([
      workbenchStateApi.listCalendarTodos(),
      workbenchStateApi.listNotes(),
    ]).then(([todos, notes]) => {
      setCalendarTodos(todos);
      setInboxNotes(notes.filter((note) => note.kind === 'inbox').map((note) => ({
        id: note.id, text: note.content, createdAt: note.createdAt,
      })));
      setFocus(notes.find((note) => note.kind === 'daily_focus' && note.day === day)?.content || '');
      setGoal(notes.find((note) => note.kind === 'daily_goal' && note.day === day)?.content || '');
      setStateError(null);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '刷新首页计划失败'));
  }, [latestMessage]);

  useEffect(() => {
    if (stateLoadStarted.current) return;
    stateLoadStarted.current = true;
    let cancelled = false;
    const load = async () => {
      const day = toLocalDateKey(new Date());
      try {
        let [serverTodos, serverNotes] = await Promise.all([
          workbenchStateApi.listCalendarTodos(),
          workbenchStateApi.listNotes(),
        ]);
        const localTodos = readStoredCalendarTodos();
        const localInbox = readStoredNotes();
        const localFocus = readStoredText(FOCUS_STORAGE_KEY);
        const localGoal = readStoredText(GOAL_STORAGE_KEY);
        let migrated = false;

        if (serverTodos.length === 0 && localTodos.length > 0) {
          await Promise.all(localTodos.map((todo) => workbenchStateApi.createCalendarTodo(todo)));
          window.localStorage.removeItem(CALENDAR_STORAGE_KEY);
          migrated = true;
        }
        if (!serverNotes.some((note) => note.kind === 'inbox') && localInbox.length > 0) {
          await Promise.all(localInbox.map((note) => workbenchStateApi.saveNote({
            id: note.id, kind: 'inbox', content: note.text, createdAt: note.createdAt,
          })));
          window.localStorage.removeItem(INBOX_STORAGE_KEY);
          migrated = true;
        }
        if (!serverNotes.some((note) => note.kind === 'daily_focus' && note.day === day) && localFocus) {
          await workbenchStateApi.saveNote({ kind: 'daily_focus', content: localFocus, day });
          window.localStorage.removeItem(FOCUS_STORAGE_KEY);
          migrated = true;
        }
        if (!serverNotes.some((note) => note.kind === 'daily_goal' && note.day === day) && localGoal) {
          await workbenchStateApi.saveNote({ kind: 'daily_goal', content: localGoal, day });
          window.localStorage.removeItem(GOAL_STORAGE_KEY);
          migrated = true;
        }
        if (migrated) {
          [serverTodos, serverNotes] = await Promise.all([
            workbenchStateApi.listCalendarTodos(),
            workbenchStateApi.listNotes(),
          ]);
        }
        if (cancelled) return;
        setCalendarTodos(serverTodos);
        setInboxNotes(serverNotes.filter((note) => note.kind === 'inbox').map((note) => ({
          id: note.id, text: note.content, createdAt: note.createdAt,
        })));
        setFocus(serverNotes.find((note) => note.kind === 'daily_focus' && note.day === day)?.content || '');
        setGoal(serverNotes.find((note) => note.kind === 'daily_goal' && note.day === day)?.content || '');
        setStateError(null);
      } catch (cause) {
        if (!cancelled) setStateError(cause instanceof Error ? cause.message : '加载首页计划失败');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const startAssistant = useCallback((prompt: string, entity?: WorkbenchEntity) => {
    void onCommand?.({
      prompt,
      ...(entity ? { entity } : {}),
      skills: ['medhelp-workbench-review'],
    });
  }, [onCommand]);

  const savePlan = useCallback(() => {
    const day = toLocalDateKey(new Date());
    void Promise.all([
      workbenchStateApi.saveNote({ kind: 'daily_focus', content: focus, day }),
      workbenchStateApi.saveNote({ kind: 'daily_goal', content: goal, day }),
    ]).then(() => {
      setStateError(null);
      setPlanSaved(true);
      window.setTimeout(() => setPlanSaved(false), 1800);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '保存今日计划失败'));
  }, [focus, goal]);

  const saveInboxNote = useCallback(() => {
    const text = inboxDraft.trim();
    if (!text) return;
    void workbenchStateApi.saveNote({ kind: 'inbox', content: text }).then((note) => {
      setInboxNotes((current) => [{ id: note.id, text: note.content, createdAt: note.createdAt }, ...current]);
      setInboxDraft('');
      setStateError(null);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '保存快速记录失败'));
  }, [inboxDraft]);

  const deleteInboxNote = useCallback((id: string) => {
    void workbenchStateApi.deleteNote(id).then(() => {
      setInboxNotes((current) => current.filter((note) => note.id !== id));
      setStateError(null);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '删除快速记录失败'));
  }, []);

  const addCalendarTodo = useCallback((date: string, title: string) => {
    void workbenchStateApi.createCalendarTodo({ title, date }).then((todo) => {
      setCalendarTodos((current) => [...current, todo]);
      setStateError(null);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '新增日历待办失败'));
  }, []);

  const toggleCalendarTodo = useCallback(async (id: string) => {
    const todo = calendarTodos.find((item) => item.id === id);
    if (!todo) return;
    try {
      const updated = await workbenchStateApi.updateCalendarTodo(id, { completed: !todo.completed });
      setCalendarTodos((current) => current.map((item) => item.id === id ? updated : item));
      setStateError(null);
    } catch (cause) {
      setStateError(cause instanceof Error ? cause.message : '更新日历待办失败');
    }
  }, [calendarTodos]);

  /** Research tasks live in Taskmaster or the meeting log, so completing one has to round-trip. */
  const toggleResearchTask = useCallback(async (task: ResearchTask, done: boolean) => {
    try {
      await api.setTaskDone(task, done);
      setStateError(null);
      await refreshSnapshot();
    } catch (cause) {
      setStateError(cause instanceof Error ? cause.message : '更新科研任务失败');
    }
  }, [api, refreshSnapshot]);

  const deleteCalendarTodo = useCallback((id: string) => {
    void workbenchStateApi.deleteCalendarTodo(id).then(() => {
      setCalendarTodos((current) => current.filter((todo) => todo.id !== id));
      setStateError(null);
    }).catch((cause) => setStateError(cause instanceof Error ? cause.message : '删除日历待办失败'));
  }, []);

  const openTasks = useMemo(() => selectOpenTasks(snapshot.tasks), [snapshot.tasks]);
  const activeRuns = useMemo(() => selectActiveAgentRuns(snapshot.agentRuns), [snapshot.agentRuns]);
  const nextMeeting = useMemo(() => selectNextMeeting(snapshot.meetings, now), [snapshot.meetings, now]);
  const unreadLiterature = useMemo<LiteratureAlert[]>(
    () => snapshot.literatureAlerts.filter((item) => !item.read).sort((left, right) => right.relevanceScore - left.relevanceScore),
    [snapshot.literatureAlerts],
  );

  const runningAgentCount = activeRuns.filter((run) => run.status === 'running').length;
  const overdueTasks = openTasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime());

  const signals = useMemo<HomeSignal[]>(() => {
    const items: HomeSignal[] = [];

    if (overdueTasks.length > 0) {
      items.push({
        id: 'overdue-tasks',
        icon: <AlarmClock className="h-3.5 w-3.5" />,
        tone: 'danger',
        title: `${overdueTasks.length} 项任务已逾期`,
        meta: overdueTasks[0].title,
        onClick: () => onNavigate('chat'),
      });
    }

    if (todayStatus && !todayStatus.reviewCompleted) {
      items.push({
        id: 'daily-review',
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
        tone: 'primary',
        title: '今天还没有复盘',
        meta: todayStatus.habitTotal > 0
          ? `习惯 ${todayStatus.habitCompleted}/${todayStatus.habitTotal} · 记录今日结论`
          : '记录今日结论',
        onClick: () => onNavigate('dailyReview'),
      });
    } else if (todayStatus && todayStatus.habitTotal > todayStatus.habitCompleted) {
      items.push({
        id: 'habits',
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
        tone: 'evidence',
        title: `习惯还差 ${todayStatus.habitTotal - todayStatus.habitCompleted} 项`,
        meta: `今天已完成 ${todayStatus.habitCompleted}/${todayStatus.habitTotal}`,
        onClick: () => onNavigate('dailyReview'),
      });
    }

    snapshot.submissions
      .filter((submission) => ATTENTION_SUBMISSION_STATUSES.includes(submission.status))
      .slice(0, 2)
      .forEach((submission) => {
        items.push({
          id: `submission-${submission.id}`,
          icon: <FileCheck2 className="h-3.5 w-3.5" />,
          tone: submission.status === 'rejected' ? 'danger' : 'warning',
          title: `${submission.journal} · ${SUBMISSION_STATUS_LABEL[submission.status]}`,
          meta: submission.nextAction
            || (submission.deadline ? `截止 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(submission.deadline))}` : '查看投稿进度'),
          onClick: () => onNavigate('submissions'),
        });
      });

    snapshot.advisorActions
      .filter((action) => action.status === 'open' || action.status === 'in_progress')
      .slice(0, 2)
      .forEach((action) => {
        items.push({
          id: `advisor-${action.id}`,
          icon: <MessageSquareText className="h-3.5 w-3.5" />,
          tone: action.priority === 'urgent' ? 'danger' : 'primary',
          title: action.title,
          meta: action.nextAction || `${action.advisorName || '导师'}交办 · ${action.status === 'in_progress' ? '进行中' : '待处理'}`,
          onClick: () => onNavigate('advisor'),
        });
      });

    activeRuns
      .filter((run) => run.status === 'waiting_for_user')
      .slice(0, 2)
      .forEach((run) => {
        items.push({
          id: `run-${run.id}`,
          icon: <Bot className="h-3.5 w-3.5" />,
          tone: 'warning',
          title: run.displayName,
          meta: run.nextAction || '等待你的确认后继续',
          onClick: () => onNavigate('automation'),
        });
      });

    snapshot.automationJobs
      .filter((job) => job.status === 'error')
      .slice(0, 1)
      .forEach((job) => {
        items.push({
          id: `job-${job.id}`,
          icon: <CircleAlert className="h-3.5 w-3.5" />,
          tone: 'danger',
          title: `${job.name} 运行失败`,
          meta: job.description || '检查自动化任务配置',
          onClick: () => onNavigate('automation'),
        });
      });

    if (unreadLiterature.length > 0) {
      items.push({
        id: 'literature',
        icon: <Newspaper className="h-3.5 w-3.5" />,
        tone: 'evidence',
        title: `${unreadLiterature.length} 篇待读文献`,
        meta: unreadLiterature[0].title,
        onClick: () => onNavigate('news'),
      });
    }

    if (runningAgentCount > 0) {
      items.push({
        id: 'running-agents',
        icon: <Bot className="h-3.5 w-3.5" />,
        tone: 'primary',
        title: `${runningAgentCount} 个 Agent 正在推进`,
        meta: '查看连续科研进度',
        onClick: () => onNavigate('automation'),
      });
    }

    return items.slice(0, 6);
  }, [
    activeRuns, onNavigate, overdueTasks, runningAgentCount, snapshot.advisorActions,
    snapshot.automationJobs, snapshot.submissions, todayStatus, unreadLiterature,
  ]);

  const quickLinks = useMemo<QuickLink[]>(() => ([
    { key: 'dailyReview', label: '每日复盘', icon: <ClipboardCheck className="h-3.5 w-3.5" />, tab: 'dailyReview' as AppTab },
    { key: 'thesis', label: '毕业论文', icon: <BookOpenCheck className="h-3.5 w-3.5" />, tab: 'thesis' as AppTab },
    { key: 'submissions', label: '投稿中心', icon: <FileCheck2 className="h-3.5 w-3.5" />, tab: 'submissions' as AppTab },
    { key: 'meetings', label: '组会日常', icon: <Presentation className="h-3.5 w-3.5" />, tab: 'meetings' as AppTab },
    { key: 'advisor', label: '导师事项', icon: <MessageSquareText className="h-3.5 w-3.5" />, tab: 'advisor' as AppTab },
    { key: 'automation', label: '自动化', icon: <Bot className="h-3.5 w-3.5" />, tab: 'automation' as AppTab },
    { key: 'news', label: '文献追踪', icon: <Newspaper className="h-3.5 w-3.5" />, tab: 'news' as AppTab },
    { key: 'skills', label: '技能中心', icon: <Sparkles className="h-3.5 w-3.5" />, tab: 'skills' as AppTab },
    { key: 'chat', label: '分析工作台', icon: <Target className="h-3.5 w-3.5" />, tab: 'chat' as AppTab },
  ])
    .filter((link) => isAppTabVisible(link.tab))
    .map(({ tab, ...link }) => ({ ...link, onClick: () => onNavigate(tab) })), [onNavigate]);

  return (
    <WorkbenchPage fill onMenuClick={onMenuClick}>
      {/* On xl the page stops scrolling: the hero and the quick links keep their natural height and
          the two-column grid claims the rest, so each column scrolls on its own. */}
      <div className="flex min-h-0 flex-col gap-3 pb-6 xl:h-full xl:pb-0">
        <HomeHero
          className="min-w-0 flex-shrink-0"
          now={now}
          focus={focus}
          goal={goal}
          onFocusChange={setFocus}
          onGoalChange={setGoal}
          onSave={savePlan}
          saved={planSaved}
          runningAgentCount={runningAgentCount}
          isSyncing={isLoading}
          syncError={error || stateError}
          onOpenChat={() => (projects[0] ? onNavigate('chat') : startAssistant('今天我最应该先处理什么？'))}
        />

        {/* grid-rows pins the single xl row to the container height; without it the row would
            size to its tallest column and overflow instead of letting each column scroll. */}
        <div className="grid min-h-0 grid-cols-1 gap-3 xl:flex-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(272px,1fr)] xl:grid-rows-[minmax(0,1fr)] xl:items-stretch xl:overflow-hidden">
          <div className="flex min-w-0 flex-col xl:h-full xl:min-h-0 xl:overflow-hidden">
            <HomeToday
              now={now}
              status={todayStatus}
              logs={attendanceLogs}
              focusSessions={focusSessions}
              tasks={openTasks}
              todos={calendarTodos}
              dailyFocus={focus}
              onRefresh={refreshTodayStatus}
              onAddTodo={addCalendarTodo}
              onToggleTodo={toggleCalendarTodo}
              onDeleteTodo={deleteCalendarTodo}
              onToggleTask={toggleResearchTask}
              onOpenTasks={() => onNavigate('chat')}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-gutter:stable]">
            <div className="flex-none">
              <NextMeetingCard
                meeting={nextMeeting}
                now={now}
                onPrepare={() => startAssistant(
                  nextMeeting ? `帮我准备「${nextMeeting.title}」的汇报提纲和幻灯片要点` : '帮我准备下一次组会汇报',
                  nextMeeting ? { kind: 'meeting', id: nextMeeting.id } : undefined,
                )}
                onOpenMeetings={() => onNavigate('meetings')}
              />
            </div>

            <Panel className="flex-none">
              <PanelHead
                icon={<CircleAlert className="h-3.5 w-3.5" />}
                title="需要关注"
                hint="逾期、复盘、投稿、导师与文献的待处理信号"
              />
              <SignalList signals={signals} />
            </Panel>

            <Panel className="xl:flex-[1_0_auto]">
              <PanelHead
                icon={<FilePenLine className="h-3.5 w-3.5" />}
                title="快速记录"
                hint="先记下来，再决定是否转成任务"
                action={<span className="flex-shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">{inboxNotes.length} 条</span>}
              />
              <HomeInbox
                draft={inboxDraft}
                notes={inboxNotes}
                onDraftChange={setInboxDraft}
                onSave={saveInboxNote}
                onDelete={deleteInboxNote}
                onSendToAssistant={(note) => startAssistant(note.text)}
              />
            </Panel>
          </div>
        </div>

        {quickLinks.length > 0 && (
          <div className="w-full flex-shrink-0">
            <QuickLinkRow links={quickLinks} className="xl:flex-nowrap" />
          </div>
        )}
      </div>
    </WorkbenchPage>
  );
}
