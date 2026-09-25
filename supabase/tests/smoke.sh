#!/usr/bin/env bash
# End-to-end smoke test of the Tamzit app backend (edge functions, RPCs, RLS, push trigger).
# Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; SUPABASE_ANON_KEY (or mobile/.env);
#        SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF for the SQL checks (push trigger).
# Usage: supabase/tests/smoke.sh      (exit code 0 = all passed)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
ANON="${SUPABASE_ANON_KEY:-$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/mobile/.env" 2>/dev/null | cut -d= -f2-)}"
[[ -n "$ANON" ]] || { echo "no anon key (set SUPABASE_ANON_KEY)"; exit 2; }
SRV="$SUPABASE_SERVICE_ROLE_KEY"
FN="$SUPABASE_URL/functions/v1"
SQL="$ROOT/supabase/scripts/sql.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; [[ -n "${2:-}" ]] && echo "       ${2:0:400}"; }
# check "<name>" "<python expression over d (parsed JSON) and s (HTTP status)>" <file-with-body> <status>
check() {
  local name="$1" expr="$2" file="$3" status="$4"
  if python3 - "$file" "$status" "$expr" <<'PY'
import json, sys
path, status, expr = sys.argv[1], int(sys.argv[2]), sys.argv[3]
raw = open(path, encoding='utf-8').read()
try:
    d = json.loads(raw) if raw.strip() else None
except Exception:
    d = raw
s = status
sys.exit(0 if eval(expr) else 1)
PY
  then ok "$name"; else bad "$name" "HTTP $status $(cat "$file")"; fi
}
# call METHOD URL TOKEN [JSON] -> writes $TMP/out, echoes status
call() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  local args=(-sS -o "$TMP/out" -w '%{http_code}' -X "$method" "$url" -H "apikey: $ANON" -H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
  curl "${args[@]}"
}
fn()  { call POST "$FN/$1" "$ANON" "$2"; }
rpc() { local body="${3:-}"; [[ -n "$body" ]] || body='{}'; call POST "$SUPABASE_URL/rest/v1/rpc/$2" "$1" "$body"; }
get() { call GET "$SUPABASE_URL/rest/v1/$2" "$1"; }
jget() { python3 -c "import json,sys; d=json.load(open('$TMP/out')); print(eval(sys.argv[1]))" "$1"; }

echo "== auth: edge functions"
s=$(fn app-auth-start '{"mode":"login","phone":"050-000-0000"}');       check "start (demo, 05X format)" "s==200 and d['ok'] and d['masked_email'].startswith('d***@')" "$TMP/out" "$s"
s=$(fn app-auth-start '{"mode":"login","phone":"12"}');                 check "start: invalid_phone" "s==400 and d['error']=='invalid_phone'" "$TMP/out" "$s"
s=$(fn app-auth-start '{"mode":"login","phone":"+15555550111"}');       check "start: not_registered" "s==404 and d['error']=='not_registered'" "$TMP/out" "$s"
s=$(fn app-auth-start '{"mode":"register","phone":"+15555550111","email":"x@example.com"}'); check "start: missing_name" "s==400 and d['error']=='missing_name'" "$TMP/out" "$s"
s=$(fn app-auth-start '{"mode":"register","phone":"+15555550111","full_name":"בדיקה","email":"nope"}'); check "start: invalid_email" "s==400 and d['error']=='invalid_email'" "$TMP/out" "$s"
s=$(fn app-auth-start '{"mode":"register","phone":"+972500000000","full_name":"בדיקה","email":"a@b.co"}'); check "start: demo phone register -> ok" "s==200" "$TMP/out" "$s"
s=$(fn app-auth-verify '{"phone":"0500000000","code":"000000"}');      check "verify: wrong demo code" "s==400 and d['error']=='invalid_code'" "$TMP/out" "$s"
s=$(fn app-auth-verify '{"phone":"+972 50-000-0000","code":"123456"}'); check "verify: demo (free) -> session" "s==200 and len(d['access_token'])>100 and d['refresh_token'] and d['is_new'] is False" "$TMP/out" "$s"
FREE=$(jget "d['access_token']"); FREE_ID=$(jget "d['user_id']")
s=$(fn app-auth-verify '{"phone":"972500000001","code":"123456"}');     check "verify: demo (premium) -> session" "s==200 and len(d['access_token'])>100" "$TMP/out" "$s"
PREM=$(jget "d['access_token']"); PREM_ID=$(jget "d['user_id']")

