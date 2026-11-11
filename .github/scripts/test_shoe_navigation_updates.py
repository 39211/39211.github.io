"""Daily publisher navigation changes must not weaken protected article checks."""
import json
import re
import tempfile
import unittest
from unittest.mock import patch
from datetime import date
from pathlib import Path
from repair_shoe_article import MANIFEST, TARGET, RELATED, repaired_bytes, repair
from test_shoe_article_repair import original_live, PRODUCER, caption

DATA = json.loads(MANIFEST.read_text(encoding='utf-8'))
NEXT = '<li class="article-related__item">下一則｜<a class="article-related__link" href="https://sixiangjialaundry.com/posts/2026-11-12-slot-01.html">Day 259：下一篇公開測試標題</a></li>'
PREVIOUS = '<li class="article-related__item">上一則｜<a class="article-related__link" href="https://sixiangjialaundry.com/posts/2026-11-10-slot-02.html">Day 257：更新的前篇 &amp; 標題</a></li>'
RELATED_POST = '<li class="article-related__item"><a class="article-related__link" href="https://sixiangjialaundry.com/posts/2026-11-12-feature-reel-test.html">日更推薦</a>（2026-11-12）</li>'

def sources():
    originals=[original_live(),json.loads(PRODUCER.read_text(encoding='utf-8'))['html'].encode()]
    return originals+[repaired_bytes(x) for x in originals]

def next_page(raw):
    text=raw.decode()
    section=RELATED.search(text)[0]
    previous=re.search(r'<li class="article-related__item">上一則｜.*?</li>',section)[0]
    return text.replace(previous,previous+'\n              '+NEXT,1).encode()

