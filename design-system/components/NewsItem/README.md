# NewsItem

ידיעה אחת: נושא ושעה, מד חשיבות, כותרת, 2–4 שורות גוף, ושלוש פעולות (שמירה, שיתוף, משוב).

- `topic`, `time`, `level`, `headline`, ו־`children` או `body`.
- `defaultSaved` / `saved` + `onSaveChange`, `onShare` (פותח את כרטיס השיתוף), `onFeedback` (פותח את `FeedbackSheet`).
- הגוף גדל עם הגדרת גודל הטקסט של הקורא (`--tz-text-scale`).

אין תמונות, אין "קראו עוד" ואין קישור לכתבה אחרת: הידיעה שלמה בפני עצמה.
