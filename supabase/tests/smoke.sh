#!/usr/bin/env bash
# End-to-end smoke test of the Tamzit app backend (edge functions, RPCs, RLS, parser, push trigger) on the
# tamzitnews_v1 project, whose editions are the engine's real WhatsApp editions (tamzit_editions): the checks
# look at shapes and rules, not at fixed content. Nothing is written to the engine's tables.
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
s=$(get "$ANON" "app_settings?select=key,is_public,is_secret"); check "anon reads only public settings (never secrets / demo)" "s==200 and len(d)>=10 and all(r['is_public'] and not r['is_secret'] for r in d) and {'donation_url','free_archive_days','support_email','website_url','otp_resend_seconds'} <= {r['key'] for r in d} and not {'push_webhook_secret','demo_code','functions_base_url','edition_schedule'} & {r['key'] for r in d}" "$TMP/out" "$s"
s=$(get "$ANON" "tamzit_editions?select=id&limit=1");  check "anon cannot read tamzit_editions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$ANON" "user_preferences?select=user_id&limit=1"); check "anon cannot read user_preferences" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(rpc "$ANON" app_me);                               check "anon cannot call app_me" "s in (401,403,404)" "$TMP/out" "$s"

echo "== demo accounts (shared with testers, so only plan-level checks)"
s=$(rpc "$FREE" app_me); check "app_me free demo" "s==200 and d['is_premium'] is False and d['plan']=='free' and d['profile']['phone']=='+972500000000'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_me); check "app_me premium demo" "s==200 and d['is_premium'] is True and d['plan']=='premium'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_search '{"p_query":"ישראל"}');   check "search: premium_required (free demo)" "s>=400 and d['message']=='premium_required'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_search '{"p_query":"ישראל"}');   check "search: ok (premium demo)" "s==200 and isinstance(d, list)" "$TMP/out" "$s"
# The free demo's personal edition of the last 12 hours has real items whenever the engine sent one.
FROM12=$(date -u -d '-12 hours' +%FT%TZ)
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$FROM12\"}")
check "free demo, last 12 hours: real items (or no edition in that window)" "s==200 and (len(d['items'])>0 or d['edition_types']==[] or d['edition_types']==['special'])" "$TMP/out" "$s"
FREE_DEMO="$FREE"; PREM_DEMO="$PREM"; PREM_DEMO_ID="$PREM_ID"

# Feed and write checks run on the throwaway users, with a known baseline profile.
FREE="$NEW"; FREE_ID="$NEW_ID"; PREM="$SPREM"; PREM_ID="$SPREM_ID"
BASE='{"p_patch":{"language":"he","audience":"general","frequency":3,"slot_times":["07:30","13:00","20:00"],"level_filter":"important","topics":["security","economy","health","education","weather","transport","world"],"communities":["jerusalem"],"onboarded":true,"style":"STYLE"}}'
rpc "$FREE" app_update_profile "${BASE/STYLE/calm}" >/dev/null
rpc "$PREM" app_update_profile "${BASE/STYLE/informative}" >/dev/null

echo "== RPCs: free user"
s=$(rpc "$FREE" app_me); check "app_me free" "s==200 and d['is_premium'] is False and d['plan']=='free' and d['profile']['id']=='$FREE_ID' and isinstance(d['unread_messages'], int)" "$TMP/out" "$s"
FROM48=$(date -u -d '-48 hours' +%FT%TZ)
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$FROM48\"}")
check "personal edition (last 48h): shape" "s==200 and set(d)>={'window','edition_types','title','items','special','community','good_news','ad','audio','minutes','is_premium'}" "$TMP/out" "$s"
check "personal edition: items filtered + ordered + capped" "0<len(d['items'])<=10 and all(i['level']=='critical' or ((i['topic_id'] is None or any(t in ['security','economy','health','education','weather','transport','world'] for t in [i['topic_id']] + (i.get('topics') or []))) and i['level'] in ('critical','important')) for i in d['items']) and [ {'critical':3,'important':2,'general':1}[i['level']] for i in d['items'] ]==sorted([{'critical':3,'important':2,'general':1}[i['level']] for i in d['items']], reverse=True)" "$TMP/out" "$s"
check "personal edition: Hebrew items with string ids e<edition>-<n> / s<story>" "all(any('\u0590'<=ch<='\u05ff' for ch in i['body']) and isinstance(i['headline'], str) and (i['id'].startswith('e') or i['id'].startswith('s')) for i in d['items'])" "$TMP/out" "$s"
check "personal edition: no promo / credits / links in items" "not any(x in (i['headline']+i['body']) for i in d['items'] for x in ('http', 'link.mmb', 'כתיבה:', 'לשיתוף עם חברים', '•', '*'))" "$TMP/out" "$s"
check "personal edition: good_news, special, community, ad, audio shapes" "(d['good_news'] is None or d['good_news']['kind']=='good_news') and all(x['level']=='critical' for x in d['special']) and isinstance(d['community'], list) and (d['ad'] is None or (d['ad']['label'] and d['ad']['id'].startswith('ad') and 'image_url' in d['ad'])) and all('section' in x and 'subsection' in x for x in d['items']) and (d['audio'] is None or d['audio']['audio_url'].startswith('https://')) and d['minutes']>=1 and d['is_premium'] is False" "$TMP/out" "$s"
ITEM=$(jget "d['items'][0]['id']")
OLD_FROM=$(date -u -d '-8 days' +%FT%TZ); NOW=$(date -u +%FT%TZ)
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$OLD_FROM\",\"p_to\":\"$NOW\"}"); check "personal edition 8 days back: archive_locked (free)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_archive '{"p_days":30}')
check "archive: shape + locked older than 7 days" "s==200 and len(d)>=20 and all(set(e)=={'id','edition_type','title','published_at','item_count','has_audio','read','locked','track'} and isinstance(e['id'], str) for e in d) and any(e['locked'] for e in d) and not d[0]['locked'] and any(e['has_audio'] for e in d) and all(e['edition_type'] in ('morning','noon','evening','erev_shabbat','motzash','special') for e in d)" "$TMP/out" "$s"
RECENT=$(jget "[e for e in d if not e['locked'] and e['edition_type']!='special' and e['item_count']>=5][0]['id']")
WITH_AUDIO=$(jget "[e for e in d if not e['locked'] and e['has_audio']][0]['id']")
OLD=$(jget "[e for e in d if e['locked']][0]['id']")
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":\"$RECENT\"}"); check "edition view (recent): all items, unfiltered" "s==200 and len(d['items'])>=5 and d['title'] and (d['ad'] is None or d['ad']['body'])" "$TMP/out" "$s"
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":$WITH_AUDIO}");  check "edition view with audio: playable link, never a Drive link (numeric id param)" "s==200 and d['audio'] and d['audio']['audio_url'].startswith('https://') and 'drive.google.com' not in d['audio']['audio_url']" "$TMP/out" "$s"
s=$(rpc "$FREE" app_edition_view '{"p_edition_id":999999999}');      check "edition view: unknown id -> not_found" "s>=400 and d['message']=='not_found'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_edition_view "{\"p_edition_id\":\"$OLD\"}");    check "edition view (8+ days old): archive_locked (free)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$FREE_DEMO" app_edition_view "{\"p_edition_id\":\"$OLD\"}"); check "edition view (8+ days old): archive_locked (free demo)" "s>=400 and d['message']=='archive_locked'" "$TMP/out" "$s"
s=$(rpc "$PREM_DEMO" app_edition_view "{\"p_edition_id\":\"$OLD\"}"); check "edition view (8+ days old): ok (premium demo)" "s==200 and len(d['items'])>=1" "$TMP/out" "$s"
s=$(rpc "$FREE" app_search '{"p_query":"ישראל"}');                   check "search: premium_required (free)" "s>=400 and d['message']=='premium_required'" "$TMP/out" "$s"

