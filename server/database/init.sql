-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_id TEXT,
    avatar_url TEXT,
    notification_email TEXT,
    display_name TEXT,
    full_name TEXT,
    institution TEXT,
    organization TEXT,
    academic_title TEXT,
    research_field TEXT,
    usage_purpose TEXT,
    google_scholar_url TEXT,
    website_url TEXT,
    orcid TEXT,
    about_you TEXT,
    analysis_language_preference TEXT DEFAULT 'auto',
    membership_plan TEXT DEFAULT 'free',
    membership_expires_at DATETIME,
    device_limit_override INTEGER,
    device_overflow_policy TEXT,
    current_project_count INTEGER,
    current_project_count_updated_at DATETIME,
    trial_started_at DATETIME,
    trial_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    workspace_root TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 1,
    memory_enabled BOOLEAN DEFAULT 1,
    accepted_legal_terms BOOLEAN DEFAULT 0,
    accepted_legal_terms_at DATETIME,
    accepted_legal_terms_version TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

CREATE TABLE IF NOT EXISTS auth_device_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    device_fingerprint_hash TEXT NOT NULL,
    device_label TEXT,
    refresh_token_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    refresh_expires_at DATETIME,
    revoked_at DATETIME,
    revoked_reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    client_type TEXT,
    client_version TEXT,
    client_platform TEXT,
    counts_as_device INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_user_active
ON auth_device_sessions(user_id, revoked_at, refresh_expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_fingerprint
ON auth_device_sessions(user_id, device_fingerprint_hash);

CREATE TABLE IF NOT EXISTS registration_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    notification_email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    accepted_legal_terms BOOLEAN DEFAULT 0,
    accepted_legal_terms_at DATETIME,
    accepted_legal_terms_version TEXT,
    review_note TEXT,
    reviewed_by TEXT,
    review_token_hash TEXT,
    request_ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_registration_requests_username ON registration_requests(username);
CREATE INDEX IF NOT EXISTS idx_registration_requests_email ON registration_requests(notification_email);
CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_username
ON registration_requests(username) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_email
ON registration_requests(notification_email) WHERE status = 'pending';

-- Lightweight user preference memory for cross-session personalization
CREATE TABLE IF NOT EXISTS user_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    scope TEXT DEFAULT 'user',
    project_path TEXT,
    project_key TEXT,
    is_enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_enabled ON user_memories(user_id, is_enabled);

-- API Keys table for external API access
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- User credentials table for storing various tokens/credentials (GitHub, GitLab, etc.)
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

-- Local Kernel accounts are authenticated by the cloud. Their IDs must never
-- be treated as local users(id), even when the numeric IDs happen to match.
CREATE TABLE IF NOT EXISTS local_pi_provider_settings (
    cloud_user_id INTEGER PRIMARY KEY CHECK (cloud_user_id > 0),
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_pi_provider_credentials (
    cloud_user_id INTEGER NOT NULL CHECK (cloud_user_id > 0),
    provider_id TEXT NOT NULL,
    credential_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cloud_user_id, provider_id)
);

-- Keep the 1.1.20 session tables intact. Newer kernels store runtime-aware
-- identities in sidecar v2 tables created by the JavaScript migration. Keeping
-- these legacy names and columns allows an installed 1.1.20 kernel to open a
-- database after a newer development/release kernel has migrated it.
CREATE TABLE IF NOT EXISTS session_metadata (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    display_name TEXT,
    last_activity DATETIME,
    message_count INTEGER DEFAULT 0,
    is_starred BOOLEAN DEFAULT 0,
    metadata TEXT, -- JSON storage for extra runtime-specific data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_metadata_project ON session_metadata(project_name);
CREATE INDEX IF NOT EXISTS idx_session_metadata_provider ON session_metadata(provider);

CREATE TABLE IF NOT EXISTS project_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    tag_key TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_name, tag_type, tag_key)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_name);
CREATE INDEX IF NOT EXISTS idx_project_tags_type ON project_tags(tag_type);