# The session also refreshes through Supabase Auth
REFRESH=$(python3 -c "import json; print(json.load(open('$TMP/out'))['refresh_token'])")
s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$SUPABASE_URL/auth/v1/token?grant_type=refresh_token" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
check "auth: refresh_token works" "s==200 and d['access_token']" "$TMP/out" "$s"

echo "== rate limit (non-demo phone)"
RL_PHONE="+15555550199"
for i in 1 2 3 4 5; do fn app-auth-start "{\"mode\":\"login\",\"phone\":\"$RL_PHONE\"}" >/dev/null; done
s=$(fn app-auth-start "{\"mode\":\"login\",\"phone\":\"$RL_PHONE\"}"); check "6th start in 15 min -> rate_limited" "s==429 and d['error']=='rate_limited'" "$TMP/out" "$s"

echo "== registration: code check + first verify creates the profile"
REG_PHONE="+15555550123"; REG_EMAIL="smoke-test@tamzit-app.test"; CODE="654321"
s=$(fn app-auth-start "{\"mode\":\"register\",\"phone\":\"$REG_PHONE\",\"full_name\":\"בדיקת עשן\",\"email\":\"$REG_EMAIL\",\"birth_year\":1990,\"city\":\"חיפה\"}")
if [[ "$s" == "200" ]]; then ok "register start (email provider configured)"
else check "register start without email provider -> email_not_configured" "s==503 and d['error']=='email_not_configured'" "$TMP/out" "$s"; fi
# Simulate the emailed code (the table is service-role only): hash = sha256('app-login:<phone>:<code>')
HASH=$(python3 -c "import hashlib; print(hashlib.sha256('app-login:$REG_PHONE:$CODE'.encode()).hexdigest())")
curl -sS -o /dev/null -X POST "$SUPABASE_URL/rest/v1/app_login_codes" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H 'Content-Type: application/json' -H 'Prefer: resolution=merge-duplicates' \
  -d "{\"phone\":\"$REG_PHONE\",\"email\":\"$REG_EMAIL\",\"mode\":\"register\",\"code_hash\":\"$HASH\",\"attempts\":0,\"expires_at\":\"$(date -u -d '+10 min' +%FT%TZ)\"}"
s=$(fn app-auth-verify "{\"phone\":\"$REG_PHONE\",\"code\":\"111111\"}"); check "verify: wrong code -> invalid_code" "s==400 and d['error']=='invalid_code'" "$TMP/out" "$s"
s=$(fn app-auth-verify "{\"phone\":\"$REG_PHONE\",\"code\":\"$CODE\"}");   check "verify: right code -> new profile" "s==200 and d['is_new'] is True" "$TMP/out" "$s"
NEW=$(jget "d.get('access_token','')"); NEW_ID=$(jget "d.get('user_id','')")
s=$(rpc "$NEW" app_me); check "new user app_me: profile from registration" "s==200 and d['profile']['full_name']=='בדיקת עשן' and d['profile']['phone']=='$REG_PHONE' and d['profile']['shabbat_city_id']=='haifa' and d['plan']=='free'" "$TMP/out" "$s"
s=$(fn app-auth-verify "{\"phone\":\"$REG_PHONE\",\"code\":\"$CODE\"}");   check "verify: code is single use" "s==404 and d['error']=='not_found'" "$TMP/out" "$s"
s=$(fn app-auth-start "{\"mode\":\"register\",\"phone\":\"$REG_PHONE\",\"full_name\":\"x y\",\"email\":\"$REG_EMAIL\"}"); check "start: already_registered" "s==409 and d['error']=='already_registered'" "$TMP/out" "$s"
s=$(fn app-auth-start "{\"mode\":\"register\",\"phone\":\"+15555550125\",\"full_name\":\"x y\",\"email\":\"$REG_EMAIL\"}"); check "start: email_in_use" "s==409 and d['error']=='email_in_use'" "$TMP/out" "$s"