echo "== RPCs: premium user"
s=$(rpc "$PREM" app_me); check "app_me premium" "s==200 and d['is_premium'] is True and d['plan']=='premium'" "$TMP/out" "$s"
s=$(rpc "$PREM" app_personal_edition "{\"p_from\":\"$FROM48\"}"); check "personal edition premium: no ad" "s==200 and d['ad'] is None and d['is_premium'] is True and len(d['items'])>0" "$TMP/out" "$s"
s=$(rpc "$PREM" app_archive '{"p_days":90}')
SPECIAL=$(jget "([e['id'] for e in d if e['edition_type']=='special'] + [''])[0]")
if [[ -n "$SPECIAL" ]]; then
  s=$(rpc "$PREM" app_edition_view "{\"p_edition_id\":\"$SPECIAL\"}"); check "edition view (special update): critical item in special" "s==200 and d['edition_types']==['special'] and len(d['special'])>=1 and d['special'][0]['level']=='critical' and d['items']==[] and d['title']" "$TMP/out" "$s"
fi
s=$(rpc "$PREM" app_edition_view "{\"p_edition_id\":\"$OLD\"}");    check "edition view (8+ days old): premium ok" "s==200 and len(d['items'])>=1" "$TMP/out" "$s"
s=$(rpc "$PREM" app_personal_edition "{\"p_from\":\"$OLD_FROM\",\"p_to\":\"$NOW\"}"); check "personal edition 8 days back: premium ok, capped at max_items" "s==200 and 0<len(d['items'])<=10" "$TMP/out" "$s"
s=$(rpc "$PREM" app_search '{"p_query":"ישראל","p_limit":5}');       check "search: premium ok, matching parsed items" "s==200 and 0<len(d)<=5 and all('ישראל' in (i['headline']+i['body']) for i in d)" "$TMP/out" "$s"
s=$(rpc "$PREM" app_archive '{}');                                    check "archive premium: nothing locked" "s==200 and not any(e['locked'] for e in d)" "$TMP/out" "$s"

