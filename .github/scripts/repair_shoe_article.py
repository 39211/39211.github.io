"""Repair one reviewed public article, tolerating only validated daily navigation.

The entire page except a strictly parsed related-list and BlogPosting wordCount
is fingerprinted against reviewed producer/Pages versions, before AND after
repair. No network, private input, whole-site generation or ownership changes.
"""
import argparse
from datetime import date, datetime
import hashlib
from html import unescape
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

TARGET = 'posts/2026-11-11-slot-02.html'
MANIFEST = Path(__file__).with_name('shoe_article_repair.json')
RELATED_ID = 'related-https://sixiangjialaundry.com/content-calendar/2026-11-11.json#post-2026-11-11-slot-02'
RELATED = re.compile(r'<section class="article-related" aria-labelledby="' + re.escape(RELATED_ID) + r'">.*?</section>', re.S)
MARKER = '<!-- reviewed-related -->'
ITEM = re.compile(r'<li class="article-related__item">(?P<label>上一則｜|下一則｜)?<a class="article-related__link" href="(?P<url>https://sixiangjialaundry\.com/[^"<>\s]+)">(?P<title>[^<>]+)</a>(?:（(?P<date>\d{4}-\d{2}-\d{2})）)?</li>')
POST = re.compile(r'https://sixiangjialaundry\.com/posts/(?P<date>\d{4}-\d{2}-\d{2})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.html')
COUNT = re.compile(r'("articleSection":"(?:寢具與布品|鞋面與鞋內檢查)"),"wordCount":([1-9][0-9]{0,5})(?=})')

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def plain_title(value):
    # Exactly the generator's escaped text, never nested HTML or control chars.
    if not 1 <= len(value) <= 1000 or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid related title')
    if re.search(r'&(?!(?:amp|lt|gt|quot);)', value):
        raise ValueError('Unexpected title entity')
    if '<' in unescape(value) or '>' in unescape(value) or '"' in value:
        raise ValueError('Markup-like related title')

def related_navigation(section, data):
    prefix = data['related_prefix']
    suffix = '            </ul>\n          </section>'
    if not section.startswith(prefix) or not section.endswith(suffix):
        raise ValueError('Unknown related section structure')
    body = section[len(prefix):-len(suffix)]
    items = []
    for match in ITEM.finditer(body):
        if body[:match.start()].strip() and not items:
            raise ValueError('Unexpected related HTML')
        if items and body[items[-1].end():match.start()].strip():
            raise ValueError('Unexpected related HTML')
        items.append(match)
    if not items or body[items[-1].end():].strip():
        raise ValueError('Unexpected related HTML')
    nav = {'上一則｜': '', '下一則｜': ''}
    guides = []
    tail = []
    related_urls = set()
    phase = 0
    for match in items:
        label, url, title, published = (match[k] for k in ('label', 'url', 'title', 'date'))
        plain_title(title)
        post = POST.fullmatch(url)
        if label:
            if phase or nav[label] or (label == '上一則｜' and nav['下一則｜']) or not post or published:
                raise ValueError('Invalid chronological link')
            day = date.fromisoformat(post['date'])
            slot = post['slug']
            if slot not in ('slot-01','slot-02'):
                raise ValueError('Chronological link is not a daily article')
            key = (day, slot)
            target = (date(2026,11,11), 'slot-02')
            if (label == '上一則｜' and not key < target) or (label == '下一則｜' and not key > target):
                raise ValueError('Chronological link on wrong side of target')
            expected = 'Day 257：' if label == '上一則｜' else 'Day 259：'
            if not title.startswith(expected) or len(title) == len(expected):
                raise ValueError('Unexpected chronological article number')
            nav[label] = match[0]
        elif post:
            if phase > 1 or not published or published != post['date'] or url.endswith('/'+TARGET.split('/')[-1]) or url in related_urls:
                raise ValueError('Invalid related article')
            date.fromisoformat(published)
            phase = 1; related_urls.add(url)
            if len(related_urls) > 3:
                raise ValueError('Too many related articles')
        elif '/guides/' in url:
            if phase > 2 or published:
                raise ValueError('Invalid related guide')
            phase = 2; guides.append(match[0])
        else:
            if published:
                raise ValueError('Invalid related footer')
            phase = 3; tail.append(match[0])
    if guides not in data['related_guide_sets'] or tail != data['related_tail']:
        raise ValueError('Unknown guides or related footer links')
    return nav

def normalize(text, data):
    sections = list(RELATED.finditer(text))
    if len(sections) != 1 or text.count('class="article-related"') != 1:
        raise ValueError('Missing or ambiguous related section')
    section = sections[0]
    nav = related_navigation(section[0], data)
    result = text[:section.start()] + MARKER + text[section.end():]
    # A malformed/extra wordCount or any other JSON/schema change remains in the
    # fingerprint, so only this exact numeric field can vary or be absent.
    result = COUNT.sub(r'\1', result)
    return result, nav

def repaired_bytes(raw):
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    if data['path'] != TARGET:
        raise ValueError('Unexpected repair target')
    normalized, nav = normalize(raw.decode('utf-8'), data)
    sha = digest(normalized.encode('utf-8'))
    fixed = next((v for v in data['variants'] if sha == v['normalized_after_sha256']), None)
    variant = fixed or next((v for v in data['variants'] if sha == v['normalized_before_sha256']), None)
    if variant is None:
        raise ValueError(f'Unknown source for {TARGET}: {sha}; review required')
    if not fixed:
        for change in data['changes']:
            if not change['before'] or normalized.count(change['before']) != 1:
                raise ValueError('Repair fragment is missing or ambiguous')
            normalized = normalized.replace(change['before'], change['after'], 1)
    if digest(normalized.encode('utf-8')) != variant['normalized_after_sha256']:
        raise ValueError('Repaired article fingerprint mismatch')
    related = (data['related_prefix'] + '              ' + nav['上一則｜'] + '\n              ' + nav['下一則｜'] + '\n' + data['related_suffix'])
    result = normalized.replace(MARKER, related, 1)
    # Validate output structure and every protected byte before touching disk.
    output, _ = normalize(result, data)
    if output != normalized:
        raise ValueError('Repaired article validation mismatch')
    return result.encode('utf-8')

def taipei_today():
    return datetime.now(ZoneInfo('Asia/Taipei')).date()

def validate_navigation_targets(root, raw):
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    _, navigation = normalize(raw.decode('utf-8'), data)
    today = taipei_today()
    for item in navigation.values():
        if not item:
            continue
        url = ITEM.fullmatch(item)['url']
        post = POST.fullmatch(url)
        relative = url.removeprefix('https://sixiangjialaundry.com/')
        target = root / relative
        if (target.is_symlink() or target.parent.is_symlink()
                or target.resolve().parent != root / 'posts' or not target.is_file()):
            raise ValueError('Missing or unsafe chronological target: ' + relative)
        if date.fromisoformat(post['date']) > today:
            raise ValueError('Future chronological target: ' + relative)


def repair(site_root):
    root = Path(site_root).resolve()
    target = root / TARGET
    if target.is_symlink() or target.parent.is_symlink() or target.resolve().parent != root / 'posts':
        raise ValueError('Unsafe repair target')
    before = target.read_bytes()
    after = repaired_bytes(before)
    validate_navigation_targets(root, after)
    if after != before:
        target.write_bytes(after)
    return digest(after)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-root', type=Path, required=True)
    args = parser.parse_args()
    print(f'{TARGET}: {repair(args.site_root)}')
