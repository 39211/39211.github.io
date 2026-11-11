import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sync_ai_content_dates as s

URL = s.BASE+'guides/white-shoe-yellowing.html'

def html(value='2026-10-14', extra=None):
    node = {'@type':'WebPage','@id':URL+'#webpage','url':URL,'dateModified':value}
    return '<link rel="canonical" href="'+URL+'"><script type="application/ld+json">'+json.dumps([node]+(extra or []))+'</script>'

def xml(value='2026-09-07'):
    return ('<?xml version="1.0"?><urlset xmlns="'+s.NS[1:-1]+'">\n<url><loc>'+URL+'</loc><lastmod>'+value+'</lastmod><!-- keep --></url>\n</urlset>').encode()

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'guides').mkdir()
        self.page = self.root/'guides/white-shoe-yellowing.html'
        self.page.write_text(html())
        (self.root/'sitemap.xml').write_bytes(xml('2026-10-14'))
        self.scope = patch.object(s, 'REVIEWED', {URL})
        self.scope.start()
        self.addCleanup(self.scope.stop)

    def run_sync(self, raw=None):
        return s.synchronized(self.root, xml() if raw is None else raw)[0]

    def test_exact_bytes_and_idempotence(self):
        before = self.page.read_bytes()
        result = self.run_sync()
        self.assertEqual(result, xml('2026-10-14'))
        self.assertEqual(self.run_sync(result), result)
        self.assertEqual(self.page.read_bytes(), before)

    def test_conflicting_dates(self):
        self.page.write_text(html(extra=[{'@type':'Article','url':URL,'dateModified':'2026-10-15'}]))
        with self.assertRaises(ValueError): self.run_sync()

    def test_same_day_conflicting_times(self):
        self.page.write_text(html('2026-10-14T01:00:00Z', [{'@type':'Article','url':URL,'dateModified':'2026-10-14T02:00:00Z'}]))
        with self.assertRaises(ValueError): self.run_sync()

    def test_same_date_multiple_nodes(self):
        self.page.write_text(html(extra=[{'@type':'Article','url':URL,'dateModified':'2026-10-14'}]))
        self.assertEqual(self.run_sync(), xml('2026-10-14'))

    def test_unrelated_entity_ignored(self):
        self.page.write_text(html(extra=[{'@type':'Article','url':s.BASE+'other.html','dateModified':'2026-11-11'}]))
        self.assertEqual(self.run_sync(), xml('2026-10-14'))

    def test_bad_metadata(self):
        for text in [html().replace('2026-10-14','2026-02-30'),html().replace('2026-10-14','today'), html().replace('"dateModified":','"datePublished":'),html().replace('"WebPage"','"Product"'),html().replace('rel="canonical"','rel="alternate"'),html()+'<link rel="canonical" href="'+URL+'">',html()+'<meta name="robots" content="noindex">',html().replace('"dateModified":','"dateModified":"2026-10-14", "dateModified":'), html().replace('</script>','')]:
            with self.subTest(text=text):
                self.page.write_text(text)
                with self.assertRaises(ValueError): self.run_sync()

    def test_missing_file(self):
        self.page.unlink()
        with self.assertRaises(ValueError): self.run_sync()

    def test_main_sitemap_disagreement(self):
        (self.root/'sitemap.xml').write_bytes(xml('2026-10-15'))
        with self.assertRaises(ValueError): self.run_sync()

    def test_main_sitemap_duplicate(self):
        raw=xml('2026-10-14'); block=s.BLOCK.search(raw)[0]
        (self.root/'sitemap.xml').write_bytes(raw.replace(b'</urlset>',block+b'</urlset>'))
        with self.assertRaises(ValueError): self.run_sync()

    def test_no_regression(self):
        with self.assertRaises(ValueError): self.run_sync(xml('2026-11-01'))

    def test_duplicate_ai(self):
        raw=xml();block=s.BLOCK.search(raw)[0]
        with self.assertRaises(ValueError): self.run_sync(raw.replace(b'</urlset>',block+b'</urlset>'))

    def test_no_added_dates(self):
        with self.assertRaises(ValueError): self.run_sync(xml().replace(b'<lastmod>2026-09-07</lastmod>',b''))

    def test_no_other_entry_edits(self):
        other=s.BASE+'other.html'
        (self.root/'other.html').write_text(html('2026-11-01').replace(URL,other))
        extra=s.BLOCK.search(xml())[0].replace(URL.encode(),other.encode())
        original=xml().replace(b'</urlset>',extra+b'</urlset>')
        expected=xml('2026-10-14').replace(b'</urlset>',extra+b'</urlset>')
        self.assertEqual(self.run_sync(original),expected)

    def other_entry(self):
        other = s.BASE+'other.html'
        extra = s.BLOCK.search(xml())[0].replace(URL.encode(), other.encode())
        return (xml().replace(b'</urlset>', extra+b'</urlset>'),
                xml('2026-10-14').replace(b'</urlset>', extra+b'</urlset>'))

    def test_outside_metadata_changes_never_read(self):
        raw, expected = self.other_entry()
        other = self.root/'other.html'
        other.write_text(html('2026-11-11'))
        read_text = Path.read_text
        reads = []
        def record(path, *args, **kwargs):
            reads.append(path)
            return read_text(path, *args, **kwargs)
        with patch.object(Path, 'read_text', record):
            self.assertEqual(self.run_sync(raw), expected)
        self.assertEqual(reads, [self.page])

    def test_outside_malformed_json_ignored(self):
        raw, expected = self.other_entry()
        (self.root/'other.html').write_text('<script type="application/ld+json">{broken</script>')
        self.assertEqual(self.run_sync(raw), expected)

    def test_outside_missing_file_ignored(self):
        raw, expected = self.other_entry()
        self.assertFalse((self.root/'other.html').exists())
        self.assertEqual(self.run_sync(raw), expected)

    def test_reviewed_symlink_rejected(self):
        original = self.root/'real.html'
        self.page.rename(original)
        self.page.symlink_to(original)
        with self.assertRaisesRegex(ValueError, 'Symlink'): self.run_sync()

    def test_reviewed_parent_symlink_rejected(self):
        (self.root/'guides').rename(self.root/'real-guides')
        (self.root/'guides').symlink_to(self.root/'real-guides', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlink'): self.run_sync()

    def test_malformed_xml_rejected(self):
        with self.assertRaises(s.ET.ParseError): self.run_sync(xml()[:-10])

    def test_reviewed_entry_missing_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Reviewed URL missing'):
            self.run_sync(xml().replace(s.BLOCK.search(xml())[0], b''))

    def test_unsafe_urls(self):
        for url in [s.BASE+'../other.html',s.BASE+'%2e%2e/other.html',URL+'?x=1','https://evil.test/foo.html']:
            with self.subTest(url=url):
                with self.assertRaises(ValueError): self.run_sync(xml().replace(URL.encode(),url.encode()))

if __name__=='__main__': unittest.main()