# A second throwaway user whose phone holds a premium subscription before registering (the WhatsApp case).
P2_PHONE="+15555550124"; P2_EMAIL="smoke-test-premium@tamzit-app.test"
curl -sS -o /dev/null -X POST "$SUPABASE_URL/rest/v1/app_subscriptions" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$P2_PHONE\",\"plan\":\"premium\",\"source\":\"whatsapp\",\"external_ref\":\"smoke-test-premium\"}"
fn app-auth-start "{\"mode\":\"register\",\"phone\":\"$P2_PHONE\",\"full_name\":\"בדיקת עשן פרימיום\",\"email\":\"$P2_EMAIL\"}" >/dev/null
HASH=$(python3 -c "import hashlib; print(hashlib.sha256('app-login:$P2_PHONE:$CODE'.encode()).hexdigest())")
curl -sS -o /dev/null -X POST "$SUPABASE_URL/rest/v1/app_login_codes" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H 'Content-Type: application/json' -H 'Prefer: resolution=merge-duplicates' \
  -d "{\"phone\":\"$P2_PHONE\",\"email\":\"$P2_EMAIL\",\"mode\":\"register\",\"code_hash\":\"$HASH\",\"attempts\":0,\"expires_at\":\"$(date -u -d '+10 min' +%FT%TZ)\"}"
s=$(fn app-auth-verify "{\"phone\":\"$P2_PHONE\",\"code\":\"$CODE\"}"); check "verify: second user (pre-existing WhatsApp premium)" "s==200 and d['is_new'] is True" "$TMP/out" "$s"
SPREM=$(jget "d.get('access_token','')"); SPREM_ID=$(jget "d.get('user_id','')")
s=$(rpc "$SPREM" app_me); check "WhatsApp subscriber is premium on registration" "s==200 and d['is_premium'] is True and d['plan']=='premium'" "$TMP/out" "$s"

echo "== anon access (before registration)"
s=$(get "$ANON" "app_topics?select=id,is_default");   check "anon reads app_topics (14, 7 default)" "s==200 and len(d)==14 and sum(t['is_default'] for t in d)==7" "$TMP/out" "$s"
s=$(get "$ANON" "app_cities?select=id&in_israel=eq.false"); check "anon reads app_cities (diaspora)" "s==200 and len(d)>=5" "$TMP/out" "$s"
s=$(get "$ANON" "app_communities?select=id");          check "anon reads app_communities" "s==200 and len(d)==5" "$TMP/out" "$s"
s=$(get "$ANON" "app_settings?select=key");            check "anon reads only public settings" "s==200 and sorted(r['key'] for r in d)==['donation_url','free_archive_days','max_items','support_email']" "$TMP/out" "$s"
s=$(get "$ANON" "app_editions?select=id&limit=1");     check "anon cannot read app_editions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(rpc "$ANON" app_me);                               check "anon cannot call app_me" "s in (401,403,404)" "$TMP/out" "$s"

echo "== demo accounts (shared with testers, so only plan-level checks)"
s=$(rpc "$FREE" app_me); check "app_me free demo" "s==200 and d['is_premium'] is False and d['plan']=='free' and d['profile']['phone']=='+972500000000'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_me); check "app_me premium demo" "s==200 and d['is_premium'] is True and d['plan']=='premium'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_search '{"p_query":"מים"}');   check "search: premium_required (free demo)" "s>=400 and d['message']=='premium_required'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_search '{"p_query":"מים"}');   check "search: ok (premium demo)" "s==200 and isinstance(d, list)" "$TMP/out" "$s"
FREE_DEMO="$FREE"; PREM_DEMO="$PREM"; PREM_DEMO_ID="$PREM_ID"

# Feed and write checks run on the throwaway users, with a known baseline profile.
FREE="$NEW"; FREE_ID="$NEW_ID"; PREM="$SPREM"; PREM_ID="$SPREM_ID"
BASE='{"p_patch":{"language":"he","audience":"general","frequency":3,"slot_times":["07:30","13:00","20:00"],"level_filter":"important","topics":["security","economy","health","education","weather","transport","world"],"communities":["jerusalem"],"onboarded":true,"style":"STYLE"}}'
rpc "$FREE" app_update_profile "${BASE/STYLE/calm}" >/dev/null
rpc "$PREM" app_update_profile "${BASE/STYLE/informative}" >/dev/null

