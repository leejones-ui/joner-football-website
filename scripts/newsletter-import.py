#!/usr/bin/env python3
"""Copy one of Lee's sent Brevo newsletters into src/data/letters.ts, so it gets its
own page at /newsletter/<slug>/ and shows on /newsletter/ and in the Hub.

  BREVO_API_KEY=... python3 scripts/newsletter-import.py <campaignId>            # dry run
  BREVO_API_KEY=... python3 scripts/newsletter-import.py <campaignId> --apply

Options: --slug, --teaser (default: the campaign preview text), --card (default: the first
photo), --card-alt. Words are copied as sent. The greeting, unsubscribe link and Brevo
tracking links are dropped; buttons point at the same pages with website UTMs.
"""
import argparse, json, os, re, sys, urllib.request
from datetime import datetime
from html.parser import HTMLParser

DATA = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'letters.ts')
SITE = 'https://jonerfootball.com'
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
          'September', 'October', 'November', 'December']


class Blocks(HTMLParser):
    """Flattens the letter email into an ordered list of text, image and link blocks."""

    def __init__(self):
        super().__init__()
        self.blocks, self.cur, self.buf, self.href, self.hidden = [], None, '', None, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        style = a.get('style') or ''
        if tag == 'div' and 'display:none' in style:
            self.hidden = True
            return
        if tag in ('h1', 'h2', 'p'):
            self.cur, self.buf = (tag, style), ''
        elif tag == 'div' and self.cur is None:
            self.cur, self.buf = ('div', style), ''
        elif tag == 'a':
            self.href = a.get('href')
            if self.cur is None:
                self.cur, self.buf = ('a', style), ''
        elif tag == 'img':
            self.blocks.append({'t': 'img', 'src': a.get('src'), 'alt': a.get('alt') or '', 'href': self.href})
        elif self.cur and tag in ('em', 'strong'):
            self.buf += f'<{tag}>'
        elif self.cur and tag == 'br':
            self.buf += '<br>'
        elif self.cur and tag == 'span' and 'Courier' in style:
            self.buf += '<span>'

    def handle_endtag(self, tag):
        if self.hidden:
            if tag == 'div':
                self.hidden = False
            return
        if self.cur and tag in ('em', 'strong'):
            self.buf += f'</{tag}>'
        if self.cur and tag == 'span' and self.buf.count('<span>') > self.buf.count('</span>'):
            self.buf += '</span>'
        if self.cur and (tag == self.cur[0] or (self.cur[0] == 'a' and tag == 'a')):
            text = re.sub(r'\s+', ' ', self.buf).strip()
            if text:
                self.blocks.append({'t': self.cur[0], 'text': text, 'style': self.cur[1],
                                    'href': self.href if self.cur[0] == 'a' else None})
            self.cur, self.buf = None, ''
        if tag == 'a':
            self.href = None

    def handle_data(self, data):
        if self.cur and not self.hidden:
            self.buf += data


def brevo(path):
    req = urllib.request.Request('https://api.brevo.com/v3' + path,
                                 headers={'api-key': os.environ['BREVO_API_KEY'], 'accept': 'application/json'})
    return json.load(urllib.request.urlopen(req))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def web_link(href, slug):
    """A Brevo tracking link becomes its real destination with website UTMs."""
    utm = f'utm_source=website&utm_medium=newsletter&utm_campaign={slug}'
    dest = href
    if '/go/brevo' in href:
        try:
            urllib.request.build_opener(NoRedirect).open(href)
        except urllib.error.HTTPError as e:
            dest = e.headers.get('Location') or href
    dest = re.sub(r'\?.*$', '', dest)
    dest = dest.replace(SITE, '') or '/'
    return f'{dest}?{utm}'


def slugify(title):
    return re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:70].rstrip('-')


