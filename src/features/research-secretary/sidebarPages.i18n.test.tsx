import { describe, expect, it, vi } from 'vitest';
import ThesisCenter from './thesis/ThesisCenter';
import AdvisorActionCenter from './advisor/AdvisorActionCenter';
import MeetingCenter from './meetings/MeetingCenter';
import AutomationCenter from './automation/AutomationCenter';
import SubmissionCard from './submissions/SubmissionCard';
import ActionItemBoard from './meetings/ActionItemBoard';
import TranscriptPane from './meetings/TranscriptPane';
import MeetingSummaryDraftPanel from './meetings/MeetingSummaryDraftPanel';
import MeetingRecorder from './meetings/MeetingRecorder';
import { createWorkbenchI18n, renderWorkbench } from './renderWithI18n';
import type { Submission } from './domain/types';

vi.mock('./services/researchTrackingApi', () => ({
  researchTrackingApi: {
    listTheses: () => Promise.resolve([]),
    getThesis: () => Promise.resolve(null),
    listSubmissions: () => Promise.resolve({ submissions: [], manuscripts: [] }),
  },
}));

vi.mock('./services/useResearchSecretarySnapshot', () => ({
  useResearchSecretarySnapshot: () => ({
    api: {},
    snapshot: {
      tasks: [], theses: [], manuscripts: [], submissions: [], advisorActions: [], meetings: [], presentations: [],
      literatureAlerts: [], artifacts: [], agentRuns: [], automationJobs: [], automationRuns: [],
    },
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('./services/automationsApi', () => ({
  listAutomationRecords: () => Promise.resolve({ records: [], failures: [] }),
  listAutomationModels: () => Promise.resolve([]),
  automationRequestJson: () => Promise.resolve({}),
}));

const submission: Submission = {
  id: 'sub-1',
  projectId: '',
  manuscriptId: 'ms-1',
  journal: 'Nature Medicine',
  status: 'draft',
  previousStatus: 'journal_selected',
  documents: [{ kind: 'manuscript', label: 'Manuscript', ready: true }],
};

describe('sidebar workbench localization', () => {
  it('renders English chrome for remaining sidebar destinations', async () => {
    const i18n = await createWorkbenchI18n('en');

    const thesis = renderWorkbench(<ThesisCenter projects={[]} onMenuClick={() => undefined} />, i18n);
    expect(thesis).toContain('Thesis');
    expect(thesis).toContain('New thesis');
    expect(thesis).not.toContain('毕业论文');
    expect(thesis).not.toContain('新建论文');
    expect(thesis).toContain('Open navigation');
    expect(thesis).not.toContain('打开导航');

    const advisor = renderWorkbench(<AdvisorActionCenter projects={[]} />, i18n);
    expect(advisor).toContain('Advisor actions');
    expect(advisor).toContain('Add item');
    expect(advisor).not.toContain('导师事项');
    expect(advisor).not.toContain('添加事项');

    const meetings = renderWorkbench(<MeetingCenter projects={[]} />, i18n);
    expect(meetings).toContain('Meeting list');
    expect(meetings).toContain('New meeting');
    expect(meetings).not.toContain('组会列表');
    expect(meetings).not.toContain('新建组会');

    const automation = renderWorkbench(<AutomationCenter projects={[]} />, i18n);
    expect(automation).toContain('Automation');
    expect(automation).toContain('New automation');
    expect(automation).not.toContain('自动化');
    expect(automation).not.toContain('新建自动化');

    const card = renderWorkbench(<SubmissionCard submission={submission} projectNames={new Map()} />, i18n);
    expect(card).toContain('Draft');
    expect(card).toContain('Journal selected');
    expect(card).toContain('Submission materials');
    expect(card).not.toContain('草稿');
    expect(card).not.toContain('投稿材料');

    const actions = renderWorkbench(<ActionItemBoard actions={[]} api={{} as never} onChanged={async () => {}} />, i18n);
    expect(actions).toContain('Turn into action item');
    expect(actions).not.toContain('转行动项');

    const transcript = renderWorkbench(<TranscriptPane segments={[]} api={{} as never} onChanged={async () => {}} />, i18n);
    expect(transcript).toContain('Transcription progress');
    expect(transcript).not.toContain('转写进度');

    const summary = renderWorkbench(<MeetingSummaryDraftPanel meeting={{ id: 'm1', title: 'Lab meeting' } as never} api={{} as never} onChanged={async () => {}} />, i18n);
    expect(summary).toContain('Generate notes draft');
    expect(summary).not.toContain('生成纪要草稿');

    const recorder = renderWorkbench(<MeetingRecorder meetingId="m1" api={{} as never} onChanged={async () => {}} />, i18n);
    expect(recorder).toContain('Recording and transcription');
    expect(recorder).toContain('Start recording');
    expect(recorder).not.toContain('录音与中文转写');
    expect(recorder).not.toContain('开始录音');
  });
});
