"""
Geocode the distinct city values in the companies table so the map can plot them.

    python scripts/geocode_cities.py cities.txt out.json

Feed it one place name per line (select distinct city from companies), then load
the JSON into the geocache table and copy the coordinates onto companies.

IMPORTANT: this uses a STRUCTURED city= query, not free text. Georgia has many
counties sharing a name with an unrelated town, and a free-text lookup returns
the county: "Decatur" resolves ~320km away in Decatur County rather than
Decatur in DeKalb. Nineteen towns were wrong that way on the first attempt, and
every one still returned a confident result — a 100% hit rate hid an 8% error
rate. Always sanity-check against Georgia's bounding box afterwards.

Nominatim allows one request per second; the sleep below is not optional.
"""

import json, os, re, sys, time, urllib.parse, urllib.request

CITIES = sys.argv[1]; OUT = sys.argv[2]
SKIP = {'nan', 'multiple ga', ''}
FIX  = {'Mt Airy': 'Mount Airy', 'St Marys': 'Saint Marys'}

def normalise(c):
    c = c.strip()
    if c.lower() in SKIP: return None
    c = re.sub(r'\s*\(.*?\)\s*', '', c).split('/')[0].strip()
    return FIX.get(c, c) or None

def query(params):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {**params, 'format': 'jsonv2', 'limit': 1, 'countrycodes': 'us', 'state': 'Georgia'})
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
            d = query({'city': name}) or query({'q': f'{name}, Georgia, USA'})
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