def convert(campaign, args):
    p = Blocks()
    p.feed(campaign['htmlContent'])
    sent = datetime.fromisoformat(campaign['sentDate'])
    title = next((b['text'] for b in p.blocks if b['t'] == 'h1'), campaign['subject'])
    slug = args.slug or slugify(title)
    letter = {'slug': slug, 'title': title, 'date': sent.date().isoformat(),
              'dateLabel': f'{sent.day} {MONTHS[sent.month - 1]} {sent.year}',
              'teaser': args.teaser or campaign.get('previewText') or '', 'card': args.card, 'cardAlt': args.card_alt,
              'hero': None, 'body': [], 'brevoCampaignId': campaign['id']}
    blocks, seen_title, i = p.blocks, False, 0
    while i < len(blocks):
        b, t = blocks[i], blocks[i]['t']
        text = b.get('text', '')
        if t == 'h1':
            seen_title = True
        elif t == 'img':
            fig = {'type': 'figure', 'src': b['src'].replace(SITE, ''), 'alt': b['alt']}
            if b.get('href') and b['href'].startswith('http') and '/go/brevo' not in b['href']:
                fig['video'] = b['href']
            nxt = blocks[i + 1] if i + 1 < len(blocks) else None
            if nxt and nxt['t'] == 'div' and 'Courier' in nxt['style'] and 'LETTER FROM' not in nxt['text']:
                i += 1
                if nxt['text'] != 'Tap to watch':
                    fig['caption'] = nxt['text']
            if not seen_title and not letter['hero']:
                letter['hero'] = fig
            else:
                letter['body'].append(fig)
        elif t == 'h2':
            letter['body'].append({'type': 'h2', 'text': text})
        elif t == 'a' and b['href'] and 'unsubscribe' not in b['href'] and 'unsubscribe' not in text.lower():
            letter['body'].append({'type': 'cta', 'label': text.replace(' →', '').strip(), 'href': web_link(b['href'], slug)})
        elif t == 'p':
            if text.startswith('Hi {{') or 'unsubscribe' in text.lower():
                pass
            elif text == 'Lee':
                letter['body'].append({'type': 'sign', 'text': 'Lee'})
            elif re.match(r'^(<span>)?PS\.', text):
                letter['body'].append({'type': 'ps', 'html': re.sub(r'^(<span>)?PS\.(</span>)?\s*', '', text)})
            else:
                letter['body'].append({'type': 'p', 'html': text})
        i += 1
    figs = [x for x in [letter['hero']] + letter['body'] if x and x.get('type') == 'figure']
    if not letter['card'] and figs:
        letter['card'], letter['cardAlt'] = figs[0]['src'], letter['cardAlt'] or figs[0]['alt']
    letter['cardAlt'] = letter['cardAlt'] or title
    return letter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('campaign', type=int)
    ap.add_argument('--slug'); ap.add_argument('--teaser'); ap.add_argument('--card'); ap.add_argument('--card-alt', default='')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    campaign = brevo(f'/emailCampaigns/{args.campaign}')
    if campaign.get('status') != 'sent':
        sys.exit(f"Campaign {args.campaign} is {campaign.get('status')}, not sent. Only sent letters go on the site.")
    letter = convert(campaign, args)

    src = open(DATA).read()
    marker = 'export const letters: Letter[] = '
    head, body = src.split(marker)
    letters = json.loads(body)
    if any(l['slug'] == letter['slug'] or l.get('brevoCampaignId') == letter['brevoCampaignId'] for l in letters):
        sys.exit(f"Already on the site: {letter['slug']}")
    letters = sorted(letters + [letter], key=lambda l: l['date'], reverse=True)

    dashes = re.findall('[–—]', json.dumps(letter, ensure_ascii=False))
    print(f"{letter['dateLabel']}  {letter['title']}  ->  /newsletter/{letter['slug']}/")
    print(f"  teaser: {letter['teaser']}\n  card:   {letter['card']}\n  blocks: {len(letter['body'])}"
          + (f"\n  WARNING: {len(dashes)} long dashes in the text (site rule: none)" if dashes else ''))
    if not args.apply:
        print('Dry run. Add --apply to write src/data/letters.ts.')
        return
    open(DATA, 'w').write(head + marker + json.dumps(letters, ensure_ascii=False, indent=2) + '\n')
    print('Written. Build, check the page, then commit src/data/letters.ts.')


if __name__ == '__main__':
    main()