echo "== RPCs: free user"
s=$(rpc "$FREE" app_me); check "app_me free" "s==200 and d['is_premium'] is False and d['plan']=='free' and d['profile']['id']=='$FREE_ID' and isinstance(d['unread_messages'], int)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_personal_edition '{}')
check "personal edition (last 24h): shape" "s==200 and set(d)>={'window','edition_types','title','items','special','community','good_news','ad','audio','minutes','is_premium'}" "$TMP/out" "$s"
check "personal edition: items filtered + ordered" "len(d['items'])>0 and all(i['level']=='critical' or i['topic_id'] in ['security','economy','health','education','weather','transport','world'] and i['level'] in ('critical','important') for i in d['items']) and [ {'critical':3,'important':2,'general':1}[i['level']] for i in d['items'] ]==sorted([{'critical':3,'important':2,'general':1}[i['level']] for i in d['items']], reverse=True)" "$TMP/out" "$s"
check "personal edition: calm style, Hebrew" "all(i['style']=='calm' for i in d['items']) and all(any('֐'<=ch<='׿' for ch in i['headline']) for i in d['items'])" "$TMP/out" "$s"
check "personal edition: special + good_news + community + audio + ad" "len(d['special'])==1 and d['special'][0]['level']=='critical' and d['good_news'] and d['good_news']['kind']=='good_news' and all(c['community_id']=='jerusalem' for c in d['community']) and d['audio'] and d['audio']['audio_url'].startswith('http') and d['ad'] and d['ad']['sponsor'] and d['minutes']>=1 and d['is_premium'] is False" "$TMP/out" "$s"
ITEM=$(jget "d['items'][0]['id']")
OLD_FROM=$(date -u -d '-8 days' +%FT%TZ); NOW=$(date -u +%FT%TZ)
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$OLD_FROM\",\"p_to\":\"$NOW\"}"); check "personal edition 8 days back: archive_locked (free)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_archive '{"p_days":30}')
check "archive: shape + locked older than 7 days" "s==200 and len(d)>=20 and all(set(e)=={'id','edition_type','title','published_at','item_count','has_audio','read','locked'} for e in d) and any(e['locked'] for e in d) and not d[0]['locked'] and any(e['has_audio'] for e in d)" "$TMP/out" "$s"
RECENT=$(jget "[e for e in d if not e['locked'] and e['edition_type']!='special'][0]['id']")
OLD=$(jget "[e for e in d if e['locked']][0]['id']")
SPECIAL=$(jget "[e['id'] for e in d if e['edition_type']=='special'][0]")
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":\"$RECENT\"}"); check "edition view (recent)" "s==200 and len(d['items'])>=5 and d['good_news'] and d['ad'] is not None" "$TMP/out" "$s"
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":\"$SPECIAL\"}"); check "edition view (special)" "s==200 and d['edition_types']==['special'] and len(d['special'])==1 and d['items']==[]" "$TMP/out" "$s"
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":\"$OLD\"}");    check "edition view (8+ days old): archive_locked (free)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$FREE_DEMO" app_edition_view "{\"p_edition_id\":\"$OLD\"}"); check "edition view (8+ days old): archive_locked (free demo)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$PREM_DEMO" app_edition_view "{\"p_edition_id\":\"$OLD\"}"); check "edition view (8+ days old): ok (premium demo)" "s==200 and len(d['items'])>=5" "$TMP/out" "$s"
s=$(rpc "$FREE" app_search '{"p_query":"מים"}');                     check "search: premium_required (free)" "s>=400 and d['message']=='premium_required'" "$TMP/out" "$s"

