#!/usr/bin/env python3
"""Generate the SAMPLE content seed (supabase/seed/002_sample_content.sql) relative to "now".

    python3 supabase/seed/generate_sample_content.py [--audio] [--now 2026-09-25T13:00:00+03:00] [--apply]

* Editions for the last 9 days (Asia/Jerusalem): morning 07:30, noon 13:00, evening 20:00; no editions from
  candle lighting to havdalah (Shabbat and Yom Tov, Jerusalem times); erev_shabbat edition on Friday 14:00
  (13:00 on the eve of a weekday Yom Tov) and a motzash edition after Shabbat / Yom Tov. A few editions of the
  next ~36 hours are included as "scheduled" rows: the RPCs and RLS hide anything with published_at > now().
* he/general in all four styles; en + fr (informative, calm) and he/youth (light, calm) for the last three days.
* One special edition a few hours before now, ads, and (with --audio) daily audio + two flashes, synthesised
  with gTTS (fallback: espeak-ng) and uploaded to the public bucket app-media.
Everything uses external_id 'sample-…' and deterministic uuids; the SQL first deletes previous sample rows.
"""
import argparse
import datetime as dt
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import urllib.request
import uuid
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sample_content as C  # noqa: E402

TZ = ZoneInfo('Asia/Jerusalem')
UTC = dt.timezone.utc
NS = uuid.UUID('9a0f6f0e-7c55-4d2b-9a57-3a8f0d7c1e21')
JLM = (31.7683, 35.2137)
CANDLE_MIN = 40
HAVDALAH_MIN = 40
DAYS = 9
FULL_DAYS = 3  # en / fr / youth for the last three days
HERE = os.path.dirname(os.path.abspath(__file__))

# Yom Tov days (Israel) of 5787 around the seed window, with names for titles.
YOM_TOV = {
    dt.date(2026, 9, 12): ('ראש השנה', 'Rosh Hashanah', 'Roch Hachana'),
    dt.date(2026, 9, 13): ('ראש השנה', 'Rosh Hashanah', 'Roch Hachana'),
    dt.date(2026, 9, 21): ('יום הכיפורים', 'Yom Kippur', 'Yom Kippour'),
    dt.date(2026, 9, 26): ('סוכות', 'Sukkot', 'Souccot'),
    dt.date(2026, 10, 3): ('שמיני עצרת', 'Shemini Atzeret', 'Chemini Atseret'),
    dt.date(2027, 4, 22): ('פסח', 'Passover', 'Pessah'),
    dt.date(2027, 4, 28): ('שביעי של פסח', 'Passover', 'Pessah'),
    dt.date(2027, 6, 11): ('שבועות', 'Shavuot', 'Chavouot'),
}
SUKKOT_FROM = dt.date(2026, 9, 22)  # holiday-season items appear only after Yom Kippur
SEASONAL = {'sukkot_vacation', 'four_species', 'sukkot_festival', 'sukkah_safety', 'library_hours',
            'gn_sukkah_volunteers', 'c_sukkah_contest', 'c_parking', 'free_museums'}


def uid(ext: str) -> str:
    return str(uuid.uuid5(NS, ext))


def sunset(day: dt.date, lat: float = JLM[0], lon: float = JLM[1]) -> dt.datetime:
    """Sunset (UTC) with the classic almanac algorithm (zenith 90°50')."""
    n = day.timetuple().tm_yday
    lng_hour = lon / 15
    t = n + ((18 - lng_hour) / 24)
    m = (0.9856 * t) - 3.289
    ll = (m + 1.916 * math.sin(math.radians(m)) + 0.020 * math.sin(math.radians(2 * m)) + 282.634) % 360
    ra = math.degrees(math.atan(0.91764 * math.tan(math.radians(ll)))) % 360
    ra = (ra + (math.floor(ll / 90) * 90 - math.floor(ra / 90) * 90)) / 15
    sin_dec = 0.39782 * math.sin(math.radians(ll))
    cos_dec = math.cos(math.asin(sin_dec))
    cos_h = (math.cos(math.radians(90.833)) - sin_dec * math.sin(math.radians(lat))) / (cos_dec * math.cos(math.radians(lat)))
    h = math.degrees(math.acos(cos_h)) / 15
    ut = (h + ra - 0.06571 * t - 6.622 - lng_hour) % 24
    return dt.datetime(day.year, day.month, day.day, tzinfo=UTC) + dt.timedelta(hours=ut)


