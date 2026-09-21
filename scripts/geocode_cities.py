"""
Geocode the distinct city values on company locations so the map can plot them.

    python scripts/geocode_cities.py cities.txt out.json

Feed it one place name per line (select distinct city from company_locations),
then load the JSON into the geocache table and copy the coordinates onto
company_locations. Cities live on locations, not companies, since
supabase/migrations/015_company_locations.sql.

IMPORTANT: this uses a STRUCTURED city= query, not free text. Place names often
collide with county names, and a free-text lookup happily returns the county
instead — one run put a town several hundred kilometres from where it belongs.
Every wrong answer still came back as a confident answer, so a 100% hit rate hid
an 8% error rate. Always sanity-check results against a bounding box afterwards.

Nominatim allows one request per second; the sleep below is not optional.
"""

import json, os, re, sys, time, urllib.parse, urllib.request

CITIES = sys.argv[1]; OUT = sys.argv[2]
# The state/region your companies are in — biases lookups and keeps a town called
# "Springfield" in the right place. Set it before running:
#   EZCRM_STATE="Your State" python scripts/geocode_cities.py cities.txt out.json
STATE = os.environ.get('EZCRM_STATE')
if not STATE:
    raise SystemExit('Set EZCRM_STATE to the state or region to geocode within.')

SKIP = {'nan', 'multiple ga', ''}
FIX  = {'Mt Airy': 'Mount Airy', 'St Marys': 'Saint Marys'}

def normalise(c):
    c = c.strip()
    if c.lower() in SKIP: return None
    c = re.sub(r'\s*\(.*?\)\s*', '', c).split('/')[0].strip()
    return FIX.get(c, c) or None

def query(params):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {**params, 'format': 'jsonv2', 'limit': 1, 'countrycodes': 'us', 'state': STATE})
    req = urllib.request.Request(url, headers={
        'User-Agent': 'EZcrm-club-outreach/1.0 (one-off geocode)', 'Accept-Language': 'en'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

out, misses = {}, []
raw = [l.strip() for l in open(CITIES, encoding='utf-8') if l.strip()]

for i, original in enumerate(raw, 1):
    name = normalise(original)
    if not name:
        misses.append(original); continue
    try:
        # "X County" must be looked up as a county; everything else as a CITY,
        # which stops Nominatim returning the same-named county instead.
        if name.lower().endswith('county'):
            d = query({'county': name})
        else:
            d = query({'city': name}) or query({'q': f'{name}, {STATE}, USA'})
        if d:
            out[original] = {'lat': float(d[0]['lat']), 'lon': float(d[0]['lon']),
                             'type': d[0].get('type'), 'cls': d[0].get('class'),
                             'label': d[0].get('display_name','')[:70]}
        else:
            misses.append(original)
    except Exception as e:
        misses.append(original); print(f'  ! {original}: {e}', flush=True)
    if i % 40 == 0: print(f'  {i}/{len(raw)}', flush=True)
    time.sleep(1.1)

json.dump({'results': out, 'misses': misses}, open(OUT,'w'), indent=1)
print(f'DONE hits={len(out)} misses={len(misses)}')
