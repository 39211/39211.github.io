"""Regression checks for the deployed v4 pass on new generated pages."""
from pathlib import Path
import os,subprocess,tempfile,unittest

HERE=Path(__file__).resolve().parent
SCRIPT=HERE/'apply_v4_shell.mjs'
HTML='''<!doctype html><html><head><title>Future post</title><meta name="description" content="Preserve me"><link rel="canonical" href="https://sixiangjialaundry.com/posts/future.html"><script type="application/ld+json">{"@type":"Article","headline":"Future post"}</script></head><body data-analytics-content-id="future"><header class="site-header"><a href="/go/line.html?source=post-future-nav">LINE</a></header><main><h1>Future post</h1><p>New daily post content.</p></main><footer class="site-footer"><a href="/posts/">Posts</a></footer></body></html>'''

class V4ShellTests(unittest.TestCase):
    def setUp(self):
        parent=Path('D:/AI-Lanes-work/_tmp') if os.name=='nt' else None
        if parent:parent.mkdir(parents=True,exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(prefix='v4-shell-',dir=parent);self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        css=self.root/'assets/v4/sxj-shell.css';css.parent.mkdir(parents=True);css.write_text('/* fixture */',encoding='utf-8')
    def run_shell(self):
        return subprocess.run(['node',str(SCRIPT),'--site-root',str(self.root),'--strict'],capture_output=True,text=True,encoding='utf-8')
    def test_new_daily_page_keeps_content_seo_and_attribution(self):
        p=self.root/'posts/future.html';p.parent.mkdir();p.write_text(HTML,encoding='utf-8');r=self.run_shell();self.assertEqual(0,r.returncode,r.stdout+r.stderr);out=p.read_text(encoding='utf-8')
        self.assertTrue(out.startswith(HTML.split('</head>')[0]));self.assertIn('<main><h1>Future post</h1><p>New daily post content.</p></main>',out)
        self.assertIn('source=post-future-nav',out);self.assertIn("link_source:'post-future-band'",out);self.assertIn('data-analytics-content-id="future"',out)
        before=p.read_bytes();again=self.run_shell();self.assertEqual(0,again.returncode);self.assertEqual(before,p.read_bytes())
    def test_invalid_page_stops_all_writes(self):
        p=self.root/'a-valid.html';p.write_text(HTML,encoding='utf-8');(self.root/'z-invalid.html').write_text(HTML.replace('</main>',''),encoding='utf-8');before=p.read_bytes();r=self.run_shell();self.assertEqual(1,r.returncode);self.assertEqual(before,p.read_bytes())
    def test_missing_css_is_not_a_success(self):
        (self.root/'assets/v4/sxj-shell.css').unlink();r=self.run_shell();self.assertEqual(1,r.returncode)
    def test_legacy_links_always_route_to_official_account(self):
        old='https://line.me/ti/p/4m-rA6hxf6';new='https://line.me/R/ti/p/%40454foyks'
        p=self.root/'guide.html';p.write_text(HTML.replace('New daily post content.','<a href="'+old+'">Book</a>'),encoding='utf-8')
        r=self.run_shell();self.assertEqual(0,r.returncode,r.stdout+r.stderr);out=p.read_text(encoding='utf-8');self.assertNotIn(old,out);self.assertIn(new,out)
        # Already-styled pages may be regenerated from a legacy publisher too.
        p.write_text(out.replace(new,old),encoding='utf-8');r=self.run_shell();self.assertEqual(0,r.returncode);self.assertEqual(out,p.read_text(encoding='utf-8'))

if __name__=='__main__':unittest.main()
