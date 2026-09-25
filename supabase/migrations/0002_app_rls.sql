-- Tamzit app: row level security, grants and protective triggers.
-- Clients (anon / authenticated) get exactly what docs/api-contract.md allows. Idempotent.

-- ---------------------------------------------------------------------------
-- Enable RLS on every app_ table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'app_topics', 'app_cities', 'app_communities', 'app_settings', 'app_subscriptions',
    'app_family_members', 'app_saved_items', 'app_reads', 'app_feedback', 'app_messages', 'app_devices',
    'app_donations', 'app_pending_registrations', 'app_login_attempts', 'app_login_codes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------

-- No client access at all: content is served by security-definer RPCs only.
revoke all on public.app_subscriptions, public.app_pending_registrations, public.app_login_attempts, public.app_login_codes
  from anon, authenticated;
revoke all on sequence public.app_login_attempts_id_seq from anon, authenticated;

-- Reference data: read only. Topics, cities, communities and the public settings are readable
-- before registration (anon key, onboarding); editions and audio need a signed-in user.
revoke all on public.app_topics, public.app_cities, public.app_communities, public.app_settings from anon, authenticated;
grant select on public.app_topics, public.app_cities, public.app_communities, public.app_settings to anon, authenticated;

-- User tables: authenticated only, limited verbs.
revoke all on public.app_family_members, public.app_saved_items, public.app_reads,
  public.app_feedback, public.app_messages, public.app_devices, public.app_donations from anon, authenticated;
grant select, insert, update, delete on public.app_family_members to authenticated;
grant select, insert, delete on public.app_saved_items to authenticated;
grant select, insert, update, delete on public.app_reads to authenticated;
grant select, insert on public.app_feedback to authenticated;
grant select on public.app_messages to authenticated;
grant update (read_at) on public.app_messages to authenticated;
grant select, insert, update, delete on public.app_devices to authenticated;
grant select, insert on public.app_donations to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Reference data
drop policy if exists app_topics_read on public.app_topics;
create policy app_topics_read on public.app_topics for select to anon, authenticated using (active);

drop policy if exists app_cities_read on public.app_cities;
create policy app_cities_read on public.app_cities for select to anon, authenticated using (active);

drop policy if exists app_communities_read on public.app_communities;
create policy app_communities_read on public.app_communities for select to anon, authenticated using (active);

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to anon, authenticated
  using (key in ('free_archive_days', 'max_items', 'donation_url', 'support_email'));

-- Family: the owner manages own rows (the member policy app_family_member_read is in 0008).
drop policy if exists app_family_owner_all on public.app_family_members;
create policy app_family_owner_all on public.app_family_members for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Own-row tables
drop policy if exists app_saved_own on public.app_saved_items;
create policy app_saved_own on public.app_saved_items for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists app_reads_own on public.app_reads;
create policy app_reads_own on public.app_reads for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists app_feedback_select_own on public.app_feedback;
create policy app_feedback_select_own on public.app_feedback for select to authenticated
  using (profile_id = (select auth.uid()));
drop policy if exists app_feedback_insert_own on public.app_feedback;
create policy app_feedback_insert_own on public.app_feedback for insert to authenticated
  with check (profile_id = (select auth.uid()) and status = 'new' and reply is null and replied_at is null);

drop policy if exists app_messages_select_own on public.app_messages;
create policy app_messages_select_own on public.app_messages for select to authenticated
  using (profile_id = (select auth.uid()));
drop policy if exists app_messages_update_own on public.app_messages;
create policy app_messages_update_own on public.app_messages for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists app_devices_own on public.app_devices;
create policy app_devices_own on public.app_devices for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists app_donations_select_own on public.app_donations;
create policy app_donations_select_own on public.app_donations for select to authenticated
  using (profile_id = (select auth.uid()));
drop policy if exists app_donations_insert_own on public.app_donations;
create policy app_donations_insert_own on public.app_donations for insert to authenticated
  with check (profile_id = (select auth.uid()) and status = 'initiated');

-- app_subscriptions, app_pending_registrations,
-- app_login_attempts, app_login_codes: RLS on and no policies = no client rows.

-- ---------------------------------------------------------------------------
-- Protective triggers
-- ---------------------------------------------------------------------------

-- A family has at most 4 active (invited or joined) members besides the owner.
create or replace function public.app_family_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'removed' and (
    select count(*) from public.app_family_members m
    where m.owner_id = new.owner_id and m.status <> 'removed' and m.member_phone <> new.member_phone
  ) >= 4 then
    raise exception using errcode = 'P0001', message = 'family_full';
  end if;
  return new;
end;
$$;

drop trigger if exists app_family_limit on public.app_family_members;
create trigger app_family_limit before insert or update on public.app_family_members
  for each row execute function public.app_family_limit();

-- Trigger functions are not callable as RPCs by clients.
revoke execute on function public.app_family_limit() from public, anon, authenticated;
revoke execute on function public.app_touch_updated_at() from public, anon, authenticated;
