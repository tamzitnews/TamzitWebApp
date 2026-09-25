# בניית אפליקציית האנדרואיד

בנייה מקומית של APK חתום (release) של "תמצית החדשות", בלי EAS ובלי Android Studio.

## דרישות

- Android SDK ב־`/opt/android-sdk` (או `ANDROID_HOME`): platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1.
- JDK 17 ומעלה (JDK 21 עובד), Node 22, ו־`node_modules` מותקן (`npm ci`).
- משתני הסביבה `SUPABASE_URL` ו־`SUPABASE_SERVICE_ROLE_KEY` (להורדת מפתח החתימה ולהעלאה).

## בנייה

```sh
cd mobile
scripts/build-android.sh            # מעלה את versionCode ב־1 ובונה
scripts/build-android.sh --upload   # בונה ומעלה ל־Supabase
scripts/build-android.sh --no-bump --no-clean   # בנייה חוזרת מהירה, בלי לשנות גרסה
```

הסקריפט מריץ `expo prebuild --clean` (התיקייה `android/` נוצרת מחדש ואינה ב־git), מחיל את הגדרות Gradle
ואת חתימת ה־release, בונה `assembleRelease` ובודק את התוצאה: חתימה, שם החבילה, versionCode, ארכיטקטורות
`arm64-v8a` ו־`x86_64`, וש־bundle ה־JS מוטמע (Hermes). בנייה ראשונה במכונה נקייה לוקחת כחצי שעה; בנייה חוזרת כמה דקות.

- ה־APK נוצר ב־`mobile/dist/tamzit-<version>-<versionCode>.apk` (התיקייה `dist/` אינה ב־git).
- לוג הבנייה: `mobile/dist/build-android.log`.
- הגרסה (`version`) ו־`android.versionCode` נמצאים ב־`mobile/app.json`. כל בנייה מעלה את versionCode, כדי שאפשר יהיה להתקין מעל גרסה קודמת. אחרי בנייה יש לעשות commit ל־`app.json`.
- התלות ב־Maven Central עוברת דרך המראה הרשמית של Google, כי Maven Central חוסם לפעמים (HTTP 429) בסביבת הענן.

## העלאה

```sh
scripts/upload-apk.sh               # מעלה את ה־APK האחרון מ־dist/
```

הקובץ עולה לדלי הציבורי `app-builds` בשני שמות, ובנוסף קובץ `latest.json` עם הגרסה, הגודל וה־sha256:

- גרסה קבועה: `$SUPABASE_URL/storage/v1/object/public/app-builds/android/tamzit-<version>-<versionCode>.apk`
- תמיד האחרונה: `$SUPABASE_URL/storage/v1/object/public/app-builds/android/tamzit-latest.apk`

מגבלת הקובץ בפרויקט Supabase היא 50MB. אם ה־APK גדל מעבר לזה, ההעלאה תיכשל.

## מפתח החתימה

- המפתח נשמר מחוץ ל־git ב־`~/.tamzit-signing/` (`tamzit-release.jks`, alias `tamzit`, והסיסמה ב־`keystore.properties`).
- גיבוי בדלי הפרטי `app-private`, בנתיב `android/signing/`. בסשן חדש הסקריפט מוריד אותו משם אוטומטית.
- **אסור לאבד אותו ואסור ליצור חדש.** אנדרואיד מסרב לעדכן אפליקציה שנחתמה במפתח אחר: המשתמשים יצטרכו למחוק ולהתקין מחדש.

## הרצה בדפדפן (Appetize.io)

1. נכנסים ל־<https://appetize.io/upload>.
2. מדביקים את הקישור של `tamzit-latest.apk`, או מעלים את הקובץ מ־`mobile/dist/`.
3. בוחרים מכשיר אנדרואיד (Pixel, Android 14 ומעלה) ולוחצים Play. ה־APK כולל `x86_64`, ולכן הוא רץ באמולטורים של Appetize.
4. לבדיקת עברית: בהגדרות ה־Appetize בוחרים שפה `he` / אזור `IL`, או מחליפים שפה בתוך האפליקציה.

## התקנה בטלפון

1. פותחים בדפדפן של הטלפון את הקישור של `tamzit-latest.apk` ומורידים.
2. פותחים את הקובץ. בפעם הראשונה אנדרואיד יבקש לאשר "התקנה ממקורות לא ידועים" לדפדפן.
3. מתקינים. גרסה חדשה מותקנת מעל הישנה (אותו מפתח חתימה, versionCode גבוה יותר).

עם כבל USB ו־adb: `adb install -r mobile/dist/tamzit-<version>-<versionCode>.apk`.
