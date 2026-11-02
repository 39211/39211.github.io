"""Contract tests for simulate_restore.ai_sitemap_added_urls (add-only ai-sitemap check)."""

import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("simulate_restore", HERE / "simulate_restore.py")
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)

BASE = "https://sixiangjialaundry.com/"
HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
TAIL = "</urlset>\n"


def entry(path, lastmod=None, extra=""):
    line = "  <url><loc>" + BASE + path + "</loc>"
    if lastmod:
        line += "<lastmod>" + lastmod + "</lastmod>"
    return line + extra + "</url>\n"


def doc(*entries, head=HEAD, tail=TAIL):
    return (head + "".join(entries) + tail).encode("utf-8")


BEFORE = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"))


class AiSitemapAddOnlyTests(unittest.TestCase):
    def added(self, after, before=BEFORE):
        return sim.ai_sitemap_added_urls(before, after)

    def rejects(self, after, text, before=BEFORE):
        with self.assertRaises(AssertionError) as caught:
            self.added(after, before)
        self.assertIn(text, str(caught.exception))

    def test_identical_has_no_additions(self):
        self.assertEqual(self.added(BEFORE), [])

    def test_appended_pages_are_accepted_in_order(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                    entry("guides/x.html", "2026-11-01", "<changefreq>daily</changefreq><!-- page-guides-x -->"),
                    entry("services/y.html"))
        self.assertEqual(self.added(after), [BASE + "guides/x.html", BASE + "services/y.html"])

    def test_added_page_between_existing_entries_is_accepted(self):
        after = doc(entry(""), entry("guides/x.html"), entry("posts/a.html", "2026-10-17"),
                    entry("posts/b.html", "2026-10-17"))
        self.assertEqual(self.added(after), [BASE + "guides/x.html"])

    def test_removed_entry_is_rejected(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("guides/x.html"))
        self.rejects(after, "lost or altered")

    def test_removal_hidden_by_an_addition_is_rejected(self):
        after = doc(entry(""), entry("posts/b.html", "2026-10-17"), entry("guides/x.html"),
                    entry("guides/z.html"))
        self.rejects(after, "lost or altered")

    def test_edited_entry_is_rejected(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-18"), entry("posts/b.html", "2026-10-17"))
        self.rejects(after, "lost or altered")

    def test_reordered_entries_are_rejected(self):
        after = doc(entry(""), entry("posts/b.html", "2026-10-17"), entry("posts/a.html", "2026-10-17"))
        self.rejects(after, "lost or altered")

    def test_changed_header_or_footer_is_rejected(self):
        self.rejects(doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                         head=HEAD + "<!-- extra -->\n"), "outside its <url> entries")
        self.rejects(doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                         tail="<!-- extra -->\n" + TAIL), "outside its <url> entries")

    def test_added_posts_url_is_rejected(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                    entry("posts/c.html"))
        self.rejects(after, "/posts/")

    def test_duplicate_added_url_is_rejected(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                    entry("guides/x.html"), entry("guides/x.html", "2026-11-01"))
        self.rejects(after, "duplicate")

    def test_added_entry_duplicating_an_existing_url_is_rejected(self):
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                    entry("", "2026-11-01"))
        self.rejects(after, "duplicate")

    def test_added_entry_without_one_loc_is_rejected(self):
        broken = BEFORE.replace(b"</urlset>", b"  <url><lastmod>2026-11-01</lastmod></url>\n</urlset>")
        self.rejects(broken, "exactly one <loc>")

    def test_crlf_files_are_handled(self):
        before = BEFORE.replace(b"\n", b"\r\n")
        after = doc(entry(""), entry("posts/a.html", "2026-10-17"), entry("posts/b.html", "2026-10-17"),
                    entry("guides/x.html")).replace(b"\n", b"\r\n")
        self.assertEqual(self.added(after, before), [BASE + "guides/x.html"])


if __name__ == "__main__":
    unittest.main()