class NavigationUpdateTests(unittest.TestCase):
    def test_next_day_in_all_four_states_is_preserved(self):
        for raw in sources():
            changed=next_page(raw)
            fixed=repaired_bytes(changed)
            self.assertIn(NEXT.encode(),fixed)
            self.assertEqual(repaired_bytes(fixed),fixed)
            self.assertEqual(caption(raw),caption(fixed))
            self.assertNotIn('棉被多久洗一次'.encode(),fixed)

    def test_previous_and_same_day_next_slot(self):
        raw=original_live().decode();previous=re.search(r'<li class="article-related__item">上一則｜.*?</li>',raw)[0]
        for prev in [PREVIOUS,'']:
            changed=raw.replace(previous,prev)
            self.assertEqual(PREVIOUS.encode() in repaired_bytes(changed.encode()),bool(prev))

    def test_related_article_refresh_is_validated_but_not_retained(self):
        for raw in sources():
            text=next_page(raw).decode();section=RELATED.search(text)[0]
            section=re.sub(r'<li class="article-related__item"><a class="article-related__link" href="https://sixiangjialaundry.com/posts/[^\"]+\.html">.*?</li>', '', section)
            pos=section.index(DATA['related_guide_sets'][0][0]) if DATA['related_guide_sets'][0][0] in section else section.index(DATA['related_guide_sets'][1][0])
            updated=section[:pos]+RELATED_POST+'\n              '+section[pos:]
            fixed=repaired_bytes(text.replace(RELATED.search(text)[0],updated).encode())
            self.assertNotIn('日更推薦'.encode(),fixed)
            self.assertIn(NEXT.encode(),fixed)
            self.assertIn('shoe-insole-check.html'.encode(),fixed)

    def test_word_count_changes_only_in_blog_posting(self):
        for raw in sources():
            for n in (1,2201,999999):
                text=next_page(raw).decode()
                if '"wordCount":2175' in text:text=text.replace('"wordCount":2175',f'"wordCount":{n}')
                else:text=text.replace('"articleSection":"鞋面與鞋內檢查"','"articleSection":"鞋面與鞋內檢查",'+f'"wordCount":{n}')
                fixed=repaired_bytes(text.encode())
                self.assertNotIn(b'"wordCount"',fixed)
                self.assertIn(NEXT.encode(),fixed)
        for value in ['0','-1','2.5','"2201"','1000000','true','null','2175,"wordCount":2201']:
            with self.subTest(value=value),self.assertRaises(ValueError):
                repaired_bytes(original_live().replace(b'"wordCount":2175',('"wordCount":'+value).encode()))

    def test_protected_content_mutations_are_rejected_in_all_states(self):
        mutations=[('雨後鞋櫃收納前的小檢查','新的標題'),('2026-11-11T20:30:00+08:00','2026-11-11T20:31:00+08:00'),('/assets/2026-11-11/slot-02.png','/assets/2026-11-11/changed.png'),('很多味道不是當天就出現','改寫原始門市筆記'),('鞋墊濕度','另一個檢查點'),('https://sixiangjialaundry.com/posts/2026-11-11-slot-02.html#article','https://example.com/changed'),('name="description" content="','name="description" content="改寫'),('<style>','<style>body{display:none}'),('</head>','<script>alert(1)</script></head>')]
        for raw in sources():
            raw=next_page(raw)
            for a,b in mutations:
                if a.encode() not in raw:continue
                with self.subTest(change=a),self.assertRaises(ValueError):repaired_bytes(raw.replace(a.encode(),b.encode(),1))
            for a in ['棉被多久洗一次?','雨後鞋子表面乾了就能收進鞋櫃嗎？']:
                if a.encode() in raw:
                    with self.assertRaises(ValueError):repaired_bytes(raw.replace(a.encode(),'其他FAQ'.encode(),1))

    def test_injected_html_attributes_urls_and_unsafe_text_rejected(self):
        replacements=[
            ('下一則｜','下一則｜<script>alert(1)</script>'),
            ('class="article-related__link"','class="article-related__link" onclick="alert(1)"'),
            ('https://sixiangjialaundry.com/posts/','https://example.com/posts/'),
            ('https://sixiangjialaundry.com/posts/','https://sixiangjialaundry.com.evil.test/posts/'),
            ('2026-11-12-slot-01.html','../private.html'),
            ('2026-11-12-slot-01.html','2026-11-12-slot-01.html?redirect=evil'),
            ('下一篇公開測試標題','&lt;script&gt;alert(1)&lt;/script&gt;'),
            ('下一篇公開測試標題','&#x3c;script&#x3e;'),
            ('下一篇公開測試標題','<img src=x onerror=alert(1)>'),
            ('Day 259：','Day 999：'),
            ('2026-11-12-slot-01','2026-11-10-slot-01'),
            ('2026-11-12-slot-01','2026-13-12-slot-01'),
            ('2026-11-12-slot-01','2026-11-12-feature-reel-test'),
        ]
        for raw in sources():
            changed=next_page(raw)
            for a,b in replacements:
                bad=changed.replace(NEXT.encode(),NEXT.replace(a,b).encode())
                with self.subTest(change=a,b=b),self.assertRaises(ValueError):repaired_bytes(bad)
            for extra in ['<script>alert(1)</script>','<!-- unknown -->','<div>changed</div>',NEXT]:
                bad=changed.replace(NEXT.encode(),(NEXT+extra).encode())
                with self.assertRaises(ValueError):repaired_bytes(bad)

    def test_unknown_recommendation_and_container_changes_rejected(self):
        raw=next_page(original_live()).decode()
        for a,b in [('guides/bedding-duvet-cleaning.html','guides/unreviewed.html'),('article-related__title','article-related__new-title'),('延伸閱讀','未知區塊'),('（2026-11-10）','（2026-11-09）')]:
            self.assertIn(a,raw)
            with self.assertRaises(ValueError):repaired_bytes(raw.replace(a,b,1).encode())
        section=RELATED.search(raw)[0]
        with self.assertRaises(ValueError):repaired_bytes(raw.replace(section,section+section).encode())

    def test_stylesheet_javascript_and_summary_drift_rejected(self):
        for raw in sources():
            text=next_page(raw).decode()
            scripts=re.findall(r'<script\b[^>]*\bsrc="([^"]+)"',text)
            styles=re.findall(r'<link\b(?=[^>]*rel="stylesheet")[^>]*href="([^"]+)"',text)
            self.assertTrue(scripts)
            self.assertTrue(styles or '<style>' in text)
            if not styles:
                with self.assertRaises(ValueError):repaired_bytes(text.replace('<style>','<style>body{display:none}',1).encode())
            for url in scripts[:1]+styles[:1]:
                with self.assertRaises(ValueError):repaired_bytes(text.replace(url,url+'?unknown=1',1).encode())
            section=re.search(r'<h2 id="summary">.*?<h2 id="store-note">',text,re.S)[0]
            with self.assertRaises(ValueError):repaired_bytes(text.replace(section,section.replace('<li>','<li>不受核准的文案',1)).encode())

    @patch('repair_shoe_article.taipei_today', return_value=date(2026,11,12))
    def test_no_partial_write_and_other_files_unchanged(self, _today):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/TARGET;target.parent.mkdir();other=root/'posts/other.html';other.write_bytes(b'keep')
            (root/'posts/2026-11-11-slot-01.html').write_text('<html>Public prior article stub</html>')
            (root/'posts/2026-11-12-slot-01.html').write_text('<html>Public next article stub</html>')
            for raw in sources():
                good=next_page(raw);target.write_bytes(good);repair(root)
                self.assertEqual(target.read_bytes(),repaired_bytes(good));self.assertEqual(other.read_bytes(),b'keep')
                bad=good.replace(NEXT.encode(),(NEXT+'<script>bad</script>').encode());target.write_bytes(bad)
                with self.assertRaises(ValueError):repair(root)
                self.assertEqual(target.read_bytes(),bad);self.assertEqual(other.read_bytes(),b'keep')

    def test_missing_future_symlink_targets_reject_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/TARGET;target.parent.mkdir()
            prior=root/'posts/2026-11-11-slot-01.html';following=root/'posts/2026-11-12-slot-01.html'
            prior.write_text('<html>Public prior article stub</html>')
            raw=next_page(original_live());target.write_bytes(raw)
            with patch('repair_shoe_article.taipei_today',return_value=date(2026,11,12)):
                with self.assertRaisesRegex(ValueError,'Missing or unsafe'):repair(root)
                self.assertEqual(target.read_bytes(),raw)
                following.symlink_to(prior)
                with self.assertRaisesRegex(ValueError,'Missing or unsafe'):repair(root)
                self.assertEqual(target.read_bytes(),raw)
                following.unlink();following.write_text('<html>Public next article stub</html>')
            with patch('repair_shoe_article.taipei_today',return_value=date(2026,11,11)):
                with self.assertRaisesRegex(ValueError,'Future chronological'):repair(root)
                self.assertEqual(target.read_bytes(),raw)
            with patch('repair_shoe_article.taipei_today',return_value=date(2026,11,12)):
                repair(root)
                self.assertEqual(target.read_bytes(),repaired_bytes(raw))
                repair(root)
                self.assertEqual(target.read_bytes(),repaired_bytes(raw))

    def test_taipei_clock_timezone_is_explicit(self):
        from repair_shoe_article import taipei_today
        with patch('repair_shoe_article.datetime') as clock:
            clock.now.return_value.date.return_value=date(2026,11,12)
            self.assertEqual(taipei_today(),date(2026,11,12))
            self.assertEqual(str(clock.now.call_args.args[0]),'Asia/Taipei')

if __name__=='__main__':unittest.main()