echo "== saved, read, feedback, profile, device, donation (free user)"
s=$(rpc "$FREE" app_toggle_save "{\"p_item_id\":\"$ITEM\"}"); check "toggle save -> true" "s==200 and d is True" "$TMP/out" "$s"
s=$(rpc "$FREE" app_saved);                                    check "saved lists the item (saved=true)" "s==200 and len(d)>=1 and d[0]['id']=='$ITEM' and d[0]['saved'] is True" "$TMP/out" "$s"
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$FROM48\"}"); check "feed shows saved flag" "any(i['id']=='$ITEM' and i['saved'] for i in d['items'])" "$TMP/out" "$s"
s=$(rpc "$FREE" app_toggle_save '{"p_item_id":"e999999999-1"}');  check "toggle save: unknown item -> not_found" "s>=400 and d['message']=='not_found'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_toggle_save "{\"p_item_id\":\"$ITEM\"}"); check "toggle save -> false" "s==200 and d is False" "$TMP/out" "$s"
s=$(rpc "$FREE" app_saved);                                    check "saved no longer lists it" "s==200 and all(i['id']!='$ITEM' for i in d)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_mark_read "{\"p_edition_key\":\"$RECENT\"}"); check "mark_read" "s in (200,204)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_archive '{"p_days":3}');                   check "archive shows read=true" "any(e['id']=='$RECENT' and e['read'] for e in d)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"helpful\"}"); check "feedback helpful -> uuid" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"question\",\"p_message\":\"בדיקת עשן: שאלה לעורכים\"}"); check "feedback question with message" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_submit_feedback "{\"p_item_id\":\"$ITEM\",\"p_kind\":\"spam\"}"); check "feedback invalid kind" "s>=400 and d['message']=='invalid_kind'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"style":"light","frequency":1,"phone":"+972599999999","email":"x@y.z","text_scale":1.2}}')
check "update_profile: whitelist + derived slot_times" "s==200 and d['style']=='light' and d['frequency']==1 and d['slot_times']==['21:30'] and d['phone']=='$REG_PHONE' and d['email']=='$REG_EMAIL' and abs(d['text_scale']-1.2)<1e-6" "$TMP/out" "$s"
s=$(rpc "$FREE" app_me);                                       check "app_me follows the update (style light, frequency 1)" "s==200 and d['profile']['style']=='light' and d['profile']['frequency']==1" "$TMP/out" "$s"
s=$(rpc "$FREE" app_personal_edition "{\"p_from\":\"$FROM48\"}"); check "one edition a day (daily track): feed still builds" "s==200 and all(t in ('evening','noon','morning','erev_shabbat','motzash') for t in d['edition_types'])" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"level_filter":"everything"}}'); check "update_profile: invalid value" "s>=400 and d['message']=='invalid_value'" "$TMP/out" "$s"
s=$(rpc "$FREE" app_update_profile '{"p_patch":{"style":"calm","frequency":3,"text_scale":1}}'); check "update_profile: restore" "s==200 and d['style']=='calm' and d['slot_times']==['10:00','16:00','21:30']" "$TMP/out" "$s"
s=$(rpc "$FREE" app_register_device '{"p_token":"smoke-test-native-token","p_platform":"android"}'); check "register_device" "s in (200,204)" "$TMP/out" "$s"
s=$(rpc "$FREE" app_record_donation '{"p_amount":36,"p_frequency":"once"}'); check "record_donation -> uuid" "s==200 and len(d)==36" "$TMP/out" "$s"
s=$(rpc "$FREE" app_family_invite '{"p_phone":"0501234567","p_name":"x"}'); check "family_invite: not_family_owner" "s>=400 and d['message']=='not_family_owner'" "$TMP/out" "$s"

echo "== RLS with the user JWT"
s=$(get "$FREE" "tamzit_editions?select=id&limit=5");          check "no direct select on tamzit_editions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "tamzit_edition_elements?select=id&limit=5");  check "no direct select on tamzit_edition_elements" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "processed_stories?select=id&limit=5");        check "no direct select on processed_stories" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "user_preferences?select=user_id");            check "no direct select on user_preferences (profile via app_me)" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(call PATCH "$SUPABASE_URL/rest/v1/user_preferences?user_id=eq.$PREM_DEMO_ID" "$FREE" '{"name":"hacked"}'); check "cannot update another user's preferences" "s in (401,403) or (s in (200,204) and d in (None, [], ''))" "$TMP/out" "$s"
s=$(get "$FREE" "app_subscriptions?select=id&limit=5");  check "no direct select on app_subscriptions" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_pending_registrations?select=phone"); check "no direct select on app_pending_registrations" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_login_attempts?select=id&limit=1"); check "no direct select on app_login_attempts" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_push_log?select=key&limit=1");      check "no direct select on app_push_log" "s in (401,403) or d==[]" "$TMP/out" "$s"
s=$(get "$FREE" "app_devices?select=push_token");        check "devices: own rows" "s==200 and [r['push_token'] for r in d]==['smoke-test-native-token']" "$TMP/out" "$s"

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "== parser on real editions (every language and edition type)"
  "$SQL" - > "$TMP/out" <<'SQLEND'
with latest as (
  select distinct on (language, edition_type) id, language, edition_type, main_text
  from public.tamzit_editions order by language, edition_type, created_at desc
)
select coalesce(json_agg(json_build_object(
  'id', l.id, 'lang', l.language, 'type', l.edition_type, 'title', public.app_edition_title(l.main_text),
  'n', (select count(*) from public.app_parse_edition(l.main_text, l.edition_type) p where p.kind = 'news'),
  'has_good', l.main_text ~ 'ונסיים בטוב|positive note|good note|note positive|bonne note',
  'good', (select count(*) from public.app_parse_edition(l.main_text, l.edition_type) p where p.kind = 'good_news'),
  'junk', (select count(*) from public.app_parse_edition(l.main_text, l.edition_type) p
           where p.body ~ '(https?://|link\.mmb|כתיבה:|Author:|Rédaction|לשיתוף עם חברים|תוכן שיווקי|[*•])'))), '[]') as r
from latest l;
SQLEND
  check "every language/type parses into items, good news where the edition has it, and no promo" "len(d[0]['r'])>=6 and all(e['junk']==0 and (e['n']>=1 if e['type']=='special_update' else (e['n']>=3 and e['title'] and (e['good']==1 if e['has_good'] else e['good']==0))) for e in d[0]['r'])" "$TMP/out" 200

  echo "== settings catalog"
  "$SQL" - > "$TMP/out" <<'SQLEND'
select json_build_object(
  'rows', (select count(*) from public.app_settings),
  'undocumented', (select coalesce(json_agg(key), '[]') from public.app_settings
                   where title is null or description !~ 'מה זה:' or description !~ 'איפה זה ממומש:' or value_type is null),
  'no_default', (select coalesce(json_agg(key), '[]') from public.app_settings where default_value is null and value_type <> 'url' and not is_secret)) as r;
