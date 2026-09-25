-- Tamzit app: reference data (topics, cities, communities, settings). Idempotent upserts.

insert into public.app_topics (id, name_he, name_en, name_fr, sort, is_default, active) values
  ('politics',  'פוליטיקה',        'Politics',            'Politique',               10, false, true),
  ('security',  'ביטחון',          'Security',            'Sécurité',                20, true,  true),
  ('economy',   'כלכלה',           'Economy',             'Économie',                30, true,  true),
  ('health',    'בריאות',          'Health',              'Santé',                   40, true,  true),
  ('education', 'חינוך',           'Education',           'Éducation',               50, true,  true),
  ('law',       'משפט',            'Law',                 'Justice',                 60, false, true),
  ('world',     'עולם',            'World',               'Monde',                   70, true,  true),
  ('science',   'מדע וטכנולוגיה',  'Science & Tech',      'Sciences et technologie', 80, false, true),
  ('transport', 'תחבורה',          'Transport',           'Transports',              90, true,  true),
  ('weather',   'מזג אוויר',       'Weather',             'Météo',                  100, true,  true),
  ('consumer',  'צרכנות',          'Consumer',            'Consommation',           110, false, true),
  ('judaism',   'יהדות ומסורת',    'Judaism & Tradition', 'Judaïsme et tradition',  120, false, true),
  ('culture',   'תרבות',           'Culture',             'Culture',                130, false, true),
  ('sports',    'ספורט',           'Sports',              'Sport',                  140, false, true)
on conflict (id) do update set
  name_he = excluded.name_he, name_en = excluded.name_en, name_fr = excluded.name_fr,
  sort = excluded.sort, is_default = excluded.is_default, active = excluded.active;

insert into public.app_cities (id, name_he, name_en, name_fr, lat, lon, tzid, in_israel, candle_minutes, sort, active) values
  ('jerusalem',     'ירושלים',        'Jerusalem',        'Jérusalem',        31.7683, 35.2137, 'Asia/Jerusalem', true, 40,  10, true),
  ('tel-aviv',      'תל אביב־יפו',    'Tel Aviv-Yafo',    'Tel Aviv-Jaffa',   32.0853, 34.7818, 'Asia/Jerusalem', true, 20,  20, true),
  ('haifa',         'חיפה',           'Haifa',            'Haïfa',            32.7940, 34.9896, 'Asia/Jerusalem', true, 30,  30, true),
  ('beer-sheva',    'באר שבע',        'Beersheba',        'Beer-Sheva',       31.2518, 34.7913, 'Asia/Jerusalem', true, 20,  40, true),
  ('modiin',        'מודיעין',        'Modiin',           'Modiin',           31.8980, 35.0104, 'Asia/Jerusalem', true, 20,  50, true),
  ('rishon-lezion', 'ראשון לציון',    'Rishon LeZion',    'Rishon LeZion',    31.9730, 34.7925, 'Asia/Jerusalem', true, 20,  60, true),
  ('petah-tikva',   'פתח תקווה',      'Petah Tikva',      'Petah Tikva',      32.0840, 34.8878, 'Asia/Jerusalem', true, 20,  70, true),
  ('ashdod',        'אשדוד',          'Ashdod',           'Ashdod',           31.8014, 34.6435, 'Asia/Jerusalem', true, 20,  80, true),
  ('netanya',       'נתניה',          'Netanya',          'Netanya',          32.3215, 34.8532, 'Asia/Jerusalem', true, 20,  90, true),
  ('bnei-brak',     'בני ברק',        'Bnei Brak',        'Bné Brak',         32.0807, 34.8338, 'Asia/Jerusalem', true, 20, 100, true),
  ('holon',         'חולון',          'Holon',            'Holon',            32.0158, 34.7874, 'Asia/Jerusalem', true, 20, 110, true),
  ('ramat-gan',     'רמת גן',         'Ramat Gan',        'Ramat Gan',        32.0684, 34.8248, 'Asia/Jerusalem', true, 20, 120, true),
  ('rehovot',       'רחובות',         'Rehovot',          'Rehovot',          31.8928, 34.8113, 'Asia/Jerusalem', true, 20, 130, true),
  ('ashkelon',      'אשקלון',         'Ashkelon',         'Ashkelon',         31.6688, 34.5743, 'Asia/Jerusalem', true, 20, 140, true),
  ('beit-shemesh',  'בית שמש',        'Beit Shemesh',     'Beit Shemesh',     31.7470, 34.9881, 'Asia/Jerusalem', true, 20, 150, true),
  ('kfar-saba',     'כפר סבא',        'Kfar Saba',        'Kfar Saba',        32.1750, 34.9070, 'Asia/Jerusalem', true, 20, 160, true),
  ('herzliya',      'הרצליה',         'Herzliya',         'Herzliya',         32.1624, 34.8447, 'Asia/Jerusalem', true, 20, 170, true),
  ('raanana',       'רעננה',          'Ra''anana',        'Ra''anana',        32.1848, 34.8713, 'Asia/Jerusalem', true, 20, 180, true),
  ('hadera',        'חדרה',           'Hadera',           'Hadera',           32.4340, 34.9197, 'Asia/Jerusalem', true, 20, 190, true),
  ('afula',         'עפולה',          'Afula',            'Afoula',           32.6078, 35.2897, 'Asia/Jerusalem', true, 20, 200, true),
  ('tiberias',      'טבריה',          'Tiberias',         'Tibériade',        32.7922, 35.5312, 'Asia/Jerusalem', true, 20, 210, true),
  ('safed',         'צפת',            'Safed',            'Safed',            32.9646, 35.4960, 'Asia/Jerusalem', true, 20, 220, true),
  ('karmiel',       'כרמיאל',         'Karmiel',          'Karmiel',          32.9190, 35.2950, 'Asia/Jerusalem', true, 20, 230, true),
  ('eilat',         'אילת',           'Eilat',            'Eilat',            29.5577, 34.9519, 'Asia/Jerusalem', true, 20, 240, true),
  ('paris',         'פריז',           'Paris',            'Paris',            48.8566,   2.3522, 'Europe/Paris',        false, 18, 500, true),
  ('london',        'לונדון',         'London',           'Londres',          51.5074,  -0.1278, 'Europe/London',       false, 18, 510, true),
  ('new-york',      'ניו יורק',       'New York',         'New York',         40.7128, -74.0060, 'America/New_York',    false, 18, 520, true),
  ('montreal',      'מונטריאול',      'Montreal',         'Montréal',         45.5019, -73.5674, 'America/Toronto',     false, 18, 530, true),
  ('los-angeles',   'לוס אנג''לס',    'Los Angeles',      'Los Angeles',      34.0522, -118.2437, 'America/Los_Angeles', false, 18, 540, true)
