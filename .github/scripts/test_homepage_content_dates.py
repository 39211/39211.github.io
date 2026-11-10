import json
import unittest
from homepage_content_dates import sync_homepage_dates

class ContentDateTests(unittest.TestCase):
    def fixture(self, authored='2026-11-03', graph=True, lastmod=True):
        home={'@type':'WebPage','url':'https://sixiangjialaundry.com/','dateModified':authored}
        other={'@type':'Organization','dateModified':'2026-10-01'}
        data={'@graph':[other,home]} if graph else [other,home]
        html=('<script type="application/ld+json">'+json.dumps(data)+'</script><!-- SXJ:RECENT_POSTS --><time datetime="2026-11-09">9</time><time datetime="2026-11-10">10</time><!-- /SXJ:RECENT_POSTS -->').encode()
        xml=('<urlset><url><loc>https://sixiangjialaundry.com/</loc>'+('<lastmod>2026-11-03</lastmod>' if lastmod else '')+'</url><url><loc>https://sixiangjialaundry.com/other.html</loc><lastmod>2026-10-01</lastmod></url></urlset>').encode()
        return html,xml
    def test_included_dates_win_and_rebuild_is_stable(self):
        html,xml=self.fixture();h,s,reason=sync_homepage_dates(html,xml)
        self.assertEqual(reason,'');self.assertIn(b'"dateModified":"2026-11-10"',h);self.assertIn(b'<lastmod>2026-11-10</lastmod>',s)
        self.assertIn(b'"@type": "Organization", "dateModified": "2026-10-01"',h)
        self.assertIn(b'<loc>https://sixiangjialaundry.com/other.html</loc><lastmod>2026-10-01</lastmod>',s)
        self.assertEqual(sync_homepage_dates(h,s),(h,s,''))
    def test_newer_authored_date_wins(self):
        h,s,reason=sync_homepage_dates(*self.fixture('2026-11-12'))
        self.assertEqual(reason,'');self.assertIn(b'<lastmod>2026-11-12</lastmod>',s)
    def test_array_and_missing_lastmod(self):
        h,s,reason=sync_homepage_dates(*self.fixture(graph=False,lastmod=False))
        self.assertEqual(reason,'');self.assertIn(b'<lastmod>2026-11-10</lastmod>',s)
    def test_bad_inputs_never_partially_change_dates(self):
        html,xml=self.fixture()
        cases=[(html.replace(b'2026-11-10',b'2026-02-30'),xml),(html.replace(b'<!-- SXJ:RECENT_POSTS -->',b''),xml),(html.replace(b'2026-11-03',b'invalid'),xml),(html,xml.replace(b'2026-11-03',b'invalid')),(html,xml.replace(b'<url><loc>https://sixiangjialaundry.com/</loc><lastmod>2026-11-03</lastmod></url>',b'')),(html.replace(b'"@type": "Organization"',b'"@type": "WebPage", "url": "https://sixiangjialaundry.com/"'),xml)]
        for h,s in cases:
            with self.subTest(h=h):
                a,b,reason=sync_homepage_dates(h,s);self.assertEqual((a,b),(h,s));self.assertTrue(reason)

if __name__=='__main__':unittest.main()