echo "== RPCs: premium user"
s=$(rpc "$PREM" app_me); check "app_me premium" "s==200 and d['is_premium'] is True and d['plan']=='premium'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_personal_edition '{}');                          check "personal edition premium: no ad, informative" "s==200 and d['ad'] is None and d['is_premium'] is True and all(i['style']=='informative' for i in d['items'])" "$TMP/out" "$s"
s=$(rpc "$PREM" app_edition_view "{\"p_edition_id\":\"$OLD\"}");    check "edition view (8+ days old): premium ok" "s==200 and len(d['items'])>=5" "$TMP/out" "$s"
s=$(rpc "$PREM" app_personal_edition "{\"p_from\":\"$OLD_FROM\",\"p_to\":\"$NOW\"}"); check "personal edition 8 days back: premium ok, capped at max_items" "s==200 and 0<len(d['items'])<=10" "$TMP/out" "$s"
s=$(rpc "$PREM" app_search '{"p_query":"מים","p_limit":5}');         check "search: premium ok" "s==200 and 0<len(d)<=5 and all('מים' in (i['headline']+i['body']) for i in d)" "$TMP/out" "$s"
s=$(rpc "$PREM" app_archive '{}');                                    check "archive premium: nothing locked" "s==200 and not any(e['locked'] for e in d)" "$TMP/out" "$s"

echo "== saved, read, feedback, profile, device, donation (free user)"
s=$(rpc "$FREE" app_toggle_save "{\"p_item_id\":\"$ITEM\"}"); check "toggle save -> true" "s==200 and d is True" "$TMP/out" "$s"
s=$(rpc "$FREE" app_saved);                                    check "saved lists the item (saved=true)" "s==200 and len(d)>=1 and d[0]['id']=='$ITEM' and d[0]['saved'] is True" "$TMP/out" "$s"
s=$(rpc "$FREE" app_personal_edition '{}');                    check "feed shows saved flag" "any(i['id']=='$ITEM' and i['saved'] for i in d['items'])" "$TMP/out" "$s"
s=$(rpc "$FREE" app_toggle_save "{\"p_item_id\":\"$ITEM\"}"); check "toggle save -> false" "s==200 and d is False" "$TMP/out" "$s"
s=$(rpc "$FREE" app_saved);                                    check "saved no longer lists it" "s==200 and all(i['id']!='$ITEM' for i in d)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_mark_read "{\"p_edition_key\":\"$RECENT\"}"); check "mark_read" "s in (200,204)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_archive '{"p_days":3}');                   check "archive shows read=true" "any(e['id']=='$RECENT' and e['read'] for e in d)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"helpful\"}"); check "feedback helpful -> uuid" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"question\",\"p_message\":\"בדיקת עשן: שאלה לעורכים\"}"); check "feedback question with message" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"spam\"}"); check "feedback invalid kind" "s>=400 and d['message']=='invalid_kind'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"style":"light","frequency":1,"phone":"+972599999999","email":"x@y.z","text_scale":1.2}}')
check "update_profile: whitelist + derived slot_times" "s==200 and d['style']=='light' and d['frequency']==1 and d['slot_times']==['20:00'] and d['phone']=='$REG_PHONE' and d['email']=='$REG_EMAIL' and abs(d['text_scale']-1.2)<1e-6" "$TMP/out" "$s"
s=$(rpc "$FREE" app_personal_edition '{}');                    check "feed follows the new style (light)" "s==200 and all(i['style']=='light' for i in d['items'])" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"level_filter":"everything"}}'); check "update_profile: invalid value" "s>=400 and d['message']=='invalid_value'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"style":"calm","frequency":3,"text_scale":1}}'); check "update_profile: restore" "s==200 and d['style']=='calm' and d['slot_times']==['07:30','13:00','20:00']" "$TMP/out" "$s"
s=$(rpc "$FREE" app_register_device '{"p_token":"smoke-test-native-token","p_platform":"android"}'); check "register_device" "s in (200,204)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_record_donation '{"p_amount":36,"p_frequency":"once"}'); check "record_donation -> uuid" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_family_invite '{"p_phone":"0501234567","p_name":"x"}'); check "family_invite: not_family_owner" "s>=400 and d['message']=='not_family_owner'" "$TMP/out" "$s"

