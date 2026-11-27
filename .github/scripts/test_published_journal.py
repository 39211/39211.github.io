import datetime as dt
import unittest

from render_published_journal import article, page, splice_managed


def source():
    return {"slug": "2026-11-18-social-fa-123", "sources": {"instagram": {
        "id": "123", "platform": "instagram", "time": "2026-11-18T02:00:00+08:00",
        "url": "https://www.instagram.com/p/abc123/", "video": False,
        "body": "帽圍怎麼洗？\n\n洗標 <先看> & 輕洗。"}}}


class PublishedJournalTests(unittest.TestCase):
    def test_photo_posts_have_a_full_page_without_youtube(self):
        row = source()
        record, body = article(row)
        html = page(record, body, row["sources"])
        self.assertIn("帽圍怎麼洗？", html)
        self.assertIn("洗標 &lt;先看&gt; &amp; 輕洗。", html)
        self.assertIn('src="https://www.instagram.com/p/abc123/embed/"', html)
        self.assertEqual(record["date"], "2026-11-18")

    def test_only_published_sources_from_expected_platform(self):
        row = source()
        row["sources"]["instagram"]["url"] = "https://www.instagram.com.example/p/abc123/"
        with self.assertRaises(ValueError):
            article(row)
        row = source()
        row["sources"]["instagram"]["time"] = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)).isoformat()
        with self.assertRaises(ValueError):
            article(row)

    def test_replay_updates_existing_block_preserving_old_articles(self):
        put = lambda html, text: splice_managed(html, "open", "close", "<item>", text)
        original = "<channel><item>old</item></channel>"
        once = put(original,"<item>new</item>")
        self.assertEqual(put(once,"<item>new</item>"),once)
        self.assertEqual(put(once,"<item>edited</item>").count("<item>"),2)