SQLEND
  check "every setting has a title, an explanation (what / where) and a type" "d[0]['r']['rows']>=50 and d[0]['r']['undocumented']==[] and d[0]['r']['no_default']==[]" "$TMP/out" 200
  echo "update public.app_settings set value = '\"abc\"' where key = 'max_items'" | "$SQL" - > "$TMP/raw" 2>&1
  if grep -q 'לא תקין' "$TMP/raw"; then ok "a value of the wrong type is refused (Hebrew message)"; else bad "a value of the wrong type is refused" "$(cat "$TMP/raw")"; fi
  echo "select public.app_setting_int('no_such_key', 42) as a, public.app_setting_int('max_items', 0) as b, public.app_regex_any(array['a.b','x|y']) as c" | "$SQL" - > "$TMP/out"
  check "setting readers: default for a missing key, value otherwise, regex escaping" "d[0]['a']==42 and d[0]['b']>=1 and d[0]['c']=='(a\\\\.b|x\\\\|y)'" "$TMP/out" 200

  echo "== push trigger (on a temporary copy of tamzit_editions: nothing is written to the engine's table)"
  echo "select json_build_object('trigger', (select tgenabled from pg_trigger where tgname = 'app_tamzit_editions_push' and tgrelid = 'public.tamzit_editions'::regclass)) as r" | "$SQL" - > "$TMP/out"
  check "trigger app_tamzit_editions_push is installed and enabled" "d[0]['r']['trigger']=='O'" "$TMP/out" 200
  "$SQL" - > "$TMP/raw" 2>&1 <<'SQLEND'
do $$
declare v_log int; v_elog int; v_q0 bigint; v_q1 bigint; v_text text := 'smoke special ' || clock_timestamp();
begin
  create temp table smoke_editions (like public.tamzit_editions including defaults) on commit drop;
  create trigger smoke_push after insert on smoke_editions for each row execute function public.app_tamzit_editions_push();
  select count(*) into v_q0 from net.http_request_queue;
  insert into smoke_editions (id, main_text, language, edition_type, time_slot, edition_date) values
    (-1, v_text, 'hebrew', 'special_update', 'עדכון מיוחד', '1999-01-01'),
    (-2, v_text, 'hebrew', 'special_update', 'עדכון מיוחד', '1999-01-01'),   -- duplicate row: no second push
    (-3, 'smoke classic', 'hebrew', 'classic', 'ערב', '1999-01-01'),          -- a regular edition: one push
    (-4, 'smoke classic', 'hebrew', 'classic', 'ערב', '1999-01-01');          -- its duplicate row: no second push
  select count(*) into v_log from public.app_push_log where key = 'special:hebrew:' || md5(v_text);
  select count(*) into v_elog from public.app_push_log where key = 'edition:hebrew:classic:evening:1999-01-01';
  select count(*) into v_q1 from net.http_request_queue;
  raise exception 'SMOKE {"log": %, "elog": %, "queued": %}', v_log, v_elog, v_q1 - v_q0;   -- rolls everything back
end $$;
SQLEND
  python3 -c "import json,re; raw=open('$TMP/raw').read(); raw=raw[raw.index('{'):raw.rindex('}')+1]; msg=json.loads(raw).get('message',''); m=re.search(r'SMOKE (\{[^}]*\})', msg); open('$TMP/out','w').write(m.group(1) if m else '{}')"
  check "trigger claims one push per special update and one per regular edition (rolled back)" "d.get('log')==1 and d.get('elog')==1 and d.get('queued')==2" "$TMP/out" 200
  SECRET=$(echo "select value #>> '{}' as v from public.app_settings where key = 'push_webhook_secret'" | "$SQL" - | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['v'])")
  CONSOLE=$(echo "select value #>> '{}' as v from public.app_settings where key = 'push_console_secret'" | "$SQL" - | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['v'])")
  OLD_SPECIAL=$(echo "select id from public.tamzit_editions where edition_type = 'special_update' order by created_at limit 1" | "$SQL" - | python3 -c "import json,sys; r=json.load(sys.stdin); print(r[0]['id'] if r else 0)")
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-push" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -H "x-app-secret: $SECRET" -d "{\"edition_id\":$OLD_SPECIAL}")
  check "push function: secret accepted, old special update not re-pushed" "s==200 and d.get('skipped') is True and d.get('reason')=='too_old'" "$TMP/out" "$s"
  s=$(call POST "$FN/app-push" "$ANON" '{"edition_id":1}'); check "push function rejects calls without the secret" "s==403" "$TMP/out" "$s"

  echo "select public.app_ad_images_needed(48) as r" | "$SQL" - > "$TMP/out"
  check "ads without a WhatsApp image are listed for the Whapi step" "isinstance(d[0]['r']['ids'], list) and (d[0]['r']['since'] is not None) == (len(d[0]['r']['ids']) > 0)" "$TMP/out" 200

  echo "== who sees what: weather/sports only for readers who chose them, critical items for everyone (rolled back)"
  "$SQL" - > "$TMP/out" <<SQLEND
begin;
update public.user_preferences set interests = array['world', 'security'], anxiety_level = 'Medium'
where user_id = '$FREE_ID';
-- a weather forecast item of the last days
create temp table w as
  select l.text_hash, 'e' || e.id || '-' || p.n as item_id
  from public.app_reader_editions('he', 'general', 3, now() - interval '5 days', now()) e
  cross join lateral public.app_parse_edition(e.main_text, e.edition_type) p
  join public.app_item_labels l on l.text_hash = public.app_item_hash('he', p.headline, p.body) and l.main_topic = 'weather'
  order by e.published_at desc limit 1;
