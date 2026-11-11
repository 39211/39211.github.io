"""Align existing, non-post AI lastmod values with final authored page metadata.

Run after the overlay, merge and v4 shell. Never add URLs/dates, edit HTML,
change generated post dates, or infer a date from a build clock/mtime.
"""
import argparse
from datetime import date, datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

BASE = 'https://sixiangjialaundry.com/'
NS = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
BLOCK = re.compile(rb'<url>.*?</url>', re.S)
MOD = re.compile(rb'<lastmod>([^<]*)</lastmod>')
# Reviewed scope: do not widen without a separate review.
REVIEWED = {BASE+'guides/'+slug+'.html' for slug in (
    'white-shoe-yellowing', 'luxury-bag-mold', 'down-jacket-cleaning')}
TYPES = {'WebPage', 'CollectionPage', 'AboutPage', 'ContactPage', 'Article', 'BlogPosting', 'NewsArticle'}


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?', value):
        raise ValueError(f'Invalid date: {value!r}')
    date.fromisoformat(value[:10])
    if len(value) > 10:
        datetime.fromisoformat(value)
    return value[:10]


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}')
        result[key] = value
    return result


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals, self.scripts, self.robots = [], [], []
        self.script = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'link' and 'canonical' in a.get('rel', '').lower().split():
            self.canonicals.append(a.get('href'))
        if tag == 'meta' and a.get('name', '').lower() in ('robots', 'googlebot'):
            self.robots.append(a.get('content', '').lower())
        if tag == 'script' and a.get('type', '').lower() == 'application/ld+json':
            self.script = ''

    def handle_data(self, data):
        if self.script is not None:
            self.script += data

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.scripts.append(self.script)
            self.script = None


def nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from nodes(child)


def content_date(html, url):
    meta = Metadata()
    meta.feed(html)
    if meta.canonicals != [url]:
        raise ValueError(f'Missing, conflicting or duplicate canonical: {url}')
    if any('noindex' in re.split(r'[\s,]+', text) for text in meta.robots):
        return None
    if meta.script is not None:
        raise ValueError(f'Unclosed JSON-LD: {url}')
    candidates = []
    for raw in meta.scripts:
        for node in nodes(json.loads(raw, object_pairs_hook=unique_pairs)):
            types = node.get('@type', [])
            types = types if isinstance(types, list) else [types]
            if not any(t in TYPES for t in types) or 'dateModified' not in node:
                continue
            own_url = node.get('url')
            own_id = node.get('@id')
            matches = own_url == url or (own_url is None and own_id in (url+'#webpage', url+'#article'))
            if matches:
                if own_id and own_id.split('#')[0] != url:
                    raise ValueError(f'Conflicting page identity: {url}')
                candidates.append(node['dateModified'])
    if not candidates:
        return None
    # Even same-day distinct timestamps are ambiguous; do not pick the latest.
    for value in candidates:
        day(value)
    if len(set(candidates)) != 1:
        raise ValueError(f'Conflicting dateModified values: {url}')
    return day(candidates[0])


def synchronized(site_root, raw):
    root = Path(site_root).resolve()
    xml = ET.fromstring(raw)
    blocks = list(BLOCK.finditer(raw))
    entries = list(xml)
    if xml.tag != NS+'urlset' or len(entries) != len(blocks):
        raise ValueError('Unsupported AI sitemap format')
    seen, patches, report = set(), [], []
    main = ET.parse(root / 'sitemap.xml').getroot()
    if main.tag != NS+'urlset':
        raise ValueError('Unsupported main sitemap namespace')
    for entry, block in zip(entries, blocks):
        locs, mods = entry.findall(NS+'loc'), entry.findall(NS+'lastmod')
        if entry.tag != NS+'url' or len(locs) != 1 or len(mods) > 1:
            raise ValueError('Ambiguous AI sitemap entry')
        url = locs[0].text or ''
        if url in seen:
            raise ValueError(f'Duplicate AI URL: {url}')
        seen.add(url)
        # Unreviewed entries are opaque: never inspect their files or metadata.
        if url not in REVIEWED:
            continue
        parsed = urlsplit(url)
        if not url.startswith(BASE) or parsed.query or parsed.fragment or '%' in parsed.path or '\\' in parsed.path:
            raise ValueError(f'Unsupported AI URL: {url}')
        relative = url[len(BASE):]
        if any(part in ('.', '..') for part in relative.split('/')):
            raise ValueError(f'Unsafe AI URL: {url}')
        if not relative or relative.endswith('/'):
            relative += 'index.html'
        if not relative.endswith('.html'):
            continue
        target = root / relative
        components = [target, *target.parents]
        if any(part.is_symlink() for part in components if part != root and root in part.parents):
            raise ValueError(f'Symlink target is not permitted: {url}')
        if not target.resolve().is_relative_to(root) or not target.is_file():
            raise ValueError(f'Missing or unsafe target: {url}')
        actual = content_date(target.read_text(encoding='utf-8'), url)
        old = mods[0].text if mods else None
        if old is not None:
            day(old)
        status = ('eligible' if url in REVIEWED else
                  'generated-post-preserved' if relative.startswith('posts/') else 'outside-reviewed-scope')
        if status == 'eligible':
            matches = [e for e in main if [c.text for c in e.findall(NS+'loc')] == [url]]
            if len(matches) != 1 or len(matches[0].findall(NS+'lastmod')) != 1:
                raise ValueError(f'Missing or ambiguous main sitemap date: {url}')
            primary = matches[0].find(NS+'lastmod').text
            if actual is None or old is None or day(primary) != actual:
                raise ValueError(f'Unverified final page / main sitemap date: {url}')
            if actual < day(old):
                raise ValueError(f'Refusing AI date regression: {url}')
        report.append({'url': url, 'before': old, 'content_date': actual, 'status': status})
        if status != 'eligible' or old is None or actual is None or day(old) == actual:
            continue
        spans = list(MOD.finditer(block[0]))
        if len(spans) != 1:
            raise ValueError(f'Unsupported lastmod formatting: {url}')
        span = spans[0]
        patches.append((block.start()+span.start(1), block.start()+span.end(1), actual.encode()))
    if not REVIEWED.issubset(seen):
        raise ValueError('Reviewed URL missing from AI sitemap')
    result = raw
    for start, end, value in reversed(patches):
        result = result[:start]+value+result[end:]
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-root', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    path = args.site_root / 'ai-sitemap.xml'
    raw = path.read_bytes()
    result, report = synchronized(args.site_root, raw)
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    if args.check and result != raw:
        raise SystemExit('AI sitemap content dates are stale')
    if not args.check and result != raw:
        path.write_bytes(result)
    changed = sum(r['status']=='eligible' and r['before'] is not None and r['content_date'] is not None and day(r['before'])!=r['content_date'] for r in report)
    print(f'AI content dates: {len(report)} reviewed HTML URLs verified; {changed} changes; URL membership preserved')


if __name__ == '__main__':
    main()
