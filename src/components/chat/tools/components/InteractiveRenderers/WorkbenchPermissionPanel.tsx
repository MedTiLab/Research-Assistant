import React from 'react';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';

const labels: Record<string, string> = {
  meeting_create: '创建组会', meeting_update: '修改组会', agenda_add: '添加议程',
  agenda_update: '修改议程', note_add: '保存会议纪要草稿', note_promote: '将意见转为待办',
  action_create: '创建行动项', action_update: '修改行动项',
  action_promote_task: '将行动项转为项目任务', transcript_update: '修正转写内容',
  calendar_create: '创建日历待办', calendar_update: '修改日历待办',
  thesis_create: '创建毕业论文记录', thesis_update: '更新毕业论文进度',
  thesis_chapter_add: '添加论文章节', thesis_chapter_update: '更新论文章节',
  thesis_milestone_add: '添加论文里程碑', thesis_milestone_update: '更新论文里程碑', thesis_log_add: '记录论文推进',
  submission_create: '登记投稿', submission_update: '更新投稿状态', daily_review_save: '保存每日复盘',
  attendance_start: '开始工作打卡', attendance_end: '结束工作打卡', focus_log: '记录专注时长',
  habit_create: '创建习惯', habit_entry_update: '更新习惯完成状态',
};

function toolSuffix(toolName: string) {
  return toolName.split('__').at(-1) || toolName;
}

function displayRows(toolName: string, input: Record<string, unknown>) {
  const name = toolSuffix(toolName);
  const preferredFields = name === 'meeting_create'
    ? [['title', '标题'], ['meetingDate', '时间'], ['meetingType', '类型'], ['myRole', '我的角色']]
    : name === 'note_promote'
      ? [['content', '将生成的行动项'], ['dueDate', '截止日期'], ['noteId', '来源纪要']]
      : [
          ['content', '内容'], ['title', '标题'], ['meetingDate', '时间'], ['dueDate', '截止日期'],
          ['status', '状态'], ['meetingId', '会议'], ['noteId', '纪要'], ['actionId', '行动项'],
          ['agendaId', '议程'], ['segmentId', '转写分片'],
          ['thesisId', '毕业论文'], ['chapterId', '论文章节'], ['milestoneId', '论文里程碑'],
          ['submissionId', '投稿记录'], ['journal', '期刊'], ['date', '日期'], ['minutes', '分钟'],
          ['words', '字数'], ['taskTitle', '专注任务'], ['habitId', '习惯'], ['accomplishments', '今日完成'],
          ['obstacles', '卡点'], ['insights', '洞察'], ['tomorrowPriorities', '明日重点'],
        ];
  return preferredFields.flatMap(([key, label]) => {
    const value = input[key];
    return value === undefined || value === null || value === ''
      ? []
      : [{ key, label, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }];
  });
}

export default function WorkbenchPermissionPanel({ request, onDecision }: PermissionPanelProps) {
  const input = request.input && typeof request.input === 'object' && !Array.isArray(request.input)
    ? request.input as Record<string, unknown>
    : {};
  const suffix = toolSuffix(request.toolName);
  const rows = displayRows(request.toolName, input);
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h3 className="font-semibold text-amber-950 dark:text-amber-100">确认工作台写入：{labels[suffix] || suffix}</h3>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">这次批准只对当前写入生效，不会记住或自动批准后续操作。</p>
      <dl className="my-3 space-y-2 rounded-lg border border-amber-200 bg-white/70 p-3 text-sm dark:border-amber-900 dark:bg-black/20">
        {rows.length > 0 ? rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-words whitespace-pre-wrap">{row.value}</dd>
          </div>
        )) : <div className="text-muted-foreground">未提供可展示的字段，请拒绝并让 Agent 补充明确内容。</div>}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700" onClick={() => onDecision(request.requestId, { allow: true })}>确认本次写入</button>
        <button type="button" className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/30" onClick={() => onDecision(request.requestId, { allow: false, message: 'User denied workbench mutation' })}>取消</button>
      </div>
    </section>
  );
}
