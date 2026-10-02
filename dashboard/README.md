# נתוני שימוש — הדשבורד של תמצית החדשות

דף אחד שמציג את מה שקורה באפליקציה: כמה נרשמו והתקינו, מי פעיל ומי נוטש, מה נעשה באפליקציה, אילו גרסאות מותקנות
ושורה לכל קורא. מאותו דף אפשר גם לשלוח הודעה לכל המכשירים.

## איפה זה עלה

https://dashboard-production-3f85.up.railway.app — פרויקט `tamzit-app-dashboard` ב-Railway, שירות `dashboard`.
פריסה מחדש: `railway up --service dashboard` מתוך התיקייה הזו (צריך טוקן של הפרויקט ב-`RAILWAY_TOKEN`).
`/health` מחזיר `{"ok":true,"anon_key":true}`.

## איך נכנסים

מספר טלפון, וקוד שמגיע לדוא״ל של החשבון — אותה כניסה כמו באפליקציה. רק חשבון שכתובתו מופיעה
ב-`app_settings.console_admin_emails` יראה נתונים; לכל אחד אחר השרת מחזיר `not_an_operator`. הדף עצמו לא מחזיק שום
סוד: הוא קורא ל-`public.app_analytics` עם הטוקן של מי שנכנס.

## משתני סביבה

| משתנה | מה זה |
|---|---|
| `SUPABASE_URL` | כתובת הפרויקט (ברירת מחדל: הפרויקט של תמצית) |
| `SUPABASE_ANON_KEY` | המפתח הציבורי של האפליקציה (אותו מפתח שנמצא ב-APK) |
| `PORT` | נקבע על ידי Railway |

## הרצה מקומית

```bash
SUPABASE_ANON_KEY=... node server.js
```

הקוד של הנתונים עצמם נמצא במיגרציות (`supabase/migrations/0028…`, `0030…`), והמסך המקביל באפליקציה הוא
`mobile/src/features/console/AnalyticsScreen.tsx`.
