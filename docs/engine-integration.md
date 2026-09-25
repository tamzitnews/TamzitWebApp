# חיבור המנוע לאפליקציה

המסמך מסביר איך מערכת ההפקה (המנוע) כותבת תוכן לאפליקציה: ידיעות, גרסאות, מהדורות, אודיו, פרסומות ועדכונים מיוחדים. החוזה המלא של הטבלאות והפונקציות נמצא ב־[`api-contract.md`](api-contract.md).

## עקרונות

- **הכתיבה נעשית עם מפתח ה־service role בלבד**, מהשרת. המפתח עוקף את ה־RLS, ולכן אסור שיגיע לאפליקציה או לדפדפן. האפליקציה קוראת רק דרך ה־RPCs.
- **כל האובייקטים מתחילים ב־`app_`.** בפרויקט יש גם טבלאות `tmz_*` של מערכת אחרת; לא נוגעים בהן.
- **כל שורה של המנוע נושאת `external_id` יציב** (המזהה אצל המנוע), וכותבים תמיד ב־upsert לפיו. כך אפשר לשלוח שוב את אותה ידיעה או מהדורה בלי ליצור כפילויות, ותיקון הוא פשוט שליחה חוזרת.
- **זמנים ב־ISO 8601 עם אזור זמן** (למשל `2026-09-25T07:30:00+03:00`). השדה `published_at` קובע מתי השורה נראית: ה־RPCs וה־RLS מסתירים כל מה ש־`published_at` שלו בעתיד, כך שאפשר להכין מהדורה מראש.
- **ערכים מותרים** (CHECK בבסיס הנתונים): שפה `he|en|fr`, קהל `general|youth`, רמה `critical|important|general`, סגנון `calm|human|informative|light`, סוג ידיעה `news|good_news|community`, סוג מהדורה `morning|noon|evening|erev_shabbat|motzash|special`.
- **בסיס הכתובת**: `https://<project-ref>.supabase.co`. בדוגמאות: `$SUPABASE_URL` ו־`$SERVICE_KEY`.

כותרות לכל קריאת REST:

```http
apikey: $SERVICE_KEY
Authorization: Bearer $SERVICE_KEY
Content-Type: application/json
```

## הדרך המומלצת: מהדורה שלמה בקריאה אחת

הפונקציה `app_engine_upsert_edition(p_edition jsonb)` (service role בלבד) מקבלת מהדורה עם הידיעות והגרסאות שלה, ועושה הכל בטרנזקציה אחת:

1. upsert של המהדורה לפי `external_id` (בסטטוס `draft` בזמן הכתיבה),
2. upsert של כל ידיעה לפי `external_id`, ושל כל גרסה לפי `(item_id, language, audience, style)`,
3. החלפת רשימת הידיעות של המהדורה ברשימה שנשלחה (הסדר במערך הוא ה־`position`),
4. ורק בסוף כתיבת הסטטוס הסופי (ברירת המחדל `published`).