select set_config('request.jwt.claims', '{"sub":"$FREE_ID","role":"authenticated"}', true);
set local role authenticated;
create temp table f1 as select public.app_personal_edition(now() - interval '5 days', now()) j;
reset role;
-- the tsunami case: the same weather item, now critical
update public.app_item_labels set importance = 'critical', importance_confidence = 0.95 where text_hash = (select text_hash from w);
set local role authenticated;
create temp table f2 as select public.app_personal_edition(now() - interval '5 days', now()) j;
reset role;
select json_build_object(
  'weather_item', (select item_id from w),
  'normal_items', (select jsonb_array_length(j -> 'items') from f1),
  'normal_weather_or_sports', (select count(*) from f1, jsonb_array_elements(f1.j -> 'items') x where x ->> 'topic_id' in ('weather','sports')),
  'normal_topics', (select json_agg(distinct x ->> 'topic_id') from f1, jsonb_array_elements(f1.j -> 'items') x),
  'critical_case_has_weather', (select count(*) from f2, jsonb_array_elements(f2.j -> 'items') x where x ->> 'topic_id' = 'weather'),
  'critical_case_level', (select json_agg(x ->> 'level') from f2, jsonb_array_elements(f2.j -> 'items') x where x ->> 'topic_id' = 'weather')
) r;
rollback;
SQLEND
  check "a reader without weather/sports sees none of them; the same weather item marked critical reaches them" "d[0]['r']['weather_item'] is None or (d[0]['r']['normal_weather_or_sports']==0 and d[0]['r']['critical_case_has_weather']==1 and d[0]['r']['critical_case_level']==['critical'])" "$TMP/out" 200

  echo "== WhatsApp sends (Whapi)"
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-whapi" -H 'Content-Type: application/json' -H 'x-whapi-secret: wrong' -d '{"messages":[]}')
  check "whapi webhook rejects a wrong secret" "s==403" "$TMP/out" "$s"
  s=$(call POST "$FN/app-whapi" "$ANON" '{"action":"status"}'); check "whapi operations need the app secret" "s==403" "$TMP/out" "$s"
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
create temp table r as select
  public.app_ingest_special(E'📻 *עדכון מיוחד*\n\nבדיקת עשן: ידיעה שנשלחה בערוץ.', now() - interval '3 hours') as first_id,
  public.app_is_special_text(E'📻 *תמצית החדשות*\n\nמהדורת בוקר') as edition_is_special;
create temp table r2 as select public.app_ingest_special(E'📻 *עדכון מיוחד*\n\nבדיקת עשן: ידיעה שנשלחה בערוץ.', now() - interval '3 hours') as second_id;
select json_build_object(
  'first', (select first_id from r), 'second', (select second_id from r2), 'edition', (select edition_is_special from r),
  'row', (select json_build_object('type', edition_type, 'slot', time_slot, 'lang', language) from public.tamzit_editions where id = (select first_id from r)),
  'pushed', (select count(*) from public.app_push_log where edition_id = (select first_id from r))) as r;
rollback;
SQLEND
  check "a special update sent on WhatsApp is written once, as the engine wrote them (rolled back; too old to push)" "d[0]['r']['first'] and d[0]['r']['second'] is None and d[0]['r']['edition'] is False and d[0]['r']['row']=={'type':'special_update','slot':'עדכון מיוחד','lang':'hebrew'} and d[0]['r']['pushed']==0" "$TMP/out" 200
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
create temp table k as select
  (select row_to_json(x) from public.app_edition_of_text(E'📻 *תמצית החדשות*\n*מהדורת ערב, יום רביעי*, 30 בספטמבר') x) as he_evening,
  (select row_to_json(x) from public.app_edition_of_text(E'*קוראים יקרים,*\n*המהדורה הבאה תישלח במוצאי שבת.*\n\n•   •   •\n\n📻 *תמצית החדשות*\n*מהדורת צוהריים, יום שישי*') x) as he_friday,
  (select row_to_json(x) from public.app_edition_of_text(E'📻 *תמצית החדשות*\n*המהדורה היומית, י״ח בתשרי*') x) as he_daily,
  (select row_to_json(x) from public.app_edition_of_text(E'📻 *Israel News Highlights*\n*Morning Edition: Wednesday*') x) as en_morning,
  (select row_to_json(x) from public.app_edition_of_text(E'📻 *L''essentiel de l''actualité*\n*Édition du soir: samedi*') x) as fr_evening,
  (select (x).language from public.app_edition_of_text(E'📻 *עדכון מיוחד*\n\nבדיקה') x) as special_lang;
