-- Live schema snapshot of the public tables, read 2026-11-05 from production by the owner
-- (supabase/checks/phase0_readonly.sql, queries 2-4). Reference only: never run this file.
-- It is the baseline for the core tables that have no create statement in supabase/migrations
-- (user_profiles, study_guides, study_sessions, quiz_attempts, user_streaks, folders, smart_notes).
-- Constraints: the editor returned the first 100 rows only; the rest are added from query 6.
-- Tables with row-level security and no policy listed are service-role only.

create table public.app_admins (
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint app_admins_pkey PRIMARY KEY (user_id),
  constraint app_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.assignment_plans (
  user_id uuid not null,
  item_key text not null,
  effort_minutes integer not null,
  effort_basis text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.assignment_steps (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  item_key text not null,
  position smallint not null,
  title text not null,
  minutes integer not null,
  due_at timestamp with time zone,
  done boolean not null default false,
  done_at timestamp with time zone
);

create table public.assistant_link_codes (
  code_hash text not null,
  user_id uuid not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint assistant_link_codes_pkey PRIMARY KEY (code_hash),
  constraint assistant_link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.assistant_links (
  user_id uuid not null,
  assistant_user_id text not null,
  linked_at timestamp with time zone not null default now(),
  constraint assistant_links_assistant_user_id_check CHECK (((char_length(assistant_user_id) >= 1) AND (char_length(assistant_user_id) <= 100))),
  constraint assistant_links_assistant_user_id_key UNIQUE (assistant_user_id),
  constraint assistant_links_pkey PRIMARY KEY (user_id),
  constraint assistant_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.canvas_activity (
  id bigint not null default nextval('canvas_activity_id_seq'::regclass),
  user_id uuid not null,
  endpoint text not null,
  status integer,
  created_at timestamp with time zone not null default now()
);
create policy "Users read own canvas activity" on public.canvas_activity for select to authenticated
  using (user_id = auth.uid());

create table public.canvas_announcements (
  user_id uuid not null,
  canvas_announcement_id bigint not null,
  canvas_course_id bigint not null,
  title text not null default ''::text,
  message text not null default ''::text,
  posted_at timestamp with time zone,
  summary text,
  changes text not null default 'none'::text,
  read_at timestamp with time zone
);

create table public.canvas_assignments (
  user_id uuid not null,
  canvas_assignment_id bigint not null,
  canvas_course_id bigint not null,
  title text not null default ''::text,
  due_at timestamp with time zone,
  submitted boolean not null default false,
  points_possible numeric,
  submission_types text[] not null default '{}'::text[],
  description text,
  rubric jsonb,
  html_url text,
  missing boolean not null default false,
  score numeric,
  is_exam boolean not null default false,
  canvas_updated_at timestamp with time zone,
  first_seen_at timestamp with time zone not null default now()
);
create policy "Users read own canvas assignments" on public.canvas_assignments for select to authenticated
  using (user_id = auth.uid());

create table public.canvas_calendar_connections (
  user_id uuid not null,
  feed_url text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint canvas_calendar_connections_feed_url_check CHECK (((char_length(feed_url) >= 1) AND (char_length(feed_url) <= 2048))),
  constraint canvas_calendar_connections_pkey PRIMARY KEY (user_id),
  constraint canvas_calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.canvas_connections (
  user_id uuid not null,
  canvas_domain text not null,
  school_id uuid,
  status text not null default 'connected'::text,
  sync_paused boolean not null default false,
  last_synced_at timestamp with time zone,
  expiry_reminded_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
create policy "Users read own canvas connection" on public.canvas_connections for select to authenticated
  using (user_id = auth.uid());

create table public.canvas_courses (
  user_id uuid not null,
  canvas_course_id bigint not null,
  name text not null default ''::text,
  course_code text not null default ''::text,
  term text not null default ''::text,
  school_id uuid,
  class_id uuid,
  imported boolean not null default false,
  topic_summary text not null default ''::text,
  current_score numeric,
  current_grade text,
  grade_checked_at timestamp with time zone
);
create policy "Users read own canvas courses" on public.canvas_courses for select to authenticated
  using (user_id = auth.uid());

create table public.canvas_school_policy (
  domain text not null,
  school_name text not null default ''::text,
  tokens_allowed boolean not null default true,
  source_url text,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint canvas_school_policy_domain_check CHECK (((domain = lower(domain)) AND (domain ~ '^[a-z0-9.-]+$'::text))),
  constraint canvas_school_policy_pkey PRIMARY KEY (domain),
  constraint canvas_school_policy_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
create policy "Anyone reads school policy" on public.canvas_school_policy for select to public
  using true;

create table public.canvas_tokens (
  user_id uuid not null,
  ciphertext bytea not null,
  iv bytea not null,
  last4 text not null,
  expires_at date,
  created_at timestamp with time zone not null default now()
);

create table public.class_memberships (
  user_id uuid not null,
  class_term_id uuid not null,
  source text not null,
  created_at timestamp with time zone not null default now(),
  constraint class_memberships_class_term_id_fkey FOREIGN KEY (class_term_id) REFERENCES class_terms(id) ON DELETE CASCADE,
  constraint class_memberships_pkey PRIMARY KEY (user_id, class_term_id),
  constraint class_memberships_source_check CHECK ((source = ANY (ARRAY['canvas'::text, 'calendar'::text, 'manual'::text])))
);
create policy "Users read own memberships" on public.class_memberships for select to authenticated
  using (user_id = auth.uid());

create table public.class_merge_proposals (
  id uuid not null default gen_random_uuid(),
  school_id uuid not null,
  raw_code text not null,
  from_class_id uuid,
  into_class_id uuid,
  confidence numeric not null default 0,
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  reviewed_by uuid,
  reviewed_at timestamp with time zone
);

create table public.class_share_defaults (
  user_id uuid not null,
  class_id uuid not null,
  share boolean not null
);
create policy "Users read own share defaults" on public.class_share_defaults for select to authenticated
  using (user_id = auth.uid());

create table public.class_terms (
  id uuid not null default gen_random_uuid(),
  class_id uuid not null,
  term text not null,
  constraint class_terms_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  constraint class_terms_class_id_term_key UNIQUE (class_id, term),
  constraint class_terms_pkey PRIMARY KEY (id),
  constraint class_terms_term_check CHECK (((char_length(term) >= 1) AND (char_length(term) <= 60)))
);
create policy "Signed-in users read class terms" on public.class_terms for select to authenticated
  using true;

create table public.classes (
  id uuid not null default gen_random_uuid(),
  school_id uuid not null,
  course_code_normalized text not null,
  display_name text not null default ''::text,
  sharing_blocked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  constraint classes_course_code_normalized_check CHECK ((course_code_normalized ~ '^[A-Z&]{1,8} [0-9]{1,4}[A-Z]?$'::text)),
  constraint classes_pkey PRIMARY KEY (id),
  constraint classes_school_id_course_code_normalized_key UNIQUE (school_id, course_code_normalized),
  constraint classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);
create policy "Signed-in users read classes" on public.classes for select to authenticated
  using true;

create table public.connector_links (
  user_id uuid not null,
  connector text not null,
  kind text not null,
  cordia_id text not null,
  external_id text not null,
  container_id text,
  synced_hash text,
  removed_by_student boolean not null default false,
  updated_at timestamp with time zone not null default now()
);

create table public.connector_settings (
  user_id uuid not null,
  connector text not null,
  tutor boolean not null default true,
  assistant boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  container_id text,
  last_synced_at timestamp with time zone,
  last_error text,
  needs_reconnect boolean not null default false,
  stats jsonb not null default '{}'::jsonb
);

create table public.copyright_takedowns (
  id uuid not null default gen_random_uuid(),
  set_id uuid,
  claimant_name text not null,
  claimant_email text not null,
  work_description text not null,
  location text not null default ''::text,
  status text not null default 'received'::text,
  created_at timestamp with time zone not null default now(),
  actioned_at timestamp with time zone
);

create table public.deadline_changes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  source text not null,
  source_id text not null,
  item_key text not null default ''::text,
  kind text not null,
  title text not null default ''::text,
  summary text not null default ''::text,
  sender text not null default ''::text,
  old_due timestamp with time zone,
  new_due timestamp with time zone,
  status text not null default 'pending'::text,
  decided_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table public.deadline_marks (
  user_id uuid not null,
  item_key text not null,
  done boolean not null,
  updated_at timestamp with time zone not null default now()
);

create table public.decision_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid,
  item_id text,
  decision_type text not null,
  policy_version_id text not null,
  source text not null,
  candidates jsonb not null,
  mask_reasons jsonb not null,
  eligible jsonb not null,
  probs jsonb not null,
  chosen text not null,
  propensity double precision not null,
  seed bigint not null,
  context jsonb not null,
  fsrs_before jsonb,
  created_at timestamp with time zone not null default now()
);

create table public.feedback (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  message text not null,
  category text default 'other'::text,
  created_at timestamp with time zone default now(),
  status text not null default 'new'::text,
  page_path text,
  app_version text,
  guide_id text,
  question_id text,
  client_request_id uuid,
  reviewed_by uuid,
  constraint feedback_app_version_length_check CHECK (((app_version IS NULL) OR (char_length(app_version) <= 100))),
  constraint feedback_category_check CHECK ((category = ANY (ARRAY['bug'::text, 'suggestion'::text, 'incorrect_content'::text, 'account_payment'::text, 'other'::text]))),
  constraint feedback_guide_id_length_check CHECK (((guide_id IS NULL) OR (char_length(guide_id) <= 100))),
  constraint feedback_page_path_length_check CHECK (((page_path IS NULL) OR (char_length(page_path) <= 500))),
  constraint feedback_pkey PRIMARY KEY (id),
  constraint feedback_question_id_length_check CHECK (((question_id IS NULL) OR (char_length(question_id) <= 100))),
  constraint feedback_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewing'::text, 'planned'::text, 'resolved'::text])))
);

create table public.folders (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  name text not null,
  created_at timestamp with time zone default now(),
  external_source_id text,
  class_id uuid,
  cover jsonb,
  lms_named boolean not null default false,
  own_name text,
  constraint folders_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  constraint folders_pkey PRIMARY KEY (id),
  constraint folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create policy "Users can delete own folders" on public.folders for delete to public
  using (auth.uid() = user_id);
create policy "Users can insert own folders" on public.folders for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own folders" on public.folders for update to public
  using (auth.uid() = user_id);
create policy "Users can view own folders" on public.folders for select to public
  using (auth.uid() = user_id);

create table public.free_plan_usage (
  user_id uuid not null,
  guide_creations integer not null default 0,
  tutor_messages integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint free_plan_usage_guide_creations_check CHECK ((guide_creations >= 0)),
  constraint free_plan_usage_pkey PRIMARY KEY (user_id),
  constraint free_plan_usage_tutor_messages_check CHECK ((tutor_messages >= 0)),
  constraint free_plan_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.generation_jobs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'study_set'::text,
  status text not null default 'queued'::text,
  progress real,
  study_set_id uuid,
  error text,
  source text not null default 'app'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  title text,
  folder_id uuid,
  input jsonb,
  client_name text,
  attempts integer not null default 0,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  seen_at timestamp with time zone,
  source_hash text
);
create policy "Students read their own jobs" on public.generation_jobs for select to authenticated,mcp_client
  using (auth.uid() = user_id);

create table public.guide_visuals (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  guide_id uuid not null,
  section text not null default ''::text,
  anchor text not null default ''::text,
  url text not null,
  alt text not null default ''::text,
  theme text not null default 'light'::text,
  created_at timestamp with time zone not null default now(),
  width smallint
);

create table public.instructor_blocks (
  id uuid not null default gen_random_uuid(),
  class_id uuid not null,
  email text not null,
  created_at timestamp with time zone not null default now()
);

create table public.learner_settings (
  user_id uuid not null,
  adaptation_on boolean not null default true,
  exploration_on boolean not null default true,
  use_speed boolean not null default true,
  first_view_pref text,
  study_preference text,
  updated_at timestamp with time zone not null default now()
);
create policy "Students read their own learner settings" on public.learner_settings for select to authenticated
  using (auth.uid() = user_id);

create table public.learning_events (
  id bigint not null default nextval('learning_events_id_seq'::regclass),
  user_id uuid not null,
  item_id text not null,
  guide_id uuid not null,
  decision_id uuid,
  mode text not null,
  format text not null,
  outcome text not null,
  confidence text,
  first_key_ms integer,
  submit_ms integer,
  hidden_ms integer not null default 0,
  rapid_guess boolean not null default false,
  answer_chars integer,
  view_shown text,
  fsrs_rating smallint,
  same_day boolean not null,
  arm text not null default 'fsrs'::text,
  params_version text not null,
  s_before real,
  d_before real,
  r_before real,
  occurred_at timestamp with time zone not null default now()
);
create policy "Connected apps log the student's answers" on public.learning_events for insert to mcp_client
  with check ((auth.uid() = user_id) AND (mode = 'mcp'::text) AND (decision_id IS NULL));
create policy "Connected apps read the student's answers" on public.learning_events for select to mcp_client
  using (auth.uid() = user_id);

create table public.learning_preferences (
  user_id uuid not null,
  style text,
  prompted_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  explain_preference text,
  constraint learning_preferences_explain_preference_check CHECK ((char_length(explain_preference) <= 500)),
  constraint learning_preferences_pkey PRIMARY KEY (user_id),
  constraint learning_preferences_style_check CHECK ((style = ANY (ARRAY['visual'::text, 'aural'::text, 'read_write'::text, 'kinesthetic'::text, 'multimodal'::text]))),
  constraint learning_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.lecture_todos (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  lecture_id uuid not null,
  title text not null,
  kind text not null default 'assignment'::text,
  due_at timestamp with time zone,
  said text not null default ''::text,
  quote text not null default ''::text,
  at_ms integer not null default 0,
  status text not null default 'suggested'::text,
  created_at timestamp with time zone not null default now(),
  constraint lecture_todos_kind_check CHECK ((kind = ANY (ARRAY['assignment'::text, 'reading'::text, 'exam'::text, 'other'::text]))),
  constraint lecture_todos_lecture_id_fkey FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE,
  constraint lecture_todos_pkey PRIMARY KEY (id),
  constraint lecture_todos_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'confirmed'::text, 'dismissed'::text, 'done'::text]))),
  constraint lecture_todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create policy "Connected apps read the student's lecture to-dos" on public.lecture_todos for select to mcp_client
  using (auth.uid() = user_id);

create table public.lectures (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  folder_id uuid,
  title text not null default 'Lecture'::text,
  source text not null default 'recording'::text,
  lecture_date date not null default CURRENT_DATE,
  duration_ms integer not null default 0,
  transcript text not null default ''::text,
  segments jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  guide_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  search_doc tsvector,
  constraint lectures_pkey PRIMARY KEY (id),
  constraint lectures_source_check CHECK ((source = ANY (ARRAY['recording'::text, 'upload'::text, 'notes'::text]))),
  constraint lectures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create policy "Students read their own lectures" on public.lectures for select to authenticated,mcp_client
  using (auth.uid() = user_id);

create table public.mcp_answer_receipts (
  user_id uuid not null,
  idempotency_key text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table public.mcp_connection_activity (
  user_id uuid not null,
  client_id uuid not null,
  last_used_at timestamp with time zone not null default now()
);
create policy "Users read own connected-app activity" on public.mcp_connection_activity for select to authenticated
  using (auth.uid() = user_id);

create table public.mcp_rate_counters (
  user_id uuid not null,
  bucket text not null,
  window_start timestamp with time zone not null,
  calls integer not null default 0
);

create table public.mcp_tool_calls (
  id bigint not null,
  user_id uuid not null,
  client_id uuid,
  tool_name text not null,
  status text not null,
  error_code text,
  latency_ms integer,
  created_at timestamp with time zone not null default now()
);
create policy "Admins read connected-app calls" on public.mcp_tool_calls for select to authenticated
  using (EXISTS ( SELECT 1
   FROM app_admins a
  WHERE (a.user_id = auth.uid())));

create table public.monthly_usage (
  id bigint not null default nextval('monthly_usage_id_seq'::regclass),
  user_id uuid,
  month text not null,
  guides_generated integer default 0,
  lightweight_actions integer not null default 0,
  constraint monthly_usage_pkey PRIMARY KEY (id),
  constraint monthly_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint monthly_usage_user_id_month_key UNIQUE (user_id, month)
);
create policy "Users can insert own usage" on public.monthly_usage for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own usage" on public.monthly_usage for update to public
  using (auth.uid() = user_id);
create policy "Users can view own usage" on public.monthly_usage for select to public
  using (auth.uid() = user_id);

create table public.note_covers (
  note_id text not null,
  user_id uuid not null,
  url text not null,
  alt text not null default ''::text,
  content_length integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  constraint note_covers_pkey PRIMARY KEY (note_id),
  constraint note_covers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.onboarding_progress (
  user_id uuid not null,
  step text not null,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint onboarding_progress_pkey PRIMARY KEY (user_id),
  constraint onboarding_progress_step_check CHECK ((step = ANY (ARRAY['style'::text, 'extension'::text, 'extension_use'::text, 'create'::text, 'smartnotes'::text, 'practice'::text, 'done'::text]))),
  constraint onboarding_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.policy_versions (
  id text not null,
  decision_type text not null,
  stage smallint not null,
  epsilon numeric not null,
  params jsonb not null,
  code_sha text not null,
  created_at timestamp with time zone not null default now()
);

create table public.quiz_attempts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  guide_id uuid not null,
  score integer not null,
  total_questions integer not null,
  correct_answers integer not null,
  answers jsonb default '[]'::jsonb,
  completed_at timestamp with time zone default now(),
  constraint quiz_attempts_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES study_guides(id) ON DELETE CASCADE,
  constraint quiz_attempts_pkey PRIMARY KEY (id)
);
create policy "Users can delete own attempts" on public.quiz_attempts for delete to public
  using (auth.uid() = user_id);
create policy "Users can insert own attempts" on public.quiz_attempts for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own attempts" on public.quiz_attempts for update to public
  using (auth.uid() = user_id);
create policy "Users can view own attempts" on public.quiz_attempts for select to public
  using (auth.uid() = user_id);

create table public.retain_misses (
  user_id uuid not null,
  guide_id uuid not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now()
);
create policy "Connected apps read the student's retain misses" on public.retain_misses for select to mcp_client
  using (auth.uid() = user_id);
create policy "Students manage their own retain misses" on public.retain_misses for all to authenticated
  using (auth.uid() = user_id)
  with check ((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM study_guides g
  WHERE ((g.id = retain_misses.guide_id) AND (g.user_id = auth.uid())))));

create table public.schools (
  id uuid not null default gen_random_uuid(),
  name text not null,
  canvas_domain text,
  email_domains text[] not null default '{}'::text[],
  created_at timestamp with time zone not null default now(),
  constraint schools_canvas_domain_check CHECK (((canvas_domain IS NULL) OR (canvas_domain = lower(canvas_domain)))),
  constraint schools_canvas_domain_key UNIQUE (canvas_domain),
  constraint schools_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
  constraint schools_pkey PRIMARY KEY (id)
);
create policy "Signed-in users read schools" on public.schools for select to authenticated
  using true;

create table public.shared_set_reports (
  id uuid not null default gen_random_uuid(),
  set_id uuid not null,
  reporter_id uuid not null,
  reason text not null,
  status text not null default 'open'::text,
  created_at timestamp with time zone not null default now()
);
create policy "Users read own reports" on public.shared_set_reports for select to authenticated
  using (reporter_id = auth.uid());

create table public.shared_set_studiers (
  set_id uuid not null,
  user_id uuid not null,
  accuracy numeric,
  last_studied_at timestamp with time zone not null default now()
);
create policy "Users read own studier rows" on public.shared_set_studiers for select to authenticated
  using (user_id = auth.uid());

create table public.shared_sets (
  id uuid not null default gen_random_uuid(),
  guide_id uuid not null,
  owner_id uuid not null,
  class_id uuid,
  visibility text not null default 'private'::text,
  status text not null default 'visible'::text,
  hold_reason text,
  title text not null default ''::text,
  study_guide text not null default ''::text,
  flashcards jsonb not null default '[]'::jsonb,
  card_count integer not null default 0,
  owner_name text,
  cluster_id uuid,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  subject text,
  saves integer not null default 0,
  published_at timestamp with time zone,
  search tsvector
);
create policy "Owners and class members read shared sets" on public.shared_sets for select to authenticated
  using ((owner_id = auth.uid()) OR ((visibility = 'public'::text) AND (status = 'visible'::text)) OR ((visibility = 'class'::text) AND (status = 'visible'::text) AND is_class_member(class_id)));

create table public.sharing_settings (
  user_id uuid not null,
  show_first_name boolean not null default false
);
create policy "Users read own sharing settings" on public.sharing_settings for select to authenticated
  using (user_id = auth.uid());

create table public.smart_notes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled Notes'::text,
  content text default ''::text,
  folder_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  search_doc tsvector,
  constraint smart_notes_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
  constraint smart_notes_pkey PRIMARY KEY (id)
);
create policy "Students read their own notes" on public.smart_notes for select to authenticated,mcp_client
  using (auth.uid() = user_id);

create table public.study_aids (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  guide_id uuid not null,
  item_key text not null,
  mode text not null,
  content jsonb not null,
  created_at timestamp with time zone not null default now(),
  constraint study_aids_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES study_guides(id) ON DELETE CASCADE,
  constraint study_aids_item_key_check CHECK ((char_length(item_key) = 64)),
  constraint study_aids_mode_check CHECK ((mode = ANY (ARRAY['visual'::text, 'aural'::text, 'read_write'::text, 'kinesthetic'::text]))),
  constraint study_aids_pkey PRIMARY KEY (id),
  constraint study_aids_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint study_aids_user_id_guide_id_item_key_mode_key UNIQUE (user_id, guide_id, item_key, mode)
);

create table public.study_blocks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  item_key text not null,
  step_id uuid,
  kind text not null default 'work'::text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  status text not null default 'planned'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.study_days (
  user_id uuid not null,
  day date not null,
  minutes real not null default 0,
  cards integer not null default 0,
  right_count integer not null default 0,
  total integer not null default 0,
  guides jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now()
);
create policy "Connected apps read the student's study days" on public.study_days for select to mcp_client
  using (auth.uid() = user_id);
create policy "Students manage their own study days" on public.study_days for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.study_guides (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  folder_id uuid,
  title text not null,
  notes text,
  study_guide text,
  flashcards jsonb,
  source_url text,
  created_at timestamp with time zone default now(),
  is_bookmarked boolean default false,
  flashcard_progress jsonb default '{}'::jsonb,
  read_progress real default 0.0,
  nclex_questions jsonb,
  quiz_questions jsonb,
  external_source_id text,
  source_guide_id uuid,
  source_type text,
  source_title text,
  source_id text,
  practice_state jsonb,
  linked_set_id uuid,
  linked_set_version integer,
  search_doc tsvector,
  origin text,
  origin_client text,
  constraint study_guides_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
  constraint study_guides_linked_set_id_fkey FOREIGN KEY (linked_set_id) REFERENCES shared_sets(id) ON DELETE SET NULL,
  constraint study_guides_pkey PRIMARY KEY (id),
  constraint study_guides_source_guide_id_fkey FOREIGN KEY (source_guide_id) REFERENCES study_guides(id) ON DELETE SET NULL,
  constraint study_guides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create policy "Connected apps never see assignment guides" on public.study_guides for select to mcp_client
  using (COALESCE(source_type, ''::text) <> 'assignment'::text);
create policy "Users can delete own guides" on public.study_guides for delete to public
  using (auth.uid() = user_id);
create policy "Users can insert own guides" on public.study_guides for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own guides" on public.study_guides for update to public
  using (auth.uid() = user_id);
create policy "Users can view own guides" on public.study_guides for select to public
  using (auth.uid() = user_id);

create table public.study_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  guide_id uuid,
  session_type text not null,
  started_at timestamp with time zone default now(),
  ended_at timestamp with time zone,
  duration_seconds integer default 0,
  metadata jsonb default '{}'::jsonb,
  constraint study_sessions_guide_id_fkey FOREIGN KEY (guide_id) REFERENCES study_guides(id) ON DELETE SET NULL,
  constraint study_sessions_pkey PRIMARY KEY (id)
);
create policy "Users can delete own sessions" on public.study_sessions for delete to public
  using (auth.uid() = user_id);
create policy "Users can insert own sessions" on public.study_sessions for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own sessions" on public.study_sessions for update to public
  using (auth.uid() = user_id);
create policy "Users can view own sessions" on public.study_sessions for select to public
  using (auth.uid() = user_id);

create table public.tutor_chats (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  guide_id uuid,
  title text not null default ''::text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.tutor_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  active_skill text not null default 'explain'::text,
  current_goal text not null default ''::text,
  active_class_id uuid,
  active_guide_id uuid,
  conversation_version integer not null default 0,
  status text not null default 'idle'::text,
  run_id uuid,
  run_started_at timestamp with time zone,
  messages jsonb not null default '[]'::jsonb,
  browser_available boolean not null default false,
  browser_observation jsonb not null default '{}'::jsonb,
  browser_content text not null default ''::text,
  browser_command jsonb not null default '{}'::jsonb,
  browser_last_seen_at timestamp with time zone,
  permission_scope jsonb not null default '["read_page"]'::jsonb,
  last_action_result jsonb not null default '{}'::jsonb,
  action_history jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint tutor_sessions_active_skill_check CHECK ((active_skill = ANY (ARRAY['explain'::text, 'capture'::text, 'build_guide'::text, 'practice'::text, 'retain'::text, 'plan'::text, 'find_material'::text, 'organize'::text]))),
  constraint tutor_sessions_pkey PRIMARY KEY (id),
  constraint tutor_sessions_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'waiting_browser'::text]))),
  constraint tutor_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint tutor_sessions_user_id_key UNIQUE (user_id)
);

create table public.usage_events (
  id bigint not null,
  created_at timestamp with time zone not null default now(),
  user_id uuid,
  feature text not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  constraint usage_events_pkey PRIMARY KEY (id)
);

create table public.usage_ledger (
  id bigint not null,
  user_id uuid not null,
  feature text not null,
  month text not null,
  request_key text,
  created_at timestamp with time zone not null default now(),
  constraint usage_ledger_feature_check CHECK ((feature = ANY (ARRAY['guide'::text, 'tutor'::text, 'learn_my_way'::text, 'practice'::text, 'ai_quiz'::text, 'nclex'::text, 'exam'::text, 'light'::text, 'retain_types'::text, 'lecture_minute'::text, 'visual'::text]))),
  constraint usage_ledger_pkey PRIMARY KEY (id),
  constraint usage_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.user_profiles (
  id uuid not null,
  email text,
  name text,
  university text,
  major text,
  created_at timestamp with time zone default now(),
  education_level text,
  timezone text,
  constraint user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint user_profiles_pkey PRIMARY KEY (id)
);
create policy "Users can read own profile" on public.user_profiles for select to public
  using (auth.uid() = id);
create policy "Users insert own profile" on public.user_profiles for insert to authenticated
  with check (auth.uid() = id);

create table public.user_streaks (
  user_id uuid not null,
  current_streak integer default 0,
  longest_streak integer default 0,
  last_study_date date,
  updated_at timestamp with time zone default now(),
  constraint user_streaks_pkey PRIMARY KEY (user_id)
);
create policy "Users can insert own streaks" on public.user_streaks for insert to public
  with check (auth.uid() = user_id);
create policy "Users can update own streaks" on public.user_streaks for update to public
  using (auth.uid() = user_id);
create policy "Users can view own streaks" on public.user_streaks for select to public
  using (auth.uid() = user_id);

create table public.user_subscriptions (
  user_id uuid not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text default 'free'::text,
  status text default 'active'::text,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default now(),
  trial_ends_at timestamp with time zone,
  trial_used boolean default false,
  billing_interval text,
  cancel_at_period_end boolean not null default false,
  source text not null default 'stripe'::text,
  current_period_start timestamp with time zone,
  pro_trial_started_at timestamp with time zone,
  pro_trial_ends_at timestamp with time zone,
  trial_end_prompted_at timestamp with time zone,
  constraint user_subscriptions_pkey PRIMARY KEY (user_id),
  constraint user_subscriptions_source_check CHECK ((source = ANY (ARRAY['stripe'::text, 'manual'::text]))),
  constraint user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
create policy "own" on public.user_subscriptions for select to public
  using (auth.uid() = user_id);

create table public.visual_cache (
  key text not null,
  user_id uuid,
  theme text not null default 'light'::text,
  alt text not null default ''::text,
  files jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint visual_cache_key_check CHECK ((key ~ '^[0-9a-f]{64}$'::text)),
  constraint visual_cache_pkey PRIMARY KEY (key),
  constraint visual_cache_theme_check CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text]))),
  constraint visual_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
);