CREATE TABLE IF NOT EXISTS session_tag_links (
    session_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    linked_by TEXT,
    source TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, tag_id),
    FOREIGN KEY (session_id) REFERENCES session_metadata(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_tag_links_session ON session_tag_links(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tag_links_tag ON session_tag_links(tag_id);

-- Projects table for unified management across all providers
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    display_name TEXT,
    path TEXT NOT NULL,
    is_starred BOOLEAN DEFAULT 0,
    last_accessed DATETIME,
    metadata TEXT, -- JSON for provider-specific info
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

CREATE TABLE IF NOT EXISTS project_activity_events (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    project_path TEXT,
    event_type TEXT NOT NULL DEFAULT 'project_open',
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata_json TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_activity_user_time ON project_activity_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_project_activity_user_project ON project_activity_events(user_id, project_id);

-- Research Secretary: meeting loop v1
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    meeting_date TEXT NOT NULL,
    meeting_type TEXT NOT NULL CHECK(meeting_type IN ('group', 'one_on_one', 'journal_club', 'progress')),
    my_role TEXT NOT NULL CHECK(my_role IN ('presenter', 'attendee')),
    location TEXT,
    project_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('upcoming', 'in_progress', 'done')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_user_date ON meetings(user_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_meetings_user_status ON meetings(user_id, status);

CREATE TABLE IF NOT EXISTS meeting_agenda_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('my_report', 'carryover_action', 'question_for_advisor', 'literature')),
    title TEXT NOT NULL,
    detail TEXT,
    source_ref TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_meeting_order ON meeting_agenda_items(meeting_id, order_index);

CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    start_ms INTEGER NOT NULL DEFAULT 0,
    end_ms INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    speaker TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'transcribing', 'done', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(meeting_id, segment_index),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meeting_notes (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    speaker TEXT,
    content TEXT NOT NULL,
    note_type TEXT NOT NULL CHECK(note_type IN ('feedback', 'decision', 'question', 'idea')),
    source_segment_id TEXT,
    promoted_action_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_segment_id) REFERENCES meeting_transcript_segments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting ON meeting_notes(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    source_note_id TEXT,
    content TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'done', 'dropped')),
    owner TEXT NOT NULL DEFAULT 'me',
    task_id TEXT,
    project_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_note_id) REFERENCES meeting_notes(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_actions_user_status_due ON meeting_action_items(user_id, status, due_date);

-- Research Secretary: durable calendar and home notes v1
CREATE TABLE IF NOT EXISTS workbench_calendar_todos (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    project_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workbench_calendar_user_date
    ON workbench_calendar_todos(user_id, date);

CREATE TABLE IF NOT EXISTS workbench_notes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('inbox', 'daily_focus', 'daily_goal')),
    content TEXT NOT NULL,
    day TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workbench_notes_user_kind
    ON workbench_notes(user_id, kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workbench_notes_user_kind_day
    ON workbench_notes(user_id, kind, day) WHERE day IS NOT NULL;

-- Research Secretary: thesis and submission tracking v1
CREATE TABLE IF NOT EXISTS research_theses (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    degree TEXT NOT NULL DEFAULT '博士',
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning', 'writing', 'review', 'submitted', 'completed')),
    completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_research_theses_user_updated ON research_theses(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_thesis_chapters (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started', 'drafting', 'review', 'done')),
    completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
    order_index INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_thesis_chapters_order ON research_thesis_chapters(thesis_id, order_index, created_at);

CREATE TABLE IF NOT EXISTS research_thesis_milestones (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_thesis_milestones_due ON research_thesis_milestones(thesis_id, status, due_date);

CREATE TABLE IF NOT EXISTS research_thesis_logs (
    id TEXT PRIMARY KEY,
    thesis_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes >= 0),
    words INTEGER NOT NULL DEFAULT 0 CHECK(words >= 0),
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_thesis_logs_date ON research_thesis_logs(thesis_id, date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS research_manuscripts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    short_title TEXT,
    status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting', 'internal_review', 'ready', 'submitted', 'revision', 'published')),
    target_journal TEXT,
    completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_research_manuscripts_user_updated ON research_manuscripts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_submissions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    manuscript_id TEXT NOT NULL,
    project_id TEXT,
    journal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'journal_selected', 'presubmission_check', 'submitted', 'with_editor', 'under_review', 'minor_revision', 'major_revision', 'rejected', 'resubmitted', 'accepted', 'proof', 'published')),
    previous_status TEXT,
    submitted_at TEXT,
    status_changed_at TEXT,
    deadline TEXT,
    tracking_code TEXT,
    next_action TEXT,
    documents_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (manuscript_id) REFERENCES research_manuscripts(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_research_submissions_user_status_deadline ON research_submissions(user_id, status, deadline);

CREATE TABLE IF NOT EXISTS workbench_attendance_logs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workbench_attendance_user_date ON workbench_attendance_logs(user_id, date, started_at);

CREATE TABLE IF NOT EXISTS workbench_focus_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    task_title TEXT,
    started_at TEXT,
    ended_at TEXT,
    minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes >= 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workbench_focus_user_date ON workbench_focus_sessions(user_id, date, created_at);

CREATE TABLE IF NOT EXISTS workbench_habits (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workbench_habits_user_enabled ON workbench_habits(user_id, enabled, created_at);

CREATE TABLE IF NOT EXISTS workbench_habit_entries (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    value TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (habit_id) REFERENCES workbench_habits(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_workbench_habit_entries_user_date ON workbench_habit_entries(user_id, date);

CREATE TABLE IF NOT EXISTS workbench_daily_reviews (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    accomplishments TEXT NOT NULL DEFAULT '',
    obstacles TEXT NOT NULL DEFAULT '',
    insights TEXT NOT NULL DEFAULT '',
    tomorrow_priorities_json TEXT NOT NULL DEFAULT '[]',
    mood INTEGER CHECK(mood BETWEEN 1 AND 5),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_workbench_daily_reviews_user_date ON workbench_daily_reviews(user_id, date DESC);

CREATE TABLE IF NOT EXISTS meeting_attachments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('recording', 'slides', 'transcript', 'handout')),
    file_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_attachments_meeting ON meeting_attachments(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_reminder_deliveries (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('meeting', 'action')),
    source_id TEXT NOT NULL,
    reminder_key TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, source_type, source_id, reminder_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_reminders_user_status_schedule
ON meeting_reminder_deliveries(user_id, status, scheduled_for);

CREATE TABLE IF NOT EXISTS gateway_usage_events (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    capability TEXT NOT NULL,
    plan TEXT,
    status TEXT NOT NULL,
    code TEXT,
    resource_owner_id TEXT,
    source TEXT,
    units INTEGER DEFAULT 0,
    device_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gateway_usage_user_time ON gateway_usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gateway_usage_capability_time ON gateway_usage_events(capability, created_at);

CREATE TABLE IF NOT EXISTS gateway_quota_counters (
    user_id INTEGER NOT NULL,
    capability TEXT NOT NULL,
    period_key TEXT NOT NULL,
    used_units INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, capability, period_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gateway_quota_user ON gateway_quota_counters(user_id, period_key);

CREATE TABLE IF NOT EXISTS gateway_devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    device_fingerprint TEXT NOT NULL,
    label TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    is_active BOOLEAN DEFAULT 1,
    UNIQUE(user_id, device_fingerprint),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gateway_devices_user ON gateway_devices(user_id, is_active);

CREATE TABLE IF NOT EXISTS conversation_share_links (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    session_key TEXT,
    owner_key TEXT,
    project_key TEXT,
    runtime_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    title TEXT,
    snapshot_json TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_share_links_user ON conversation_share_links(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_share_links_session ON conversation_share_links(project_name, session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_share_links_visibility ON conversation_share_links(visibility);

-- Account-scoped, privacy-filtered conversation archive for cross-device web access.
CREATE TABLE IF NOT EXISTS account_conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    session_key TEXT,
    owner_key TEXT,
    project_key TEXT,
    runtime_id TEXT,
    title TEXT NOT NULL,
    project_label TEXT,
    messages_json TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, session_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_conversations_user_updated
ON account_conversations(user_id, updated_at);

CREATE TABLE IF NOT EXISTS feedback_submissions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT,
    project_path TEXT,
    session_id TEXT,
    provider TEXT,
    session_key TEXT,
    owner_key TEXT,
    project_key TEXT,
    runtime_id TEXT,
    message TEXT NOT NULL,
    contact TEXT,
    page_url TEXT,
    user_agent TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    email_notified_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user ON feedback_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status ON feedback_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_session ON feedback_submissions(project_name, session_id);

CREATE TABLE IF NOT EXISTS auto_research_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    status TEXT NOT NULL,
    session_id TEXT,
    session_key TEXT,
    owner_key TEXT,
    project_key TEXT,
    runtime_id TEXT,
    current_task_id TEXT,
    completed_tasks INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 0,
    error TEXT,
    metadata TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    email_sent_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_research_runs_user ON auto_research_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_project ON auto_research_runs(project_name);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_status ON auto_research_runs(status);

-- Durable execution queue shared by Claude, Codex, and Pi runtimes. Runtime
-- credentials and callback functions are deliberately never stored here.
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    project_key TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    command_preview TEXT,
    request_json TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK(status IN ('queued', 'running', 'completed', 'failed', 'parked', 'cancelled')),
    worker_id TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    retryable INTEGER NOT NULL DEFAULT 1,
    recovery_policy TEXT NOT NULL DEFAULT 'park'
      CHECK(recovery_policy IN ('park', 'retry')),
    result_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_claim
ON agent_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_lease
ON agent_runs(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_owner
ON agent_runs(owner_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session
ON agent_runs(session_key, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Account-scoped application settings that must follow the signed-in user.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

-- Account-bound PubMed variable discovery UI state
CREATE TABLE IF NOT EXISTS pubmed_discovery_state (
    user_id INTEGER NOT NULL,
    state_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, state_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pubmed_discovery_state_user ON pubmed_discovery_state(user_id);

-- References (literature) cache table
CREATE TABLE IF NOT EXISTS references_library (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    abstract TEXT,
    doi TEXT,
    url TEXT,
    journal TEXT,
    item_type TEXT DEFAULT 'article',
    source TEXT DEFAULT 'zotero',
    source_id TEXT,
    keywords TEXT,
    citation_key TEXT,
    pdf_cached INTEGER DEFAULT 0,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_references_user ON references_library(user_id);
CREATE INDEX IF NOT EXISTS idx_references_source_id ON references_library(source_id);
CREATE INDEX IF NOT EXISTS idx_references_doi ON references_library(doi);

-- Reference ↔ Project many-to-many
CREATE TABLE IF NOT EXISTS project_references (
    project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, reference_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);

-- Reference tags
CREATE TABLE IF NOT EXISTS reference_tags (
    reference_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    UNIQUE(reference_id, tag),
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_tags_ref ON reference_tags(reference_id);

-- Structured clinical concepts curated from literature and manual review
CREATE TABLE IF NOT EXISTS clinical_concepts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    concept_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    display_name TEXT,
    aliases_json TEXT,
    description TEXT,
    ontology_source TEXT,
    ontology_id TEXT,
    status TEXT DEFAULT 'reviewed',
    source_strategy TEXT DEFAULT 'manual',
    metadata_json TEXT,
    first_seen_at DATETIME,
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clinical_concepts_user ON clinical_concepts(user_id);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_type ON clinical_concepts(concept_type);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_status ON clinical_concepts(status);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_name ON clinical_concepts(canonical_name);

-- Evidence records connecting concepts to references and project context
CREATE TABLE IF NOT EXISTS concept_evidence (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    reference_id TEXT,
    project_id TEXT,
    evidence_type TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    evidence_location TEXT,
    direction TEXT DEFAULT 'supporting',
    evidence_level TEXT DEFAULT 'moderate',
    extraction_confidence REAL,
    review_status TEXT DEFAULT 'accepted',
    review_note TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (concept_id) REFERENCES clinical_concepts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_concept_evidence_concept ON concept_evidence(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_evidence_user ON concept_evidence(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_evidence_reference ON concept_evidence(reference_id);

-- Literature-monitor runs used to create candidate concepts from news / alerts
CREATE TABLE IF NOT EXISTS monitor_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    trigger_type TEXT DEFAULT 'news_ingest',
    status TEXT DEFAULT 'completed',
    item_title TEXT,
    reference_id TEXT,
    project_id TEXT,
    candidate_count INTEGER DEFAULT 0,
    metadata_json TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_user ON monitor_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_source ON monitor_runs(source_key);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_reference ON monitor_runs(reference_id);

-- Candidate indicators / diseases / stratifiers extracted from monitored literature
CREATE TABLE IF NOT EXISTS monitor_candidates (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    run_id TEXT,
    reference_id TEXT,
    project_id TEXT,
    source_key TEXT,
    candidate_type TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    display_name TEXT,
    summary TEXT,
    rationale TEXT,
    confidence REAL,
    status TEXT DEFAULT 'pending',
    merged_concept_id TEXT,
    review_note TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (merged_concept_id) REFERENCES clinical_concepts(id) ON DELETE SET NULL,
    UNIQUE(user_id, reference_id, candidate_type, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_monitor_candidates_user ON monitor_candidates(user_id);
CREATE INDEX IF NOT EXISTS idx_monitor_candidates_status ON monitor_candidates(status);
CREATE INDEX IF NOT EXISTS idx_monitor_candidates_run ON monitor_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_monitor_candidates_reference ON monitor_candidates(reference_id);

-- User-curated “report preview” entries for the research library (from Research Lab file preview)
CREATE TABLE IF NOT EXISTS med_library_report_preview (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    project_display_name TEXT,
    relative_path TEXT NOT NULL,
    title TEXT,
    kb_upload_relative_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, project_name, relative_path),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ml_report_preview_user ON med_library_report_preview(user_id);

CREATE TABLE IF NOT EXISTS med_library_core_rules (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    rule_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    trigger TEXT,
    correct_pattern TEXT,
    stage_hints_json TEXT,
    severity TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'confirmed',
    source_kind TEXT DEFAULT 'lesson',
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, rule_slug),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ml_core_rules_user ON med_library_core_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_core_rules_status ON med_library_core_rules(user_id, status);

CREATE TABLE IF NOT EXISTS med_library_operating_assets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    asset_type TEXT NOT NULL,
    title TEXT NOT NULL,
    stage_key TEXT,
    stage_label TEXT,
    description TEXT,
    content_json TEXT NOT NULL,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_user ON med_library_operating_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_type ON med_library_operating_assets(user_id, asset_type);

-- Account-scoped desktop companions. A companion owns its own memories and
-- window preference; the Electron shell treats desktop_enabled as the desired
-- native-window state.
CREATE TABLE IF NOT EXISTS companions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT 'mochi',
    persona TEXT NOT NULL DEFAULT '',
    desktop_enabled INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    mood TEXT NOT NULL DEFAULT 'calm',
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_companions_user ON companions(user_id, created_at);

CREATE TABLE IF NOT EXISTS companion_memories (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    companion_id TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'note',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (companion_id) REFERENCES companions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_companion_memories_owner
    ON companion_memories(user_id, companion_id, created_at DESC);

-- Single-file mini apps. HTML is deliberately stored as an immutable-style
-- published snapshot; the renderer executes it only inside an opaque sandbox.
CREATE TABLE IF NOT EXISTS mini_apps (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mini_apps_user ON mini_apps(user_id, updated_at DESC);
