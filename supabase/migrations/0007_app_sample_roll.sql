-- Superseded. This migration kept the SAMPLE content (app_editions / app_items … with external_id 'sample-%')
-- current with a daily pg_cron job. The app now reads the engine's real editions (tamzit_editions), so the
-- sample tables, the job 'app_sample_roll_weekly' and app_sample_roll_forward() were removed in 0008.
do $$ begin end $$;