create temp table e1 as select public.app_ingest_sent(E'📻 *תמצית החדשות*\n*מהדורת ערב, יום שישי, בדיקת עשן*, 1 בינואר 1999\n\n•   •   •\n\n📌 *_בדיקה:_*\n• ידיעה ראשונה של בדיקת העשן, שנשלחה בוואטסאפ ולא נרשמה על ידי המנוע, כדי לוודא שהיא נקלטת פעם אחת בלבד ובשפה הנכונה.\n\n• ידיעה שנייה של בדיקת העשן, שנשלחה באותה הודעה, כדי שהטקסט יהיה באורך של מהדורה אמיתית ולא של הודעה קצרה.\n\n•   •   •\n\nכתיבה: בדיקה.', '1999-01-01 16:00+00', 'smoke') as j;
create temp table e2 as select public.app_ingest_sent((select main_text from public.tamzit_editions where id = ((select j from e1) ->> 'id')::bigint), '1999-01-01 16:10+00') as j;
create temp table a1 as select public.app_ingest_sent(E'> המהדורה בחסות:\n\n*בדיקת עשן* - מודעת חסות לבדיקה בלבד.\nhttps://example.org/smoke', '1999-01-01 16:02+00') as j;
create temp table a2 as select public.app_ingest_sent(E'> המהדורה בחסות:\n\n*בדיקת עשן* - מודעת חסות לבדיקה בלבד.\nhttps://example.org/smoke', '1999-01-01 16:03+00') as j;
create temp table n1 as select public.app_ingest_sent(E'*קוראים יקרים,*\nהמהדורה הבאה תישלח מחר.', '1999-01-01 16:04+00') as j;
select json_build_object('k', (select row_to_json(k) from k),
  'e1', (select j from e1), 'e2', (select j from e2), 'a1', (select j from a1), 'a2', (select j from a2), 'n1', (select j from n1),
  'row', (select json_build_object('lang', language, 'type', edition_type, 'slot', time_slot, 'date', edition_date) from public.tamzit_editions where id = ((select j from e1) ->> 'id')::bigint),
  'from_whapi', (select count(*) from public.app_whapi_editions where edition_id = ((select j from e1) ->> 'id')::bigint),
  'ad_edition', (select edition_id from public.tamzit_edition_elements where id = ((select j from a1) ->> 'id')::bigint) = ((select j from e1) ->> 'id')::bigint,
  'pushed', (select count(*) from public.app_push_log where edition_id = ((select j from e1) ->> 'id')::bigint)) as r;
rollback;
SQLEND
  check "edition headers are read as the engine names them (Friday notice first, daily, English, French)" "d[0]['r']['k']['he_evening']=={'language':'hebrew','edition_type':'classic','time_slot':'ערב'} and d[0]['r']['k']['he_friday']=={'language':'hebrew','edition_type':'classic','time_slot':'צהריים'} and d[0]['r']['k']['he_daily']['edition_type']=='daily' and d[0]['r']['k']['en_morning']=={'language':'english','edition_type':'classic','time_slot':'בוקר'} and d[0]['r']['k']['fr_evening']['language']=='french' and d[0]['r']['k']['special_lang'] is None" "$TMP/out" 200
  check "an edition sent on WhatsApp that the engine did not log is written once, with its sponsor ad (rolled back; too old to push)" "d[0]['r']['e1']['kind']=='edition' and d[0]['r']['e1']['id'] and d[0]['r']['e2']['id'] is None and d[0]['r']['row']=={'lang':'hebrew','type':'classic','slot':'ערב','date':'1999-01-01'} and d[0]['r']['from_whapi']==1 and d[0]['r']['a1']['id'] and d[0]['r']['a2']['id'] is None and d[0]['r']['ad_edition'] is True and d[0]['r']['n1']=={} and d[0]['r']['pushed']==0" "$TMP/out" 200
  echo "select json_build_object('jobs', (select json_agg(jobname order by jobname) from cron.job where jobname like 'app-%')) as r" | "$SQL" - > "$TMP/out"
  check "no polling: the only app cron job is the hourly housekeeping check" "d[0]['r']['jobs']==['app-housekeeping']" "$TMP/out" 200

  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
create temp table flat as select E'📻 *תמצית החדשות*\n*מהדורת בוקר*\nיום ו׳, 1 בינואר · בדיקת עשן\n\n'
  || E'• *כותרת ראשונה של בדיקת העשן* גוף הידיעה הראשונה, שנכתבה בפורמט החדש של תבליטים בלי כותרות פרקים.\n\n'
  || E'• *כותרת שנייה של בדיקת העשן* גוף הידיעה השנייה, שנכתב באורך דומה לידיעה אמיתית, כדי שהמהדורה כולה תעבור את אורך המינימום שנדרש כדי להיחשב מהדורה ולא הודעה קצרה.\n\n'
  || E'✓ *לשיתוף עם חברים לוחצים כאן*\nlink.mmb.org.il/share' as t;
create temp table notice as select E'📻 *תמצית החדשות*\n*מהדורת ערב, יום שישי*, 1 בינואר 1999\n\n'
  || repeat('קוראים יקרים, המהדורה הבאה תישלח במוצאי שבת. ', 12) as t;
select json_build_object(
  'flat_items', (select count(*) from flat, public.app_parse_edition(flat.t, 'classic') p where p.kind = 'news'),
  'flat_heads', (select count(*) from flat, public.app_parse_edition(flat.t, 'classic') p where coalesce(p.headline, '') <> ''),
  'flat_junk', (select count(*) from flat, public.app_parse_edition(flat.t, 'classic') p
                where p.body ~ '(link\.mmb|לשיתוף עם חברים|[*•])'),
  'classic_untouched', (select count(*) from public.app_parse_edition(
      (select main_text from public.tamzit_editions where edition_type = 'classic' and language = 'hebrew'
       and main_text like '%📌%' order by created_at desc limit 1), 'classic') p where p.kind = 'news') >= 3,
  'notice_not_ingested', (select public.app_ingest_edition((select t from notice), '1999-01-01 16:00+00')) is null,
  'flat_ingested', (select public.app_ingest_edition((select t from flat), '1999-01-01 06:00+00')) is not null) as r;
rollback;
SQLEND
  check "an edition of bullets with no section headings parses into items with headlines, and a notice is never written" "d[0]['r']['flat_items']==2 and d[0]['r']['flat_heads']==2 and d[0]['r']['flat_junk']==0 and d[0]['r']['classic_untouched'] is True and d[0]['r']['notice_not_ingested'] is True and d[0]['r']['flat_ingested'] is True" "$TMP/out" 200

  echo "== usage events and the dashboard"
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
create temp table me as select user_id from public.user_preferences
  where exists (select 1 from auth.users u where u.id = user_id) order by created_at limit 1;