echo "== RLS with the user JWT"
s=$(get "$FREE" "app_items?select=id&limit=5");          check "no direct select on app_items" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_item_versions?select=item_id&limit=5"); check "no direct select on app_item_versions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_ads?select=id&limit=5");            check "no direct select on app_ads" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_subscriptions?select=id&limit=5");  check "no direct select on app_subscriptions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_pending_registrations?select=phone"); check "no direct select on app_pending_registrations" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_login_attempts?select=id&limit=1"); check "no direct select on app_login_attempts" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_profiles?select=id");               check "profiles: only own row" "s==200 and [r['id'] for r in d]==['$FREE_ID']" "$TMP/out" "$s"
s=$(get "$FREE" "app_profiles?select=id&id=eq.$PREM_DEMO_ID"); check "profiles: other user's row invisible" "s==200 and d==[]" "$TMP/out" "$s"
s=$(call PATCH "$SUPABASE_URL/rest/v1/app_profiles?id=eq.$FREE_ID" "$FREE" '{"phone":"+972599999999"}'); check "profiles: phone immutable" "s>=400 and 'immutable_field' in str(d)" "$TMP/out" "$s"
s=$(call PATCH "$SUPABASE_URL/rest/v1/app_profiles?id=eq.$PREM_DEMO_ID" "$FREE" '{"full_name":"hacked"}'); check "profiles: cannot update another user" "s in (200,204) and (d in (None, [], ''))" "$TMP/out" "$s"
s=$(call PATCH "$SUPABASE_URL/rest/v1/app_profiles?id=eq.$FREE_ID" "$FREE" '{"theme":"dark"}'); check "profiles: direct update of own prefs" "s in (200,204)" "$TMP/out" "$s"
call PATCH "$SUPABASE_URL/rest/v1/app_profiles?id=eq.$FREE_ID" "$FREE" '{"theme":"system"}' >/dev/null
s=$(get "$FREE" "app_editions?select=id,edition_type&limit=3"); check "editions readable when signed in" "s==200 and len(d)==3" "$TMP/out" "$s"
s=$(get "$FREE" "app_devices?select=push_token");        check "devices: own rows" "s==200 and [r['push_token'] for r in d]==['smoke-test-native-token']" "$TMP/out" "$s"

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "== push trigger (special edition -> pg_net -> app-push-special)"
  "$SQL" - >/dev/null <<'EOF'
delete from public.app_editions where external_id = 'smoke-special';
insert into public.app_editions (external_id, edition_type, language, audience, published_at, title, status)
values ('smoke-special', 'special', 'he', 'general', now(), 'בדיקת עשן', 'draft');
update public.app_editions set status = 'published' where external_id = 'smoke-special';
EOF
  sleep 6
  "$SQL" - > "$TMP/out" <<'EOF'
select coalesce(json_agg(json_build_object('status', status_code, 'body', content)), '[]') as r
from (select * from net._http_response where created > now() - interval '2 minutes'
      and (content like '%skipped%' or content like '%"sent"%') order by created desc limit 5) x;
EOF
  check "trigger called app-push-special (skipped without FCM secret)" "any(r['status']==200 for r in d[0]['r'])" "$TMP/out" 200
  echo "delete from public.app_editions where external_id = 'smoke-special';" | "$SQL" - >/dev/null
  s=$(call POST "$FN/app-push-special" "$ANON" '{"edition_id":"00000000-0000-0000-0000-000000000000"}'); check "push function rejects calls without the secret" "s==403" "$TMP/out" "$s"
fi

echo "== cleanup"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_devices?push_token=eq.smoke-test-native-token" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_attempts?phone=in.(%2B15555550199,%2B15555550111,%2B15555550123)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_pending_registrations?phone=in.(%2B15555550123,%2B15555550111)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_codes?phone=eq.%2B15555550123" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_subscriptions?external_ref=eq.smoke-test-premium" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_attempts?phone=in.(%2B15555550124,%2B15555550125)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_pending_registrations?phone=in.(%2B15555550124,%2B15555550125)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
for id in "${NEW_ID:-}" "${SPREM_ID:-}"; do   # deleting the auth user cascades to the profile and its rows
  [[ -n "$id" ]] && curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$id" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" && echo "  removed smoke user $id"
done

echo
echo "passed: $PASS  failed: $FAIL"
[[ $FAIL -eq 0 ]]
