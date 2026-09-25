-- Tamzit app: engine support. Subscriptions upsert by external_ref. The engine's edition writer
-- app_engine_upsert_edition is defined in 0009 (see docs/engine-integration.md).
-- Idempotent.

-- Subscriptions can be upserted by the reference of the source system (WhatsApp, RevenueCat, …).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_subscriptions_external_ref_key') then
    alter table public.app_subscriptions add constraint app_subscriptions_external_ref_key unique (external_ref);
  end if;
end $$;
