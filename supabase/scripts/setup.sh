#!/usr/bin/env bash
# Idempotent setup of the Tamzit app backend on the tamzitnews_v1 project (which already holds the engine's
# tamzit_editions / tamzit_edition_elements / processed_stories / user_preferences tables):
#   1. applies all migrations + the reference seed in ONE request (one transaction)
#   2. stores the functions base URL for the special-update push trigger
#   3. creates the public storage buckets app-media and app-builds
#   4. creates the demo auth users and their user_preferences rows, subscriptions, family and messages
# Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
# (for tamzitnews_v1: `. /home/user/.tamzit-supabase-v1.env` first; never commit that file).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_PROJECT_REF:?}"
SQL=scripts/sql.sh
KEY="$SUPABASE_SERVICE_ROLE_KEY"

if [[ "${SKIP_MIGRATIONS:-}" != "1" ]]; then
  echo "== migrations"
  # 0001-0007 built the first (app_-table) version; 0008/0009 move the app onto the existing tables and drop
  # those duplicates again. Running them together keeps every re-run atomic.
  cat migrations/*.sql seed/001_reference.sql | $SQL - >/dev/null
fi

printf "insert into public.app_settings(key, value) values ('functions_base_url', to_jsonb('%s/functions/v1'::text))
on conflict (key) do update set value = excluded.value;" "$SUPABASE_URL" | $SQL - >/dev/null

echo "== buckets"
for b in app-media app-builds; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$SUPABASE_URL/storage/v1/bucket/$b" -H "Authorization: Bearer $KEY" -H "apikey: $KEY")
  if [[ "$code" == "200" ]]; then
    curl -sS -X PUT "$SUPABASE_URL/storage/v1/bucket/$b" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
      -H 'Content-Type: application/json' -d "{\"id\":\"$b\",\"name\":\"$b\",\"public\":true}" >/dev/null
    echo "$b exists (public)"
  else
    curl -sS -X POST "$SUPABASE_URL/storage/v1/bucket" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
      -H 'Content-Type: application/json' -d "{\"id\":\"$b\",\"name\":\"$b\",\"public\":true}"
    echo
  fi
done

echo "== demo users"
for email in demo@tamzit-app.test demo-premium@tamzit-app.test demo-family@tamzit-app.test; do
  out=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"email_confirm\":true,\"app_metadata\":{\"tamzit_app\":true,\"demo\":true}}")
  if echo "$out" | grep -q '"id"'; then echo "created $email"; else echo "$email: exists"; fi
done

$SQL - >/dev/null <<'EOF'
-- Demo profiles in user_preferences (contract field -> column: full_name -> name, style -> persona,
-- level_filter -> anxiety_level, frequency -> update_frequency, topics -> interests).
insert into public.user_preferences (user_id, name, persona, anxiety_level, update_frequency, interests, phone, email,
  birth_year, city, language, audience, slot_times, communities, special_push, edition_push, headline_in_push,
  text_scale, theme, shabbat_city_id, onboarded, updated_at)
select u.id, x.full_name, x.persona, 'Medium', 3, '{security,economy,health,education,weather,transport,world}',
  x.phone, x.email, x.birth_year, 'jerusalem', 'he', 'general', '{07:30,13:00,20:00}', '{jerusalem}', true, true, false,
  1, 'system', 'jerusalem', true, now()
from (values
  ('demo@tamzit-app.test',         'משתמש הדגמה',   '+972500000000', 1985, 'Calming'),
  ('demo-premium@tamzit-app.test', 'הדגמה פרימיום', '+972500000001', 1979, 'Informative'),
  ('demo-family@tamzit-app.test',  'הדגמה משפחתי',  '+972500000002', 1982, 'Human')
) as x(email, full_name, phone, birth_year, persona)
join auth.users u on lower(u.email) = x.email
on conflict (user_id) do nothing;

-- Premium for the premium demo phone, family for the family demo, and a (fake) WhatsApp premium subscriber
-- who has not registered yet.
insert into public.app_subscriptions (phone, plan, source, starts_at, ends_at, external_ref)
select v.phone, v.plan, v.source, now() - interval '30 days', null, v.ref
from (values
  ('+972500000001', 'premium', 'manual',   'sample-demo-premium'),
  ('+972500000002', 'family',  'manual',   'sample-demo-family'),
  ('+972500000009', 'premium', 'whatsapp', 'sample-whatsapp-premium')
) as v(phone, plan, source, ref)
where not exists (select 1 from public.app_subscriptions s where s.external_ref = v.ref);

-- The family demo owner has one invited (fake) member.
insert into public.app_family_members (owner_id, member_phone, member_name, status)
select p.user_id, '+972500000003', 'בת משפחה לדוגמה', 'invited'
from public.user_preferences p where p.phone = '+972500000002'
on conflict (owner_id, member_phone) do nothing;

-- In-app messages for the premium demo: a correction notice (read) and an editor reply (unread).
insert into public.app_messages (profile_id, title, body, item_id, created_at, read_at)
select p.user_id, m.title, m.body, null, now() - m.age, case when m.is_read then now() - m.age + interval '2 hours' end
from public.user_preferences p
cross join (values
  ('תיקון בידיעה על השיבוש באספקת המים',
   'עדכנו את הידיעה על השיבוש באספקת המים: שעת הסיום המשוערת הוקדמה ל־17:00, ונקודות החלוקה פועלות עד אז. תודה לקוראים ששמו לב ועדכנו אותנו.',
   interval '2 days', true),
  ('תשובה מהעורכים',
   'שאלתם למה מהדורת הצהריים קצרה יותר. בצהריים אנחנו מביאים רק את מה שהתחדש מאז הבוקר, ולכן יש בה בדרך כלל ארבע או חמש ידיעות. תודה ששאלתם. צוות תמצית החדשות',
   interval '3 hours', false)
) as m(title, body, age, is_read)
where p.phone = '+972500000001'
  and not exists (select 1 from public.app_messages x where x.profile_id = p.user_id and x.title = m.title);
EOF
echo "== done"
