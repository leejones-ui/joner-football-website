# Builds api/_jfp-ideas-library.js from Lee's training ideas Google sheet.
# The sheet is private, so read it signed in (the fleet browser): save each tab
# as CSV with gviz (tqx=out:csv&headers=0&sheet=<tab name>) into one folder as
# drills.csv ("Links to drills"), more.csv ("More links / old programs") and
# plan.csv, then: python3 scripts/build-jfp-ideas.py <folder> ideas.json
# and wrap ideas.json as the default export of api/_jfp-ideas-library.js.
import csv, json, re, sys, urllib.request, urllib.parse, os
D = sys.argv[1]; OUT = sys.argv[2]
URL = re.compile(r'https?://[^\s|,]+')
BAD = re.compile(r'\bc\x75nt\b', re.I)  # one rude word in the sheet's notes
def tidy(u):
    u = u.rstrip('.)')
    p = urllib.parse.urlsplit(u)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if k in ('v', 't', 'list', 'index')]
    host = p.netloc.lower().replace('www.', '')
    if 'instagram.com' in host or 'twitter.com' in host or 'x.com' in host: q = []
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ''))
def platform(u):
    h = urllib.parse.urlsplit(u).netloc.lower()
    if 'youtu' in h: return 'YouTube'
    if 'instagram' in h: return 'Instagram'
    if 'twitter' in h or 'x.com' in h: return 'X'
    return h.replace('www.', '')
def ytid(u):
    p = urllib.parse.urlsplit(u)
    if 'youtu.be' in p.netloc: return p.path.strip('/')
    if '/shorts/' in p.path: return p.path.split('/shorts/')[1].split('/')[0]
    return dict(urllib.parse.parse_qsl(p.query)).get('v')
cache = {}
def ytmeta(u):
    vid = ytid(u)
    if not vid: return {}
    if vid in cache: return cache[vid]
    try:
        r = urllib.request.urlopen('https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote('https://www.youtube.com/watch?v=' + vid), timeout=10)
        j = json.load(r); m = {'title': j.get('title', '')[:160], 'by': j.get('author_name', '')[:80], 'thumb': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg'}
    except Exception:
        m = {'thumb': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg', 'gone': True}
    cache[vid] = m; return m
def handle(u):
    p = urllib.parse.urlsplit(u)
    if platform(u) == 'X': return '@' + p.path.strip('/').split('/')[0]
    return ''
def link(u, label=''):
    u = tidy(u); x = {'url': u, 'platform': platform(u)}
    if x['platform'] == 'YouTube': x.update(ytmeta(u))
    h = handle(u)
    if h: x['by'] = h
    if label: x['label'] = label
    if '/reel/' in u or '/shorts/' in u: x['short'] = True
    return x
# 1. Library: columns are topics.
rows = list(csv.reader(open(os.path.join(D, 'drills.csv'))))[1:]
heads = [h.strip() for h in rows[1]]
lib = []
for j, h in enumerate(heads):
    if not h: continue
    seen = set(); links = []
    for r in rows[2:]:
        if j < len(r):
            for u in URL.findall(r[j]):
                t = tidy(u)
                if t in seen: continue
                seen.add(t); links.append(link(u))
    name = {'Speedo/Reaction Links': 'Speed and reactions', '1v1,s 2v2s': '1v1s and 2v2s', 'Passing & 1st touch': 'Passing and first touch', 'Passing & 1st touch with Pressure': 'Passing and first touch under pressure'}.get(h, h)
    lib.append({'topic': name.replace('&', 'and'), 'links': links})
# 2. Programs: week by week.
def items(cell):
    out = []
    for line in cell.split('\n'):
        line = BAD.sub('', line).strip()
        if not line: continue
        urls = URL.findall(line)
        if not urls: out.append({'note': line[:220]}); continue
        parts = re.split(r'\s*\|\|\s*', line)
        for part in parts:
            for seg in re.split(r'(?<=\S)\s+(?=[A-Z][A-Za-z ]+ - https?://)', part):
                us = URL.findall(seg)
                lab = URL.sub('', seg).strip(' -:|.=').strip()
                lab = re.sub(r'\s{2,}', ' ', lab)[:120]
                for u in us: out.append({**link(u), 'label': lab or 'Video'})
                if not us and lab: out.append({'note': lab[:220]})
    return out
more = list(csv.reader(open(os.path.join(D, 'more.csv'))))[1:]
def program(name, start, end, col):
    sess = []
    for i in range(start, end):
        r = more[i] + [''] * 4
        if re.match(r'^Session \d+', r[0].strip()):
            its = items(r[col])
            # The next row or two may carry more lines for the same session.
            k = i + 1
            while k < end and not re.match(r'^(Week|Session) ', (more[k] + [''])[0].strip()):
                its += items((more[k] + [''] * 4)[col]); k += 1
            topic = BAD.sub('', r[1]).replace('\n', ' ').strip()
            if its or topic: sess.append({'name': r[0].strip(), 'topic': re.sub(r'\s+', ' ', topic), 'items': its})
    return {'name': name, 'sessions': [s for s in sess if s['items']]}
progs = [program('JFP 1', 2, 19, 2), program('JFP 2', 2, 19, 3), program('JFP Tree', 20, 43, 2)]
guide = {
  'topics': ['Dribbling', 'Passing and first touch', '1v1s (attacking)', 'Dribbling', 'Passing and first touch', '1v1s (defending)', 'Heading', 'Ball striking', 'Awareness, combination play, timing of movement', 'Passing and first touch with pressure and competitions'],
  'steps': [
    {'t': 'Assess first', 'd': "Check the players' ability and your numbers before you plan."},
    {'t': 'Warm up, always with a ball', 'd': 'Speed and agility, ball mastery or dribbling. Simple, quick and high intensity, and easy to progress.'},
    {'t': 'Main topic: simple', 'd': 'Start the topic at a level every player can do well.'},
    {'t': 'Progress the topic', 'd': 'Medium to harder. It needs to challenge the players. Sessions 7 to 10 of a block should add pressure.'},
    {'t': 'Finish', 'd': 'Shooting, ball striking, or possession with a bigger group. Plan to the level of your players.'},
    {'t': 'Reflect', 'd': 'Chat with the players and give feedback, always ending on a positive. Then reflect as a coach: what went well?'},
  ],
}
json.dump({'from': 'Lee\'s training ideas spreadsheet', 'library': lib, 'programs': progs, 'guide': guide}, open(OUT, 'w'), indent=1)
print('topics', [(t['topic'], len(t['links'])) for t in lib]); print('programs', [(p['name'], len(p['sessions'])) for p in progs]); print('yt', len(cache), 'gone', sum(1 for v in cache.values() if v.get('gone')))
