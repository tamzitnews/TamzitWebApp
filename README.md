# תמצית החדשות: אפליקציה

אפליקציית המובייל של תמצית החדשות. אב הטיפוס הוא אפליקציית אנדרואיד מקורית (React Native / Expo), עם שרת Supabase בפרויקט `tamzitnews_v1`.

## לנסות את האפליקציה

- **APK להורדה:** <https://opoqjzjmretyvomuhvct.supabase.co/storage/v1/object/public/app-builds/android/tamzit-latest.apk>
- **בדפדפן:** נכנסים ל־appetize.io, מעלים את קובץ ה־APK (Upload), ומקבלים קישור שמריץ את האפליקציה באמולטור בדפדפן.
- **בטלפון אנדרואיד:** מורידים את הקובץ ומאשרים התקנה ממקור לא מוכר.

חשבונות הדגמה (לא נשלח מייל, הקוד תמיד `123456`):

| טלפון | מסלול |
| --- | --- |
| 0500000000 | חינם |
| 0500000001 | פרימיום (כולל הודעות מהעורכים) |
| 0500000002 | משפחתי (בעלים של מנוי משפחתי) |

## מה יש כאן

- `mobile/`: האפליקציה (Expo SDK 57). מדריך לסוכנים ולמפתחים: `mobile/docs/AGENT-GUIDE.md`.
- `supabase/`: טבלאות (`migrations/`), פונקציות שרת (`functions/`), נתוני דוגמה (`seed/`), סקריפטים (`scripts/`) ובדיקה מקצה לקצה (`tests/smoke.sh`).
- `docs/api-contract.md`: החוזה בין השרת לאפליקציה. `docs/engine-integration.md`: איך מנוע ההפקה כותב תוכן. `docs/build.md`: בנייה והעלאה של ה־APK.
- `design-system/`: מערכת העיצוב ותכנון האפליקציה (מותג, מסכים, סגנונות, מהדורות).

## בנייה

```bash
cd mobile && scripts/build-android.sh --upload
```

דורש Android SDK ב־`/opt/android-sdk`, ומשתני סביבה `SUPABASE_URL` ו־`SUPABASE_SERVICE_ROLE_KEY` להעלאה. פרטים ב־`docs/build.md`.
