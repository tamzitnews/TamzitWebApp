#!/usr/bin/env bash
# One-time / idempotent project setup for the Tamzit app backend:
#   1. applies migrations + reference seed
#   2. stores the functions base URL for the push trigger
#   3. creates the public storage buckets app-media and app-builds
#   4. creates the demo auth users, their app_profiles rows and the sample subscriptions
# Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_PROJECT_REF:?}"
SQL=scripts/sql.sh
KEY="$SUPABASE_SERVICE_ROLE_KEY"

if [[ "${SKIP_MIGRATIONS:-}" != "1" ]]; then
  $SQL migrations/*.sql seed/001_reference.sql >/dev/null
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
  if echo "$out" | grep -q '"id"'; then echo "created $email"; else echo "$email: $(echo "$out" | head -c 160)"; fi
done

$SQL - >/dev/null <<'EOF'
insert into public.app_profiles (id, full_name, phone, email, birth_year, city, language, audience, frequency,
  slot_times, level_filter, style, topics, communities, shabbat_city_id, onboarded)
select u.id, x.full_name, x.phone, x.email, x.birth_year, 'jerusalem', 'he', 'general', 3,
  '{07:30,13:00,20:00}', 'important', x.style, '{security,economy,health,education,weather,transport,world}',
  '{jerusalem}', 'jerusalem', true
from (values
  ('demo@tamzit-app.test',         'משתמש הדגמה',   '+972500000000', 1985, 'calm'),
  ('demo-premium@tamzit-app.test', 'הדגמה פרימיום', '+972500000001', 1979, 'informative'),
  ('demo-family@tamzit-app.test',  'הדגמה משפחתי',  '+972500000002', 1982, 'human')
) as x(email, full_name, phone, birth_year, style)
join auth.users u on lower(u.email) = x.email
on conflict (id) do nothing;

-- Premium for the premium demo phone, and a (fake) WhatsApp premium subscriber who has not registered yet.
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
select p.id, '+972500000003', 'בת משפחה לדוגמה', 'invited'
from public.app_profiles p where p.phone = '+972500000002'
on conflict (owner_id, member_phone) do nothing;

-- In-app messages for the premium demo: a correction notice (read) and an editor reply (unread).
insert into public.app_messages (profile_id, title, body, item_id, created_at, read_at)
select p.id, m.title, m.body, null, now() - m.age, case when m.is_read then now() - m.age + interval '2 hours' end
from public.app_profiles p
cross join (values
  ('תיקון בידיעה על השיבוש באספקת המים',
   'עדכנו את הידיעה על השיבוש באספקת המים: שעת הסיום המשוערת הוקדמה ל־17:00, ונקודות החלוקה פועלות עד אז. תודה לקוראים ששמו לב ועדכנו אותנו.',
   interval '2 days', true),
  ('תשובה מהעורכים',
   'שאלתם למה מהדורת הצהריים קצרה יותר. בצהריים אנחנו מביאים רק את מה שהתחדש מאז הבוקר, ולכן יש בה בדרך כלל ארבע או חמש ידיעות. תודה ששאלתם. צוות תמצית החדשות',
   interval '3 hours', false)
) as m(title, body, age, is_read)
where p.phone = '+972500000001'
  and not exists (select 1 from public.app_messages x where x.profile_id = p.id and x.title = m.title);
EOF
echo "== done"