create temp table asme as select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from me), 'role', 'authenticated')::text, true) as x;
create temp table w as select public.app_track(jsonb_build_array(
  jsonb_build_object('name', 'app_open', 'props', jsonb_build_object('cold', true), 'session_id', 'smoke', 'app_version', '0.0.0-smoke', 'platform', 'android'),
  jsonb_build_object('name', 'audio_play', 'props', jsonb_build_object('id', 'x'), 'session_id', 'smoke'),
  jsonb_build_object('name', 'session_end', 'props', jsonb_build_object('seconds', 60), 'session_id', 'smoke'),
  jsonb_build_object('name', 'not_a_real_event', 'props', '{}'::jsonb),
  jsonb_build_object('name', 'app_open', 'props', jsonb_build_object('big', repeat('x', 4000)))
)) as n from asme;
create temp table denied as select public.app_analytics(7) as j from (
  select set_config('request.jwt.claims', json_build_object('sub', (select user_id from me), 'role', 'authenticated')::text, true)) z;
rollback;
SQLEND
  check "a reader's own events are written, unknown names and oversized props are dropped, and a reader cannot read the dashboard" "'not_an_operator' in open('$TMP/out').read()" "$TMP/out" 200
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
update public.app_settings set value = to_jsonb(array[(select lower(email) from auth.users order by created_at limit 1)])
  where key = 'console_admin_emails';
create temp table asop as select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true) as x;
create temp table n as select public.app_track(jsonb_build_array(
  jsonb_build_object('name', 'ad_click', 'props', jsonb_build_object('element_id', 1), 'session_id', 'smoke2'),
  jsonb_build_object('name', 'nope')
)) as c from asop;
create temp table a as select public.app_analytics(7) as j from asop;
select json_build_object(
  'written', (select c from n),
  'people_keys', (select array(select jsonb_object_keys((select j from a) -> 'people')) @> array['registered','churned','at_risk']),
  'ads_counted', (((select j from a) -> 'engagement' ->> 'ad_clicks')::int) >= 1,
  'daily_len', jsonb_array_length((select j from a) -> 'daily'),
  'readers_is_array', jsonb_typeof((select j from a) -> 'readers') = 'array',
  'versions_is_array', jsonb_typeof((select j from a) -> 'versions') = 'array') as r;
rollback;
SQLEND
  check "the dashboard answers an operator with people, use, versions and a row per reader" "d[0]['r']['written']==1 and d[0]['r']['people_keys'] is True and d[0]['r']['ads_counted'] is True and d[0]['r']['daily_len']==14 and d[0]['r']['readers_is_array'] is True and d[0]['r']['versions_is_array'] is True" "$TMP/out" 200
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
do $do$ begin
  perform public.app_register_device('smoke-token-old', 'android');
  perform public.app_register_device('smoke-token-new', 'android', '0.1.0 (14)', 14);
end $do$;
select json_build_object(
  'kept_version', (select app_version from public.app_devices where push_token = 'smoke-token-new'),
  'kept_build', (select app_build from public.app_devices where push_token = 'smoke-token-new'),
  'old_build_still_works', exists (select 1 from public.app_devices where push_token = 'smoke-token-old')) as r;
rollback;
SQLEND
  check "a device registers with its installed version, and an older build still registers without one" "d[0]['r']['kept_version']=='0.1.0 (14)' and d[0]['r']['kept_build']==14 and d[0]['r']['old_build_still_works'] is True" "$TMP/out" 200

  echo "== messages to readers (the operators' console)"
  s=$(call POST "$FN/app-push" "$ANON" '{"action":"audience"}')
  check "the console refuses a reader who is not an operator" "s==403 and d.get('error')=='not_an_operator'" "$TMP/out" "$s"
  s=$(call POST "$FN/app-push" "$ANON" '{"action":"made_up"}')
  check "the console refuses an action it does not have" "s==400 and d.get('error')=='unknown_action'" "$TMP/out" "$s"
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-push" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -H "x-app-secret: $CONSOLE" -d '{"action":"broadcast","dry_run":true,"title":"בדיקת עשן","body":"בדיקה, לא נשלח."}')
  check "a dry run says how many devices would get the message, and sends nothing" "s==200 and d.get('dry_run') is True and 'awake' in d and 'sent' not in d" "$TMP/out" "$s"
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-push" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -H "x-app-secret: $CONSOLE" -d '{"action":"broadcast","dry_run":true,"body":"בדיקה","url":"javascript:alert(1)"}')
  check "a message link must be http(s)" "s==400 and d.get('error')=='bad_url'" "$TMP/out" "$s"
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-push" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -H "x-app-secret: $CONSOLE" -d '{"edition_id":1}')
  check "the console secret cannot push an edition" "s==403" "$TMP/out" "$s"
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
update public.app_settings set value = '[]'::jsonb where key = 'console_admin_emails';
create temp table r1 as select public.app_is_console_admin((select id from auth.users order by created_at limit 1)) as none;
update public.app_settings set value = to_jsonb(array[(select lower(email) from auth.users order by created_at limit 1)])
  where key = 'console_admin_emails';
create temp table r0 as select public.app_is_console_admin((select id from auth.users order by created_at limit 1)) as listed;
update public.app_settings set value = to_jsonb(array['  ' || upper((select email from auth.users order by created_at limit 1)) || ' '])
  where key = 'console_admin_emails';
create temp table r2 as select public.app_is_console_admin((select id from auth.users order by created_at limit 1)) as loose;
select json_build_object(
  'empty_list_allows_nobody', (select none from r1),
  'listed_is_operator', (select listed from r0),
  'case_and_spaces_still_match', (select loose from r2),
  'me_tells_the_app', pg_get_functiondef('public.app_me'::regproc) like '%is_operator%') as r;