הסטטוס נכתב אחרון בכוונה: כך עדכון מיוחד שולח התראה רק כשהידיעות שלו כבר בבסיס הנתונים.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/app_engine_upsert_edition" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' \
  -d '{
  "p_edition": {
    "external_id": "ed-he-general-2026-09-25-morning",
    "edition_type": "morning",
    "language": "he",
    "audience": "general",
    "published_at": "2026-09-25T07:30:00+03:00",
    "title": null,
    "items": [
      {
        "external_id": "item-48213",
        "topic_id": "weather",
        "level": "important",
        "kind": "news",
        "published_at": "2026-09-25T06:50:00+03:00",
        "versions": [
          { "language": "he", "audience": "general", "style": "calm",
            "headline": "חם מהרגיל היום, ובערב נעים יותר",
            "body": "הטמפרטורות יגיעו לכ־34 מעלות בשפלה ובעמקים. מספיק לשתות מים ולהישאר בצל בשעות הצהריים." },
          { "language": "he", "audience": "general", "style": "informative",
            "headline": "34 מעלות בשפלה ובעמקים היום, הקלה בערב",
            "body": "עומס חום בינוני: עד 34 מעלות בצהריים. משרד הבריאות ממליץ לשתות ולהימנע ממאמץ בשמש בין 11:00 ל־16:00." },
          { "language": "en", "audience": "general", "style": "informative",
            "headline": "Up to 34°C in the lowlands today",
            "body": "A moderate heat load is expected, peaking around midday." }
        ]
      },
      {
        "external_id": "item-48220",
        "kind": "good_news",
        "topic_id": "science",
        "level": "general",
        "versions": [ { "language": "he", "style": "calm", "headline": "…", "body": "…" } ]
      }
    ]
  }
}'
```

התשובה היא ה־`id` של המהדורה. שליחה חוזרת של אותו JSON לא משנה דבר; שליחה עם טקסט מתוקן מעדכנת את הגרסאות.

אותה ידיעה יכולה להופיע בכמה מהדורות (למשל גם בעברית וגם באנגלית, או במהדורת הבוקר ובמהדורת הנוער): שולחים אותה עם אותו `external_id`, והגרסאות מצטרפות לאותה ידיעה.

## כתיבה ישירה לטבלאות (REST)

אם נוח יותר לכתוב טבלה־טבלה, זה הסדר.

### ידיעה (`app_items`)

```bash
curl -X POST "$SUPABASE_URL/rest/v1/app_items?on_conflict=external_id" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates,return=representation' \
  -d '[{ "external_id": "item-48213", "topic_id": "weather", "level": "important", "kind": "news",
         "published_at": "2026-09-25T06:50:00+03:00", "status": "published" }]'
```

התשובה מחזירה את ה־`id` (uuid) שצריך בשלבים הבאים. ידיעה מקומית: `kind = 'community'` ו־`community_id` (למשל `jerusalem`). "ונסיים בטוב": `kind = 'good_news'`.

### גרסאות (`app_item_versions`)

שורה לכל שפה × קהל × סגנון שהמנוע הפיק. סגנון חסר נופל ל־`informative`, ואחר כך לכל סגנון קיים, ולכן **כדאי תמיד לכתוב לפחות `informative`** לכל שפה. בידיעות על אסון, מוות או אבל, הגרסאות `light` ו־`human` צריכות להיות בנוסח המרגיע (ראו `design-system/app/03-editorial.md`).

```bash
curl -X POST "$SUPABASE_URL/rest/v1/app_item_versions?on_conflict=item_id,language,audience,style" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates' \
  -d '[{ "item_id": "<uuid>", "language": "he", "audience": "general", "style": "calm",
         "headline": "…", "body": "…" },
       { "item_id": "<uuid>", "language": "he", "audience": "youth", "style": "light",
         "headline": "…", "body": "…" }]'
```

### מהדורה (`app_editions`) והידיעות שלה (`app_edition_items`)

1. יוצרים את המהדורה ב־upsert עם `"status": "draft"` (`on_conflict=external_id`, `return=representation`).
2. כותבים את `app_edition_items`: `{ edition_id, item_id, position }` (ב־`on_conflict=edition_id,item_id`). ידיעה שהוצאה מהמהדורה נמחקת מהטבלה הזו.
3. מעדכנים את המהדורה ל־`"status": "published"`:

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/app_editions?external_id=eq.ed-he-general-2026-09-25-morning" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' \
  -d '{ "status": "published" }'
```

מהדורה נכתבת לכל שילוב של שפה וקהל בנפרד (`he/general`, `he/youth`, `en/general`, `fr/general`). הקורא רואה רק מהדורות בשפה ובקהל שלו.

המהדורה האישית של כל קורא נבנית מכל המהדורות שפורסמו מאז המהדורה הקודמת שלו, ולכן המנוע לא צריך להכיר את הקוראים: מספיק לפרסם את מהדורות הבוקר, הצהריים והערב בזמן.