on conflict (id) do update set
  name_he = excluded.name_he, name_en = excluded.name_en, name_fr = excluded.name_fr, lat = excluded.lat,
  lon = excluded.lon, tzid = excluded.tzid, in_israel = excluded.in_israel,
  candle_minutes = excluded.candle_minutes, sort = excluded.sort, active = excluded.active;

insert into public.app_communities (id, name_he, name_en, name_fr, description_he, description_en, description_fr, city_id, sort, active) values
  ('jerusalem', 'ירושלים', 'Jerusalem', 'Jérusalem',
   'עדכונים מקומיים מהעיר: תחבורה, עבודות, תרבות ומה שקורה בשכונות.',
   'Local updates from the city: transport, roadworks, culture and neighbourhood news.',
   'L''actualité locale de la ville : transports, travaux, culture et vie des quartiers.',
   'jerusalem', 10, true),
  ('tel-aviv', 'תל אביב־יפו', 'Tel Aviv-Yafo', 'Tel Aviv-Jaffa',
   'מה שקורה בעיר: תחבורה, חופים, אירועים ושירותים עירוניים.',
   'What''s happening in the city: transport, beaches, events and municipal services.',
   'La vie de la ville : transports, plages, événements et services municipaux.',
   'tel-aviv', 20, true),
  ('haifa', 'חיפה והקריות', 'Haifa and the Krayot', 'Haïfa et les Krayot',
   'עדכונים מחיפה ומהקריות: תחבורה, סביבה, קהילה ותרבות.',
   'Updates from Haifa and the Krayot: transport, environment, community and culture.',
   'Haïfa et les Krayot : transports, environnement, vie locale et culture.',
   'haifa', 30, true),
  ('beer-sheva', 'באר שבע והנגב', 'Beersheba and the Negev', 'Beer-Sheva et le Néguev',
   'חדשות מקומיות מבאר שבע ומיישובי הנגב.',
   'Local news from Beersheba and the Negev communities.',
   'L''actualité locale de Beer-Sheva et des localités du Néguev.',
   'beer-sheva', 40, true),
  ('modiin', 'מודיעין', 'Modiin', 'Modiin',
   'עדכונים מהעיר: חינוך, תחבורה, פארקים ואירועים.',
   'City updates: education, transport, parks and events.',
   'La ville au quotidien : éducation, transports, parcs et événements.',
   'modiin', 50, true)
on conflict (id) do update set
  name_he = excluded.name_he, name_en = excluded.name_en, name_fr = excluded.name_fr,
  description_he = excluded.description_he, description_en = excluded.description_en,
  description_fr = excluded.description_fr, city_id = excluded.city_id, sort = excluded.sort, active = excluded.active;

insert into public.app_settings (key, value) values
  ('free_archive_days',   '7'),
  ('max_items',           '10'),
  ('donation_url',        '"https://www.charidy.com/lokchimachrayut/tam"'),
  ('support_email',       '"support@tamzit.org.il"'),
  ('demo_phone',          '"+972500000000"'),
  ('demo_code',           '"123456"'),
  ('demo_email',          '"demo@tamzit-app.test"'),
  ('demo_premium_phone',  '"+972500000001"'),
  ('demo_premium_email',  '"demo-premium@tamzit-app.test"')
on conflict (key) do update set value = excluded.value;