def is_rest(day: dt.date) -> bool:
    return day.weekday() == 5 or day in YOM_TOV


def rest_label(day: dt.date):
    """(he, en, fr) name of the rest day, or None for a plain Shabbat."""
    if day in YOM_TOV:
        he, en, fr = YOM_TOV[day]
        if day.weekday() == 5:
            return (f'שבת ו{he}' if he != 'סוכות' else 'שבת וחג', f'Shabbat and {en}', f'Chabbat et {fr}')
        return YOM_TOV[day]
    return None


def local(day: dt.date, hh: int, mm: int) -> dt.datetime:
    return dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=TZ)


def round5(t: dt.datetime) -> dt.datetime:
    t = t.astimezone(TZ)
    return t.replace(minute=(t.minute // 5) * 5, second=0, microsecond=0) + dt.timedelta(minutes=5)


def schedule(now: dt.datetime, horizon_h: int = 36):
    """List of he/general engine editions: dict(day, type, at, title_he/en/fr)."""
    today = now.astimezone(TZ).date()
    start = today - dt.timedelta(days=DAYS)
    out = []
    day = start
    while day <= today + dt.timedelta(days=2):
        nxt = day + dt.timedelta(days=1)
        if is_rest(day):
            if not is_rest(nxt):
                lab = rest_label(day)
                at = round5(sunset(day) + dt.timedelta(minutes=HAVDALAH_MIN + 30))
                if lab:
                    titles = (f'מהדורת מוצאי {lab[0]}', f'Motzei {lab[1]} edition', f'Édition de la sortie de {lab[2]}')
                else:
                    titles = (None, None, None)
                out.append(dict(day=day, type='motzash', at=at, titles=titles))
        elif is_rest(nxt):
            lab = rest_label(nxt)
            out.append(dict(day=day, type='morning', at=local(day, 7, 30), titles=(None, None, None)))
            if day.weekday() == 4:
                out.append(dict(day=day, type='noon', at=local(day, 13, 0), titles=(None, None, None)))
                erev_at = local(day, 14, 0)
            else:
                erev_at = local(day, 13, 0)
            if lab:
                titles = (f'מהדורת ערב {lab[0]}', f'Erev {lab[1]} edition', f'Édition de la veille de {lab[2]}')
            else:
                titles = (None, None, None)
            out.append(dict(day=day, type='erev_shabbat', at=erev_at, titles=titles))
        else:
            for typ, hh, mm in (('morning', 7, 30), ('noon', 13, 0), ('evening', 20, 0)):
                out.append(dict(day=day, type=typ, at=local(day, hh, mm), titles=(None, None, None)))
        day = nxt
    first = local(start, 7, 0)
    return [e for e in out if first <= e['at'] <= now + dt.timedelta(hours=horizon_h)]


def render(text: str, params: dict, lang_idx: int) -> str:
    vals = {k: (v[lang_idx] if isinstance(v, tuple) else v) for k, v in params.items()}
    return text.format(**vals)


class Instance:
    def __init__(self, tpl, params, he_only, kind='news', community=None):
        self.tpl, self.params, self.he_only, self.kind, self.community = tpl, params, he_only, kind, community
        self.key = tpl['key']

    @property
    def full(self):
        return not self.he_only and 'en' in self.tpl

    @property
    def youth(self):
        return not self.he_only and 'youth' in self.tpl

    def allowed_on(self, day):
        if self.key in SEASONAL and day < SUKKOT_FROM:
            return False
        only = self.tpl.get('only')
        return only is None  # 'only' items are placed explicitly


def instances(templates, kind='news'):
    out = []
    for t in templates:
        for p in t['params']:
            out.append(Instance(t, p, False, kind))
        for p in C.HE_ONLY_PARAMS.get(t['key'], []):
            out.append(Instance(t, p, True, kind))
    return out


def sql_str(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dt.datetime):
        return "'" + v.astimezone(UTC).isoformat() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--now', help='ISO timestamp (default: current time)')
    ap.add_argument('--audio', action='store_true', help='synthesise + upload audio (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
    ap.add_argument('--out', default=os.path.join(HERE, '002_sample_content.sql'))
    args = ap.parse_args()

    now = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now(TZ)
    now = now.astimezone(TZ)
    today = now.date()
    full_from = today - dt.timedelta(days=FULL_DAYS - 1)
    rng = random.Random(20260925)

    editions = schedule(now)
    news_pool = instances(C.FULL_NEWS) + instances(C.HE_NEWS)
    gn_pool = instances(C.GOOD_NEWS, 'good_news')
    used = set()

    items = []        # dict(ext, inst, published_at, level, topic, kind, community, corrected)
    ed_rows = []      # dict(ext, type, lang, aud, at, title, item_exts[])

    def new_item(inst, at, tag):
        ext = f'sample-item-{tag}'
        level = inst.tpl.get('level', 'general')
        items.append(dict(ext=ext, inst=inst, at=at, level=level, topic=inst.tpl.get('topic'),
                          kind=inst.kind, community=inst.community, corrected=None))
        return items[-1]

    # special edition: a few hours before now, never inside Shabbat hours
    special_at = round5(now - dt.timedelta(hours=3, minutes=5))
    special_day = special_at.date()

    # ---- good news: one per day (two on the full days: morning/noon and evening)
    def pick_gn(day, need_full):
        cands = [g for g in gn_pool if id(g) not in used and g.allowed_on(day) and (g.full or not need_full)]
        if not cands:
            cands = [g for g in gn_pool if g.allowed_on(day) and (g.full or not need_full)]
            print(f'warning: reusing good news on {day}', file=sys.stderr)
        # older days prefer he-only / Hebrew templates, keeping full ones for the recent days
        if not need_full:
            pref = [g for g in cands if not g.full]
            cands = pref or cands
        g = rng.choice(cands)
        used.add(id(g))
        return g

    gn_for = {}  # (day, half) -> item
    for day in sorted({e['day'] for e in editions}):
        full = day >= full_from
        halves = ['am', 'pm'] if full else ['all']
        for h in halves:
            inst = pick_gn(day, full)
            first = min(e['at'] for e in editions if e['day'] == day)
            gn_for[(day, h)] = new_item(inst, first - dt.timedelta(minutes=rng.randint(40, 180)) if h != 'pm'
                                        else local(day, 16, 30), f'{day}-gn-{h}')

    def half_of(e):
        return 'am' if e['type'] in ('morning', 'noon') else 'pm'

    # ---- news per he/general edition
    for e in editions:
        day, full = e['day'], e['day'] >= full_from
        n = 7 if e['type'] in ('erev_shabbat', 'motzash') else (5 if e['type'] == 'noon' else 6)
        chosen = []
        # explicit holiday items
        for inst in news_pool:
            only = inst.tpl.get('only')
            if id(inst) in used or not only:
                continue
            if (only == 'yk_eve' and day == dt.date(2026, 9, 20)) or \
               (only == 'after_yk' and day == dt.date(2026, 9, 21) and e['type'] == 'motzash'):
                chosen.append(inst)
                used.add(id(inst))
        want_critical = rng.random() < (0.45 if e['type'] != 'noon' else 0.3)
        topics = {i.tpl['topic'] for i in chosen}
        youth_needed = 2 if full and e['type'] in ('morning', 'evening', 'erev_shabbat', 'noon') else 0

        def candidates(need_full, level=None, youth=False):
            out = []
            for inst in news_pool:
                if id(inst) in used or not inst.allowed_on(day):
                    continue
                if need_full and not inst.full:
                    continue
                if youth and not inst.youth:
                    continue
                if level and inst.tpl['level'] != level:
                    continue
                if level != 'critical' and not want_critical and inst.tpl['level'] == 'critical':
                    continue
                if inst.key == 'heat' and day == special_day:
                    continue
                out.append(inst)
            return out

        def take(cands):
            fresh = [c for c in cands if c.tpl['topic'] not in topics] or cands
            # older days: prefer Hebrew-only material, keep full templates for the recent days
            if not full:
                pref = [c for c in fresh if c.he_only or 'en' not in c.tpl]
                fresh = pref or fresh
            inst = rng.choice(fresh)
            used.add(id(inst))
            topics.add(inst.tpl['topic'])
            chosen.append(inst)

        if want_critical:
            c = candidates(full, 'critical')
            if c:
                take(c)
        for _ in range(youth_needed):
            c = candidates(True, youth=True)
            if c and len(chosen) < n:
                take(c)
        he_extra = 1 if full else 0
        while len(chosen) < n - he_extra:
            c = candidates(full) or candidates(False)
            if not c:
                print(f'warning: news pool exhausted on {day} {e["type"]}', file=sys.stderr)
                break
            take(c)
        while len(chosen) < n:
            c = candidates(False)
            c = [x for x in c if not x.full] or c
            if not c:
                break
            take(c)

        ext_ids = []
        for k, inst in enumerate(chosen):
            at = e['at'] - dt.timedelta(minutes=rng.randint(15, 170))
            it = new_item(inst, at, f'{day}-{e["type"]}-{k + 1}')
            ext_ids.append(it['ext'])
        # community items (Hebrew only): 0–2, Jerusalem at least once a day
        n_comm = rng.choice([0, 1, 1, 2]) if e['type'] != 'noon' else rng.choice([0, 1])
        if e['type'] == 'morning':
            n_comm = max(n_comm, 1)
        comm_ids = []
        for k in range(n_comm):
            cid = 'jerusalem' if (k == 0 and e['type'] == 'morning') else rng.choice(list(C.COMMUNITY_PLACES))
            tpls = [t for t in C.COMMUNITY if not (t['key'] in SEASONAL and day < SUKKOT_FROM)]
            t = rng.choice(tpls)
            place = rng.choice(C.COMMUNITY_PLACES[cid])
            inst = Instance(dict(t, topic=None, level='general', params=[]), dict(place=place), True, 'community', cid)
            it = new_item(inst, e['at'] - dt.timedelta(minutes=rng.randint(30, 200)), f'{day}-{e["type"]}-c{k + 1}')
            comm_ids.append(it['ext'])
        gn = gn_for[(day, half_of(e) if full else 'all')]
        ed = dict(ext=f'sample-ed-he-general-{day}-{e["type"]}', type=e['type'], lang='he', aud='general',
                  at=e['at'], title=e['titles'][0], item_exts=ext_ids + comm_ids + [gn['ext']], day=day)
        ed_rows.append(ed)

        if full:
            by_ext = {i['ext']: i for i in items}
            full_ids = [x for x in ext_ids if by_ext[x]['inst'].full][:6]
            for li, lang in ((1, 'en'), (2, 'fr')):
                ed_rows.append(dict(ext=f'sample-ed-{lang}-general-{day}-{e["type"]}', type=e['type'], lang=lang,
                                    aud='general', at=e['at'], title=e['titles'][li],
                                    item_exts=full_ids + [gn['ext']], day=day))

    # youth editions: morning + evening (erev on Friday) on the full days
    by_ext = {i['ext']: i for i in items}
    for e in [r for r in ed_rows if r['lang'] == 'he' and r['day'] >= full_from]:
        if e['type'] not in ('morning', 'evening', 'erev_shabbat'):
            continue
        same_day = [r for r in ed_rows if r['lang'] == 'he' and r['day'] == e['day']]
        if e['type'] == 'morning':
            sources = [e]
        else:
            sources = [r for r in same_day if r['type'] in ('noon', 'evening', 'erev_shabbat')]
        ids = []
        for s in sources:
            for x in s['item_exts']:
                it = by_ext[x]
                if it['kind'] == 'news' and it['inst'].youth and x not in ids:
                    ids.append(x)
        gn = [x for x in e['item_exts'] if by_ext[x]['kind'] == 'good_news']
        title = {'erev_shabbat': e['title']}.get(e['type'])
        ed_rows.append(dict(ext=f'sample-ed-he-youth-{e["day"]}-{e["type"]}', type=e['type'], lang='he', aud='youth',
                            at=e['at'], title=title, item_exts=ids[:5] + gn, day=e['day']))

    # special edition
    sp_inst = Instance(C.SPECIAL, C.SPECIAL['params'][0], False)
    sp_item = new_item(sp_inst, special_at - dt.timedelta(minutes=5), f'{special_day}-special-1')
    ed_rows.append(dict(ext=f'sample-ed-he-general-{special_day}-special', type='special', lang='he', aud='general',
                        at=special_at, title='עדכון מיוחד: עומס חום כבד', item_exts=[sp_item['ext']], day=special_day,
                        special=True))

    # one corrected item (shows "עודכן")
    crit = [i for i in items if i['level'] == 'critical' and i['kind'] == 'news' and i['at'] < now - dt.timedelta(hours=30)]
    if crit:
        crit[0]['corrected'] = crit[0]['at'] + dt.timedelta(minutes=70)

    # ---- versions
    versions = []  # (item_ext, lang, aud, style, headline, body)
    for it in items:
        inst, p = it['inst'], it['inst'].params
        tpl = inst.tpl
        for style, (h, b) in tpl['he'].items():
            versions.append((it['ext'], 'he', 'general', style, render(h, p, 0), render(b, p, 0)))
        if inst.full:
            for li, lang in ((1, 'en'), (2, 'fr')):
                for style, (h, b) in tpl[lang].items():
                    versions.append((it['ext'], lang, 'general', style, render(h, p, li), render(b, p, li)))
        if inst.youth:
            for style, (h, b) in tpl['youth'].items():
                versions.append((it['ext'], 'he', 'youth', style, render(h, p, 0), render(b, p, 0)))

    # ---- audio
    audio_rows = []
    if args.audio:
        audio_rows = make_audio(now, ed_rows, items, full_from, special_at, sp_item)

    write_sql(args.out, now, items, versions, ed_rows, audio_rows)
    counts = {
        'editions': len(ed_rows), 'items': len(items), 'versions': len(versions), 'audio': len(audio_rows),
        'he_general': sum(1 for e in ed_rows if e['lang'] == 'he' and e['aud'] == 'general'),
        'future_editions': sum(1 for e in ed_rows if e['at'] > now),
    }
    print(json.dumps(counts), file=sys.stderr)


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

HE_DAYS = ['יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת', 'יום ראשון']


def calm_text(it):
    tpl, p = it['inst'].tpl, it['inst'].params
    h, b = tpl['he'].get('calm') or tpl['he']['informative']
    return render(h, p, 0), render(b, p, 0)


def synth(text: str, path: str) -> str:
    try:
        from gtts import gTTS  # type: ignore
        gTTS(text, lang='iw', slow=False).save(path)
        return 'gtts'
    except Exception as exc:  # noqa: BLE001
        print(f'gTTS failed ({exc}); falling back to espeak-ng', file=sys.stderr)
    with tempfile.NamedTemporaryFile(suffix='.wav') as wav:
        subprocess.run(['espeak-ng', '-v', 'he', '-s', '150', '-w', wav.name, text], check=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav.name, '-codec:a', 'libmp3lame', '-b:a', '64k', path], check=True)
    return 'espeak-ng'


def duration(path: str) -> int:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return int(round(float(out)))


def upload(path: str, name: str) -> str:
    base = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    with open(path, 'rb') as f:
        data = f.read()
    req = urllib.request.Request(f'{base}/storage/v1/object/app-media/{name}', data=data, method='POST', headers={
        'Authorization': f'Bearer {key}', 'apikey': key, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true',
        'Cache-Control': 'max-age=3600'})
    with urllib.request.urlopen(req) as r:
        r.read()
    return f'{base}/storage/v1/object/public/app-media/{name}'


def make_audio(now, ed_rows, items, full_from, special_at, sp_item):
    by_ext = {i['ext']: i for i in items}
    rows = []
    tmp = tempfile.mkdtemp()
    for d in range(FULL_DAYS):
        day = full_from + dt.timedelta(days=d)
        morning = next((e for e in ed_rows if e['day'] == day and e['type'] == 'morning' and e['lang'] == 'he'
                        and e['aud'] == 'general'), None)
        if not morning:
            continue
        at = local(day, 7, 0)
        news = [by_ext[x] for x in morning['item_exts'] if by_ext[x]['kind'] == 'news'][:4]
        gn = [by_ext[x] for x in morning['item_exts'] if by_ext[x]['kind'] == 'good_news']
        parts = [f'שלום, זו המהדורה הקולית של תמצית החדשות, {HE_DAYS[day.weekday()]}, {day.day} ב{day.month}. '
                 'זו מהדורה לדוגמה.']
        for it in news:
            h, b = calm_text(it)
            parts.append(f'{h}. {b}')
        if gn:
            h, b = calm_text(gn[0])
            parts.append(f'ונסיים בטוב. {h}. {b}')
        parts.append('זהו, אתם מעודכנים. יום טוב.')
        name = f'audio/sample-{day}-edition.mp3'
        path = os.path.join(tmp, f'{day}.mp3')
        engine = synth(' '.join(parts), path)
        rows.append(dict(ext=f'sample-audio-{day}-edition', kind='edition', edition_ext=morning['ext'],
                         title=f'המהדורה הקולית · {HE_DAYS[day.weekday()]} {day.day}.{day.month}',
                         url=upload(path, name), dur=duration(path), at=at, engine=engine))
    # flashes: yesterday afternoon, and right after the special update
    flash_specs = []
    y = now.date() - dt.timedelta(days=1)
    ynews = [i for i in items if i['kind'] == 'news' and i['at'].date() == y and i['level'] != 'general'
             and not i['inst'].he_only]
    if ynews:
        flash_specs.append((f'sample-audio-{y}-flash', local(y, 17, 0), ynews[0], 'מבזק אחר הצהריים'))
    flash_specs.append((f'sample-audio-{special_at.date()}-flash', special_at + dt.timedelta(minutes=10), sp_item,
                        'מבזק: עומס חום כבד'))
    for ext, at, it, title in flash_specs:
        if at > now:
            at = now - dt.timedelta(minutes=5)
        h, b = calm_text(it)
        text = f'מבזק של תמצית החדשות. {h}. {b} זה היה מבזק לדוגמה.'
        path = os.path.join(tmp, f'{ext}.mp3')
        engine = synth(text, path)
        rows.append(dict(ext=ext, kind='flash', edition_ext=None, title=title,
                         url=upload(path, f'audio/{ext}.mp3'), dur=duration(path), at=at, engine=engine))
    for r in rows:
        print(f"audio {r['ext']}: {r['dur']}s via {r['engine']}", file=sys.stderr)
    return rows


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def write_sql(path, now, items, versions, ed_rows, audio_rows):
    L = []
    L.append('-- SAMPLE CONTENT for the Tamzit app (generated by supabase/seed/generate_sample_content.py).')
    L.append(f'-- Generated for now = {now.isoformat()} (Asia/Jerusalem). Re-run the generator to refresh the dates.')
    L.append("-- Every row uses external_id 'sample-…'; previous sample rows are deleted first.")
    L.append('begin;')
    L.append("delete from public.app_audio where external_id like 'sample-%';")
    L.append("delete from public.app_ads where external_id like 'sample-%';")
    L.append("delete from public.app_editions where external_id like 'sample-%';")
    L.append("delete from public.app_items where external_id like 'sample-%';")
    L.append('')
    L.append('insert into public.app_items (id, external_id, topic_id, level, kind, community_id, published_at, status, corrected_at) values')
    rows = []
    for it in items:
        rows.append('  (' + ', '.join([sql_str(uid(it['ext'])), sql_str(it['ext']), sql_str(it['topic']), sql_str(it['level']),
                                       sql_str(it['kind']), sql_str(it['community']), sql_str(it['at']), "'published'",
                                       sql_str(it['corrected'])]) + ')')
    L.append(',\n'.join(rows) + ';')
    L.append('')
    L.append('insert into public.app_item_versions (item_id, language, audience, style, headline, body) values')
    rows = ['  (' + ', '.join([sql_str(uid(v[0])), sql_str(v[1]), sql_str(v[2]), sql_str(v[3]), sql_str(v[4]), sql_str(v[5])]) + ')'
            for v in versions]
    L.append(',\n'.join(rows) + ';')
    L.append('')
    L.append('insert into public.app_editions (id, external_id, edition_type, language, audience, published_at, title, status, pushed_at) values')
    rows = []
    for e in ed_rows:
        pushed = e['at'] if e.get('special') else None  # sample special: never pushed
        rows.append('  (' + ', '.join([sql_str(uid(e['ext'])), sql_str(e['ext']), sql_str(e['type']), sql_str(e['lang']),
                                       sql_str(e['aud']), sql_str(e['at']), sql_str(e['title']), "'published'",
                                       sql_str(pushed)]) + ')')
    L.append(',\n'.join(rows) + ';')
    L.append('')
    L.append('insert into public.app_edition_items (edition_id, item_id, position) values')
    rows = []
    for e in ed_rows:
        for pos, x in enumerate(e['item_exts'], start=1):
            rows.append(f"  ({sql_str(uid(e['ext']))}, {sql_str(uid(x))}, {pos})")
    L.append(',\n'.join(rows) + ';')
    L.append('')
    if audio_rows:
        L.append('insert into public.app_audio (id, external_id, kind, edition_id, language, audience, title, audio_url, duration_sec, published_at, status) values')
        rows = []
        for a in audio_rows:
            rows.append('  (' + ', '.join([sql_str(uid(a['ext'])), sql_str(a['ext']), sql_str(a['kind']),
                                           sql_str(uid(a['edition_ext'])) if a['edition_ext'] else 'null', "'he'", "'general'",
                                           sql_str(a['title']), sql_str(a['url']), str(a['dur']), sql_str(a['at']), "'published'"]) + ')')
        L.append(',\n'.join(rows) + ';')
        L.append('')
    L.append('insert into public.app_ads (id, external_id, sponsor, body, link_url, language, audience, starts_at, ends_at, weight, active) values')
    rows = []
    for a in C.ADS:
        ext = f"sample-{a['key']}"
        rows.append('  (' + ', '.join([sql_str(uid(ext)), sql_str(ext), sql_str(a['sponsor']), sql_str(a['body']), sql_str(a['link_url']),
                                       sql_str(a['language']), "'general'", sql_str(now - dt.timedelta(days=30)),
                                       sql_str(now + dt.timedelta(days=90)), str(a['weight']), 'true']) + ')')
    L.append(',\n'.join(rows) + ';')
    L.append('commit;')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
