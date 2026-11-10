import json, re, tempfile, unittest
from pathlib import Path
from r10_homepage import recent_cards, records, render_journals, journal_pages, card_image
from seo_overlay_merge import homepage_result

class R10Tests(unittest.TestCase):
    def setUp(self):
        parent=Path('D:/AI-Lanes-work/_tmp') if Path('D:/AI-Lanes-work').exists() else None
        self.temp=tempfile.TemporaryDirectory(prefix='sxj-r10-',dir=parent);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'scripts/sxj-r10-20261103').mkdir(parents=True)
        (self.root/'scripts/sxj-r10-20261103/r6-posts.json').write_text('[]')
        (self.root/'journal').mkdir()
        (self.root/'journal/index.html').write_text('<html><head><title>Journal</title><link rel="canonical" href="https://sixiangjialaundry.com/journal/"></head><body data-sxj-release="r10-20261103"><main>OLD</main></body></html>')
        (self.root/'sitemap.xml').write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
        self.rows=[{'article_path':f'posts/2026-11-03-slot-{i:02}.html','date':'2026-11-03','topic':f'Post {i}','image_url':'https://sixiangjialaundry.com/assets/services/a.jpg'} for i in range(1,9)]
        self.write()
        self.template=b'<body data-sxj-release="r10-20261103"><div><!-- SXJ:RECENT_POSTS -->OLD<!-- /SXJ:RECENT_POSTS --></div></body>'
    def write(self):
        (self.root/'social-posts.json').write_text(json.dumps({'article_posts':self.rows}),encoding='utf-8')
    def test_first_deploy_does_not_need_legacy_markers(self):
        html,ok,_=homepage_result(self.template,b'<main>legacy without marker</main>',self.root)
        self.assertTrue(ok);self.assertEqual(html.count(b'<article '),6);self.assertNotIn(b'OLD',html)
    def test_new_daily_article_and_month_are_visible(self):
        first=recent_cards(self.root,self.template)
        self.rows.append({'article_path':'posts/2026-12-01-slot-01.html','date':'2026-12-01','topic':'New December'})
        self.write();second=recent_cards(self.root,self.template)
        self.assertNotEqual(first,second);self.assertIn(b'New December',second)
        pages=render_journals(self.root)
        self.assertIn('journal/2026-12/index.html',pages)
        self.assertIn(b'/journal/2026-12/',(self.root/'sitemap.xml').read_bytes())
        self.assertEqual(pages,journal_pages(self.root))
    def test_month_contains_every_unique_article(self):
        self.rows.append(dict(self.rows[0]));self.write()
        pages=render_journals(self.root);raw=pages['journal/2026-11/index.html']
        self.assertEqual(raw.count(b'<article '),8)
        self.assertIn(b'https://sixiangjialaundry.com/journal/2026-11/',raw)
    def test_title_escaped_and_dangerous_path_excluded(self):
        self.rows[0]['topic']='<script>alert(1)</script>'
        self.rows.append({'article_path':'posts/../secret.html','date':'2026-11-04','topic':'Bad'})
        self.write();raw=render_journals(self.root)['journal/2026-11/index.html']
        self.assertIn(b'&lt;script&gt;',raw);self.assertNotIn(b'<script>',raw);self.assertNotIn(b'/secret.html',raw)
    def test_month_schema_matches_visible_articles_and_preserves_title_urls(self):
        p=self.root/'journal/index.html'
        original=p.read_text(encoding='utf-8').replace('<link rel="canonical" href="https://sixiangjialaundry.com/journal/">','<link href="https://sixiangjialaundry.com/journal/" rel="canonical"><meta content="https://sixiangjialaundry.com/journal/" property="og:url">')
        schema='<script type="application/ld+json">'+json.dumps({'@type':'CollectionPage','mainEntity':{'itemListElement':[{'url':'STALE'}]}})+'</script>'
        p.write_text(original.replace('</head>',schema+'</head>'),encoding='utf-8')
        self.rows[0]['topic']='Original https://sixiangjialaundry.com/journal/ </script><script>alert(1)</script>'
        self.rows.append({'article_path':'posts/2026-12-01-slot-01.html','date':'2026-12-01','topic':'December'})
        self.write();pages=render_journals(self.root)
        for month,count in [('2026-11',8),('2026-12',1)]:
            raw=pages[f'journal/{month}/index.html'].decode('utf-8')
            data=json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>',raw,re.S)[1])
            self.assertEqual(data['url'],f'https://sixiangjialaundry.com/journal/{month}/')
            self.assertIn(f'<link href="https://sixiangjialaundry.com/journal/{month}/" rel="canonical">',raw)
            self.assertIn(f'<meta content="https://sixiangjialaundry.com/journal/{month}/" property="og:url">',raw)
            items=data['mainEntity']['itemListElement'];self.assertEqual(len(items),count)
            expected={'https://sixiangjialaundry.com/'+row['article_path'] for row in self.rows if row['date'].startswith(month)}
            self.assertEqual({item['url'] for item in items},expected)
            self.assertNotIn('<script>alert',raw)
        nov=pages['journal/2026-11/index.html'].decode('utf-8')
        self.assertIn('Original https://sixiangjialaundry.com/journal/',nov)
        self.assertEqual(pages,journal_pages(self.root))

    def test_card_derivative_requires_real_local_file(self):
        original='https://sixiangjialaundry.com/assets/2026-11-10/slot-01.png'
        self.assertEqual(card_image(self.root,original),original)
        target=self.root/'assets/2026-11-10/slot-01.webp'
        target.parent.mkdir(parents=True);target.write_bytes(b'fixture')
        self.assertEqual(card_image(self.root,original),original.replace('.png','.webp'))
        self.assertEqual(card_image(self.root,'/assets/2026-11-10/slot-01.png'),'/assets/2026-11-10/slot-01.webp')
        for value in ['https://i.ytimg.com/vi/id/hqdefault.jpg','https://other.example/assets/2026-11-10/slot-01.png',original+'?v=1',original+'#crop','/assets/services/a.png']:
            self.assertEqual(card_image(self.root,value),value)
    def test_only_home_cards_use_webp_journal_and_index_keep_original(self):
        original='https://sixiangjialaundry.com/assets/2026-11-10/slot-01.png'
        target=self.root/'assets/2026-11-10/slot-01.webp'
        target.parent.mkdir(parents=True);target.write_bytes(b'fixture')
        self.rows=[{'article_path':'posts/2026-11-10-slot-01.html','date':'2026-11-10','topic':'Latest','image_url':original}];self.write()
        before=(self.root/'social-posts.json').read_bytes()
        self.assertIn(original.replace('.png','.webp').encode(),recent_cards(self.root,self.template))
        self.assertIn(original.encode(),journal_pages(self.root)['journal/index.html'])
        self.assertEqual(before,(self.root/'social-posts.json').read_bytes())

    def test_merged_cards_drive_final_homepage_dates(self):
        from homepage_content_dates import sync_homepage_dates
        self.rows=[{'article_path':'posts/2026-11-10-slot-01.html','date':'2026-11-10','topic':'Latest'}];self.write()
        template=self.template.replace(b'<body',b'<script type="application/ld+json">{"@type":"WebPage","url":"https://sixiangjialaundry.com/","dateModified":"2026-11-03"}</script><body')
        merged,ok,_=homepage_result(template,b'legacy',self.root)
        sitemap=b'<urlset><url><loc>https://sixiangjialaundry.com/</loc><lastmod>2026-11-03</lastmod></url></urlset>'
        html,xml,reason=sync_homepage_dates(merged,sitemap)
        self.assertTrue(ok);self.assertEqual(reason,'')
        self.assertIn(b'"dateModified":"2026-11-10"',html)
        self.assertIn(b'<lastmod>2026-11-10</lastmod>',xml)

    def test_editorial_title_wins_without_rewriting_feed(self):
        self.rows[0]['editorial_title']='Corrected title'
        self.write();before=(self.root/'social-posts.json').read_bytes()
        pages=journal_pages(self.root)
        self.assertIn(b'Corrected title',pages['journal/index.html'])
        self.assertEqual(before,(self.root/'social-posts.json').read_bytes())

    def test_bad_index_blocks_release(self):
        (self.root/'social-posts.json').write_text('{bad')
        with self.assertRaises(ValueError):homepage_result(self.template,b'legacy',self.root)
    def test_missing_marker_blocks_r10_release(self):
        with self.assertRaises(ValueError):homepage_result(b'<body data-sxj-release="r10-20261103">',b'legacy',self.root)

if __name__=='__main__':unittest.main()

