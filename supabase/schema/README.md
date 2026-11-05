# Live schema vs. this repo (personalization plan step 0.1)

Read on 2026-11-05 from the live project's migration history (`supabase_migrations.schema_migrations`,
run by the owner). The live table and policy snapshot (`live-2026-11.sql`) is added once the
column, constraint and policy queries in `supabase/checks/phase0_readonly.sql` have been run.

## How migrations reach production

- Migrations applied with the Supabase CLI or MCP are recorded in the history, under the version the
  tool gave them. Ten files here carry a different version from their history entry (below); same
  migration, renamed timestamp.
- Migrations pasted into the SQL editor are **not** recorded. Every migration since 2026-10-15 except
  `assistant_links` went in this way, so the history stops recording repo files at
  `20261004 retain_question_types`. Their tables exist live (checked 2026-11-04).

## Applied, recorded in history, but no file in this repo

| Version | Name |
| --- | --- |
| 20260924155322 | simplify_free_plan_limits |
| 20260928230952 | revoke_execute_handle_new_user |
| 20260928231036 | grant_handle_new_user_to_auth_admin |
| 20261001184242 | admin_user_overview |
| 20261019175633 | assistant_links (written by the Cordia Assistant repo) |

## Recorded under a different version than the file

| History version | Repo file |
| --- | --- |
| 20260911233358 | 20260911000000_classroom_plus_billing |
| 20260913054327 | 20260912000000_canvas_automation |
| 20260926204931 | 20260926120000_learning_styles |
| 20260927013619 | 20260927013800_study_guides_domain |
| 20260927204241 | 20260927210000_study_guides_practice_state |
| 20260929152747 | 20260929120000_usage_events |
| 20260930181120 | 20260930120000_onboarding_progress |
| 20260930194934 | 20260930150000_explanation_preference |
| 20261002014803 | 20261001120000_pro_entitlements |
| 20261004011344 | 20261004120000_retain_question_types |

## Files not in the history

Applied by hand in the SQL editor (live, not recorded), oldest first:
20260915000000_canvas_course_folders, 20260915035012_harden_classroom_rls,
20260916000000_guide_provenance, 20261015120000_canvas_classes, 20261016120000_lecture_recording,
20261016130000_napkin_visuals, 20261017180000_drop_study_guides_domain, 20261019120000_lectures,
20261021120000_deadline_done, 20261021130000_tutor_chats, 20261021140000_guide_visuals,
20261022120000_card_images, 20261022130000_public_sets, 20261022140000_guide_visual_width,
20261023120000_connector_settings, 20261023130000_connector_sync, 20261024120000_deadline_changes,
20261026120000_slack_deadline_source, 20261026130000_feedback_attachments,
20261026140000_drop_legacy_guide_cap, 20261027120000_folder_covers, 20261030120000_learning_events,
20261031120000_oauth_lockdown, 20261031130000_mcp_connected_apps, 20261101120000_mcp_read_access,
20261102120000_mcp_write_tools, 20261102180000_study_set_job_repeat.

Waiting for the owner (PR CordiaAI/cordia-classroom#197): 20261105120000_learning_events_n_options,
20261105130000_decision_outcomes.

Fourteen of the hand-applied files still say "NOT APPLIED" in their header. Those headers get a dated
"applied by hand" line once the column/constraint/policy snapshot confirms each one is live.

## Core tables with no create statement in the repo

`user_profiles`, `study_guides`, `study_sessions`, `quiz_attempts`, `user_streaks`, `folders`,
`smart_notes`: created before migrations were kept. `live-2026-11.sql` becomes their baseline.
