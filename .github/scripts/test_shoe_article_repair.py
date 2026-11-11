"""Regression gates for the one reviewed shoe article, using public fixtures."""
import json
from datetime import date
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from repair_shoe_article import TARGET, MANIFEST, digest, repaired_bytes, repair

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads(MANIFEST.read_text(encoding='utf-8'))
PRODUCER = Path(__file__).with_name('fixtures') / 'shoe-article-producer.json'

def caption(raw):
    return re.search(rb'<p class="post-caption">.*?</p>', raw, re.S)[0]

def graph(raw):
    return json.loads(re.search(rb'<script type="application/ld\+json">(.*?)</script>', raw, re.S)[1])['@graph']

def original_live():
    return json.loads(Path(__file__).with_name('fixtures').joinpath('shoe-article-live.json').read_text(encoding='utf-8'))['html'].encode('utf-8')

class ShoeRepairTests(unittest.TestCase):
    def sources(self):
        return [original_live(), json.loads(PRODUCER.read_text(encoding='utf-8'))['html'].encode('utf-8')]

    def test_verified_variants_and_idempotence(self):
        for raw, variant in zip(self.sources(), DATA['variants']):
            self.assertEqual(digest(raw), variant['before_sha256'])
            fixed = repaired_bytes(raw)
            self.assertEqual(digest(fixed), variant['after_sha256'])
            self.assertEqual(repaired_bytes(fixed), fixed)

    def test_original_note_and_identity_unchanged(self):
        for raw in self.sources():
            fixed = repaired_bytes(raw)
            self.assertEqual(caption(raw), caption(fixed))
            for pattern in [rb'<title>.*?</title>', rb'<meta[^>]+>', rb'<link[^>]+>', rb'<picture>.*?</picture>', rb'<time[^>]+>.*?</time>', rb'<h1>.*?</h1>', rb'<figcaption>.*?</figcaption>']:
                self.assertEqual(re.findall(pattern,raw,re.S),re.findall(pattern,fixed,re.S))
            before=graph(raw);after=graph(fixed)
            for old,new in zip(before,after):
                if old['@type']=='BlogPosting':
                    expected=dict(old);expected['articleSection']='鞋面與鞋內檢查';expected.pop('wordCount')
                    self.assertEqual(expected,new)
                elif old['@type']!='FAQPage':self.assertEqual(old,new)

    def test_faq_sync_and_article_topic(self):
        for raw in self.sources():
            fixed=repaired_bytes(raw).decode()
            faq=next(x for x in graph(fixed.encode()) if x['@type']=='FAQPage')
            visible=re.search(r'<section class="article-faq".*?</section>',fixed,re.S)[0]
            pairs=re.findall(r'<h3>(.*?)</h3>\s*<p>(.*?)</p>',visible,re.S)
            self.assertEqual(pairs,[(x['name'],x['acceptedAnswer']['text']) for x in faq['mainEntity']])
            article=re.search(r'<main>.*?</main>',fixed,re.S)[0]
            for invalid in ['絎縫','棉被','寢具','被套','毛毯','布品收納','fabric-storage.html']:
                self.assertNotIn(invalid,article)
            self.assertIn('shoe-bag-care.html',article)
            meta=re.search(r'<meta name="description" content="([^"]*)"',fixed)[1]
            for x in graph(fixed.encode()):
                if x['@type'] in ('BlogPosting','WebPage'):self.assertEqual(x['description'],meta)

    @patch('repair_shoe_article.taipei_today', return_value=date(2026,11,12))
    def test_reinjected_old_page_and_other_file_protection(self, _today):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/TARGET;target.parent.mkdir()
            other=root/'posts/other.html';other.write_bytes(b'untouched')
            (root/'posts/2026-11-11-slot-01.html').write_text('<html>Public prior article stub</html>')
            for raw in self.sources():
                target.write_bytes(raw);repair(root)
                self.assertEqual(target.read_bytes(),repaired_bytes(raw))
                repair(root);self.assertEqual(other.read_bytes(),b'untouched')

    def test_unknown_changed_or_missing_input_fails_without_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);target=root/TARGET;target.parent.mkdir()
            with self.assertRaises(FileNotFoundError):repair(root)
            for raw in self.sources():
                for source in (raw,repaired_bytes(raw)):
                    for changed in (source+b'\n',source.replace('雨後'.encode(),'雨天'.encode(),1)):
                        target.write_bytes(changed)
                        with self.assertRaises(ValueError):repair(root)
                        self.assertEqual(target.read_bytes(),changed)

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'posts').mkdir();other=root/'other';other.write_bytes(self.sources()[0]);(root/TARGET).symlink_to(other)
            with self.assertRaises(ValueError):repair(root)
            self.assertEqual(other.read_bytes(),self.sources()[0])

    def test_corrupt_manifest_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'manifest.json';data=json.loads(MANIFEST.read_text());data['variants'][0]['normalized_after_sha256']='0'*64;p.write_text(json.dumps(data))
            with patch('repair_shoe_article.MANIFEST',p):
                with self.assertRaises(ValueError):repaired_bytes(self.sources()[0])

    def test_workflow_order(self):
        workflow=(ROOT/'.github/workflows/pages.yml').read_text()
        tests=workflow.index("python3 -m unittest discover")
        repair_step=workflow.index('python3 .github/scripts/repair_shoe_article.py --site-root .')
        snapshot=workflow.index('seo_overlay_merge.py snapshot')
        self.assertLess(tests,repair_step);self.assertLess(repair_step,snapshot)
        self.assertIn('apply_v4_shell.mjs --site-root . --strict',workflow)

if __name__=='__main__':unittest.main()
