"""Standard-library regression tests for monthly archive metadata."""
import json
import re
import unittest
from html.parser import HTMLParser
import test_r10_homepage
from r10_homepage import journal_pages, render_journals


class HeadParser(HTMLParser):
    def __init__(self, raw):
        super().__init__(); self.meta={}; self.feed(raw)
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag=='meta':
            self.meta[attrs.get('name') or attrs.get('property')]=attrs.get('content')


class JournalMetadataTests(unittest.TestCase):
    def setUp(self):
        self.fixture=test_r10_homepage.R10Tests(); self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root
        self.template=self.root/'journal/index.html'
        fields='<meta content="OLD" name="description"><meta property="og:description" content="OLD"><meta content="OLD" name="twitter:description"><meta content="OLD" property="og:title"><meta name="twitter:title" content="OLD">'
        self.template.write_text(self.template.read_text().replace('</head>',fields+'</head>'))
        self.fixture.rows.append({'date':'2026-12-01','article_path':'posts/dec.html','editorial_title':'冬季外套的收納檢查'})
        self.fixture.write()

    def test_unique_month_topics_counts_and_social_sync(self):
        pages=journal_pages(self.root)
        descriptions=[]
        for path,raw in pages.items():
            meta=HeadParser(raw.decode()).meta
            descriptions.append(meta['description'])
            self.assertEqual(meta['description'],meta['og:description'])
            self.assertEqual(meta['description'],meta['twitter:description'])
            self.assertEqual(meta['og:title'],meta['twitter:title'])
        self.assertEqual(len(set(descriptions)),3)
        nov=HeadParser(pages['journal/2026-11/index.html'].decode()).meta
        dec=HeadParser(pages['journal/2026-12/index.html'].decode()).meta
        self.assertIn('共 8 篇',nov['description']); self.assertIn('Post 8',nov['description'])
        self.assertIn('共 1 篇',dec['description']); self.assertIn('冬季外套的收納檢查',dec['description'])
        self.assertEqual(dec['og:title'],'2026 年 12 月')
        self.assertTrue(descriptions[0].startswith('按月份閱讀'))

    def test_escape_editorial_title_and_keep_original_feed(self):
        self.fixture.rows[-1]['editorial_title']='外套 " & <script>alert(1)</script>'
        self.fixture.write();before=(self.root/'social-posts.json').read_bytes()
        pages=journal_pages(self.root);raw=pages['journal/2026-12/index.html'].decode()
        self.assertIn('外套 " & <script>alert(1)</script>',HeadParser(raw).meta['description'])
        self.assertNotIn('<script>alert(1)</script>',raw)
        self.assertEqual(before,(self.root/'social-posts.json').read_bytes())

    def test_only_existing_schema_fields_and_idempotence(self):
        for has_description in (False,True):
            with self.subTest(has_description=has_description):
                source=self.template.read_text()
                source=re.sub(r'<script.*?</script>','',source,flags=re.S)
                data={'@type':'CollectionPage'}
                if has_description:data['description']='OLD'
                self.template.write_text(source.replace('</head>','<script type="application/ld+json">'+json.dumps(data)+'</script></head>'))
                pages=render_journals(self.root)
                self.assertEqual(pages,journal_pages(self.root))
                for raw in pages.values():
                    raw=raw.decode();data=json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>',raw,re.S)[1])
                    self.assertEqual('description' in data,has_description)
                    if has_description:self.assertEqual(data['description'],HeadParser(raw).meta['description'])

    def test_no_absent_meta_fields_added(self):
        self.template.write_text('<html><head><title>Journal</title></head><body><main>OLD</main></body></html>')
        for raw in journal_pages(self.root).values():
            self.assertEqual(HeadParser(raw.decode()).meta,{})

if __name__=='__main__':unittest.main()