rollback;
SQLEND
  check "only a listed address is an operator (case and spaces ignored), and app_me tells the app" "d[0]['r']['empty_list_allows_nobody'] is False and d[0]['r']['listed_is_operator'] is True and d[0]['r']['case_and_spaces_still_match'] is True and d[0]['r']['me_tells_the_app'] is True" "$TMP/out" 200

  echo "== item classification (Jev; shadow mode unless jev_apply_to_feed)"
  s=$(call POST "$FN/app-classify" "$ANON" '{}'); check "classify function rejects calls without the secret" "s==403" "$TMP/out" "$s"
  s=$(curl -sS -o "$TMP/out" -w '%{http_code}' -X POST "$FN/app-classify" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -H "x-app-secret: $SECRET" -d '{}')
  check "classify function: runs, or skips without TYPESAFE_API_KEY" "s==200 and (d.get('ok') is True or d.get('reason') in ('no_api_key','disabled'))" "$TMP/out" "$s"
  "$SQL" - > "$TMP/out" <<'SQLEND'
begin;
update public.app_settings set value = 'false' where key = 'jev_apply_to_feed';   -- shadow mode first (rolled back)
create temp table q1 as select public.app_label_queue(3) as j;
create temp table q2 as select public.app_label_queue(3) as j;
update public.app_item_labels l set status = 'ok', topics = array['sports'], importance = 'critical', importance_confidence = 0.99
where l.text_hash in (select x ->> 'hash' from q1, jsonb_array_elements(q1.j) x);
create temp table shadow as
  select count(*) filter (where i.item ? 'topics') as n from q1, jsonb_array_elements(q1.j) x
  cross join lateral public.app_item_by_id(x ->> 'item_id', x ->> 'lang', 'general', 'informative', null) as i(item);
update public.app_settings set value = 'true' where key = 'jev_apply_to_feed';
select json_build_object(
  'q1', (select jsonb_array_length(j) from q1),
  'overlap', (select count(*) from q1, jsonb_array_elements(q1.j) a, q2, jsonb_array_elements(q2.j) b where a ->> 'hash' = b ->> 'hash'),
  'shadow_topics', (select n from shadow),
  'applied', (select count(*) from q1, jsonb_array_elements(q1.j) x
              cross join lateral public.app_item_by_id(x ->> 'item_id', x ->> 'lang', 'general', 'informative', null) as i(item)
              where i.item -> 'topics' ? 'sports' and i.item ->> 'topic_id' = 'sports' and i.item ->> 'level' = 'critical')) as r;
rollback;
SQLEND
  check "label queue: claims items once; labels change nothing in shadow mode, set topics and level when applied (rolled back)" "d[0]['r']['q1']==0 or (d[0]['r']['overlap']==0 and d[0]['r']['shadow_topics']==0 and d[0]['r']['applied']==d[0]['r']['q1'])" "$TMP/out" 200
  "$SQL" - > "$TMP/out" <<'SQLEND'
with l as (select l.item_id, l.lang from public.app_item_labels l where l.status = 'ok' and l.item_id is not null order by l.updated_at desc limit 5)
select json_build_object(
  'apply', public.app_setting_bool('jev_apply_to_feed', false), 'show', public.app_setting_bool('jev_show_labels', false),
  'n', (select count(*) from l),
  'with_ai', (select count(*) from l cross join lateral public.app_item_by_id(l.item_id, l.lang, 'general', 'informative', null) as i(item)
              where jsonb_typeof(i.item -> 'ai' -> 'topics') = 'array' and i.item -> 'topics' is not null)) as r;
SQLEND
  check "labelled items carry topics (and the pilot's ai line) when applied" "not d[0]['r']['apply'] or d[0]['r']['n']==0 or d[0]['r']['with_ai']==(d[0]['r']['n'] if d[0]['r']['show'] else 0)" "$TMP/out" 200
  echo "select json_build_object('n', count(*), 'no_topic', count(*) filter (where cardinality(topics) = 0 or main_topic is null), 'general', count(*) filter (where importance = 'general')) as r from public.app_item_labels where status = 'ok' and updated_at > '2026-09-30 14:40+00'" | "$SQL" - > "$TMP/out"
  check "every classified item has a main topic, and no item is 'general' (nothing hidden by level)" "d[0]['r']['no_topic']==0 and d[0]['r']['general']==0" "$TMP/out" 200
fi

echo "== cleanup"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_devices?push_token=eq.smoke-test-native-token" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_attempts?phone=in.(%2B15555550199,%2B15555550111,%2B15555550123)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_pending_registrations?phone=in.(%2B15555550123,%2B15555550111)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_codes?phone=eq.%2B15555550123" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_subscriptions?external_ref=eq.smoke-test-premium" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_login_attempts?phone=in.(%2B15555550124,%2B15555550125)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/app_pending_registrations?phone=in.(%2B15555550124,%2B15555550125)" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
for id in "${NEW_ID:-}" "${SPREM_ID:-}"; do
  # user_preferences has no FK to auth.users: delete the profile (cascades to the app_ rows), then the auth user
  [[ -n "$id" ]] || continue
  curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/rest/v1/user_preferences?user_id=eq.$id" -H "apikey: $SRV" -H "Authorization: Bearer $SRV"
  curl -sS -o /dev/null -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$id" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" && echo "  removed smoke user $id"
done

echo
echo "passed: $PASS  failed: $FAIL"
[[ $FAIL -eq 0 ]]