## תיקון, ביטול ומשוב

- **תיקון ידיעה**: כותבים מחדש את הגרסאות (upsert) ומעדכנים `corrected_at` לזמן התיקון. האפליקציה מציגה "עודכן" עם השעה.
- **ביטול ידיעה**: `status = 'retracted'`. הידיעה נעלמת מכל המהדורות, מהחיפוש ומהשמורים.
- **משוב מהקוראים**: `app_feedback` עם `status = 'new'`. תשובה של העורכים: מעדכנים `reply`, `replied_at`, `status = 'replied'`, ושולחים לקורא הודעה בתוך האפליקציה:

```sql
insert into public.app_messages (profile_id, title, body, item_id)
select profile_id, 'תשובה מהעורכים', 'תודה על השאלה. …', item_id
from public.app_feedback where id = '<feedback id>';
```

## אודיו (`app_audio`)

1. מעלים את הקובץ ל־Storage, לדלי הציבורי `app-media`, תחת `audio/`:

```bash
curl -X POST "$SUPABASE_URL/storage/v1/object/app-media/audio/2026-09-25-edition-he.mp3" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: audio/mpeg' -H 'x-upsert: true' --data-binary @edition.mp3
```

2. הכתובת הציבורית: `$SUPABASE_URL/storage/v1/object/public/app-media/audio/2026-09-25-edition-he.mp3`.
3. כותבים שורה (upsert לפי `external_id`):

```json
{ "external_id": "audio-2026-09-25-he", "kind": "edition", "edition_id": "<uuid או null>",
  "language": "he", "audience": "general", "title": "המהדורה הקולית · יום שישי 25.9",
  "audio_url": "https://…/app-media/audio/2026-09-25-edition-he.mp3", "duration_sec": 84,
  "published_at": "2026-09-25T07:00:00+03:00", "status": "published" }
```

המהדורה מציגה את האודיו שמקושר אליה, ואם אין, את האודיו האחרון בשפה ובקהל שלה מ־24 השעות האחרונות, עם עדיפות ל־`kind = 'edition'` על פני `flash`.

## פרסומות (`app_ads`)

פרסומת אחת במהדורה, רק לקוראים בלי מנוי. נבחרת פרסומת פעילה (`active`), בטווח התאריכים (`starts_at` עד `ends_at`), בשפה ובקהל של המהדורה. פרסומת עם `edition_id` מופיעה רק במהדורה הזו וקודמת לאחרות; בין השאר הבחירה אקראית לפי `weight`.

```json
{ "external_id": "ad-2026-10-farm", "sponsor": "…", "body": "טקסט קצר, בלי תמונות", "link_url": "https://…",
  "language": "he", "audience": "general", "starts_at": "2026-10-01T00:00:00+03:00",
  "ends_at": "2026-10-31T23:59:00+02:00", "weight": 2, "active": true }
```

## עדכון מיוחד והתראות

עדכון מיוחד הוא מהדורה מסוג `special` עם ידיעה אחת או יותר (בדרך כלל ידיעה קריטית אחת). באפליקציה הוא מופיע בפרק נפרד בראש המהדורה.

**מה שולח התראה**: הטריגר `app_editions_push_special` על `app_editions` קורא לפונקציה `app-push-special` (דרך `pg_net`) ברגע שמהדורה מסוג `special` עוברת ל־`published`: כשהיא נוצרת ישר כ־`published`, או במעבר מ־`draft` ל־`published`. עדכונים נוספים של אותה מהדורה לא שולחים שוב, והפונקציה מסמנת `pushed_at` כדי לא לשלוח פעמיים.

לכן:

