-- Default edition times follow the newsroom's real publishing times (weekday medians: morning ~09:20,
-- noon ~15:10, evening and daily ~21:05; 90% out by 09:55 / 15:42 / 21:10), so the edition is ready
-- when the reminder arrives. Rows that still hold the old untouched default get the new default for
-- their frequency (one time per edition).
alter table public.user_preferences alter column slot_times set default '{10:00,16:00,21:30}'::text[];

update public.user_preferences
   set slot_times = case coalesce(update_frequency, 3)
                      when 1 then '{21:30}'::text[]
                      when 2 then '{10:00,21:30}'::text[]
                      else '{10:00,16:00,21:30}'::text[] end
 where slot_times = '{07:30,13:00,20:00}'::text[];