- כותבים את העדכון עם `app_engine_upsert_edition` (הסטטוס נכתב אחרון), או ב־REST: קודם `draft`, אחר כך הידיעות, ורק בסוף `published`.
- `published_at` של עדכון מיוחד צריך להיות "עכשיו". ההתראה נשלחת ברגע הפרסום, לא בזמן עתידי.
- ההתראה נשלחת למכשירים של קוראים עם `special_push = true`, באותה שפה ובאותו קהל. קוראים שבעיר השבת שלהם (`shabbat_city_id`) נמצאים עכשיו בשבת או ביום טוב לא מקבלים התראה.
- נוסח ההתראה: "עדכון מיוחד" וטקסט כללי, או הכותרת של הידיעה הראשונה אם הקורא בחר `headline_in_push`.
- ההתראות לא פעילות עד שמגדירים ב־Supabase את הסוד `FCM_SERVICE_ACCOUNT` (ה־JSON של חשבון השירות של Firebase). בלעדיו הפונקציה מחזירה `{ skipped: true }`. טוקנים של Expo (`ExponentPushToken[…]`) נשלחים דרך שירות ההתראות של Expo גם בלי הסוד.

התראות המהדורה הרגילות (בשעות שהקורא בחר) אינן חלק מהמנגנון הזה.

## מנויים (`app_subscriptions`)

זכאות לפרימיום נשמרת **לפי מספר טלפון** (E.164, למשל `+972501234567`), כך שמנוי וואטסאפ מזוהה כשהוא נרשם לאפליקציה באותו מספר. הקורא הוא פרימיום אם יש לו שורה פעילה (`starts_at <= now()` ו־`ends_at` ריק או בעתיד), או שהוא חבר (`invited` או `joined`) במשפחה שלבעליה יש מנוי `family` פעיל.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/app_subscriptions?on_conflict=external_ref" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates' \
  -d '[{ "external_ref": "wa-sub-99812", "phone": "+972501234567", "plan": "premium", "source": "whatsapp",
         "starts_at": "2026-01-01T00:00:00+02:00", "ends_at": null }]'
```

ביטול מנוי: מעדכנים `ends_at`. לא מוחקים שורות, כדי לשמור היסטוריה.

## הגדרות (`app_settings`)

`free_archive_days` (7), `max_items` (10), `donation_url`, `support_email` גלויים לאפליקציה. `demo_*` משמשים לחשבונות ההדגמה. `functions_base_url` ו־`push_webhook_secret` הם פנימיים לטריגר ההתראות. הערך הוא JSON: מספר (`7`) או מחרוזת (`"https://…"`).

## לוח זמנים, שבת וחג

- המנוע מפרסם מהדורות בוקר, צהריים וערב. ביום שישי ובערב חג מפרסמים מהדורת `erev_shabbat` לפני כניסת השבת, ואחרי צאת השבת או החג מהדורת `motzash` שמסכמת את מה שהיה. `title` יכול לדרוס את השם (למשל "מהדורת מוצאי יום הכיפורים").
- מכניסת השבת ועד צאתה לא מפרסמים מהדורות ולא עדכונים מיוחדים.
- עדיף לכתוב מהדורה כמה דקות מראש עם `published_at` בשעה המתוכננת: היא תופיע בדיוק בזמן.

## נתוני הדוגמה

הפרויקט מכיל כרגע תוכן לדוגמה (ידיעות כלליות, בלי אנשים או אירועים אמיתיים), שכל ה־`external_id` שלו מתחיל ב־`sample-`. לפני העלייה לאוויר מוחקים אותו:

```sql
delete from public.app_audio    where external_id like 'sample-%';
delete from public.app_ads      where external_id like 'sample-%';
delete from public.app_editions where external_id like 'sample-%';
delete from public.app_items    where external_id like 'sample-%';
```

(קובצי האודיו לדוגמה נמצאים ב־`app-media/audio/sample-*`.) המחולל `supabase/seed/generate_sample_content.py` יוצר את התוכן מחדש ביחס לזמן הנוכחי, ו־`supabase/tests/smoke.sh` בודק את כל הזרימה מקצה לקצה.
