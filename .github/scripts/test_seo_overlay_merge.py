"""Offline contract tests; fixtures are real SEO desk/P0a snapshots."""

import importlib.util
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "seo_overlay_merge.py"
FIXTURES = HERE / "fixtures"
WORKFLOW = HERE.parent / "workflows" / "pages.yml"
BASE = "https://sixiangjialaundry.com/"
OPEN = b"<!-- SXJ:RECENT_POSTS -->"
CLOSE = b"<!-- /SXJ:RECENT_POSTS -->"
POSTS = [f"posts/2026-10-17-slot-{n:02d}.html" for n in range(1, 4)]
LINK = (BASE + POSTS[0]).encode()
BLOCK = b'\n      <section id="daily"><a href="' + LINK + b'">2026-10-17</a></section>\n      '


def region(raw):
    start = raw.index(OPEN) + len(OPEN)
    end = raw.index(CLOSE, start)
    return raw[:start], raw[start:end], raw[end:]


def xml_bytes(entries):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod in entries:
        item = "  <url><loc>" + escape(loc) + "</loc>"
        if lastmod is not None:
            item += "<lastmod>" + escape(lastmod) + "</lastmod>"
        lines.append(item + "</url>")
    return ("\n".join(lines) + "\n</urlset>\n").encode()


def locs(raw):
    return [el.text or "" for el in ET.fromstring(raw).iter()
            if el.tag.split("}")[-1] == "loc"]


def temp_parent():
    if os.name == "nt":
        parent = Path(r"D:\AI-Lanes-work\_tmp\seop0b")
        if not Path(r"D:\AI-Lanes-work").is_dir():
            raise RuntimeError("Required D: workspace is unavailable")
        parent.mkdir(parents=True, exist_ok=True)
        return parent
    return None  # GitHub Actions ubuntu-latest uses its normal temporary directory.


def load_production():
    spec = importlib.util.spec_from_file_location("seo_overlay_merge", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="overlay-test-", dir=temp_parent())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site = self.root / "site"
        self.generated = self.root / "generated"
        self.overrides = self.root / "overrides"
        for path in (self.site, self.generated, self.overrides):
            path.mkdir()
        self.main_html = (FIXTURES / "main-index.html").read_bytes()
        p0a = (FIXTURES / "p0a-index.html").read_bytes()
        before, _, after = region(p0a)
        self.generated_html = before + BLOCK + after
        self.main_sitemap = (FIXTURES / "main-sitemap.xml").read_bytes()
        self.main_locs = locs(self.main_sitemap)
        self.assertEqual(145, len(self.main_locs), "Real 145-URL baseline fixture required")
        for root in (self.site, self.overrides):
            (root / "index.html").write_bytes(self.main_html)
            (root / "sitemap.xml").write_bytes(self.main_sitemap)
        (self.generated / "index.html").write_bytes(self.generated_html)
        entries = [(BASE + post, "2026-10-17") for post in POSTS]
        entries += [(BASE + "posts/thin-slot.html", "2026-10-17"),
                    (self.main_locs[0], "2026-10-17"),
                    (BASE + "generated-only.html", "2026-10-17"),
                    (BASE + POSTS[0], "2026-10-16")]
        (self.generated / "sitemap.xml").write_bytes(xml_bytes(entries))
        for url in self.main_locs:
            self.write_target(url, b"<!doctype html><title>SEO desk fixture</title>")
        # The homepage is a real sample, not the generic sitemap shell.
        (self.site / "index.html").write_bytes(self.main_html)
        for post in POSTS:
            self.write_target(BASE + post, b'<head><meta name="robots" content="index, follow"></head>')
        self.write_target(BASE + "posts/thin-slot.html", b'<head><meta name="robots" content="noindex, follow"></head>')
        self.write_target(BASE + "generated-only.html", b'<meta name="robots" content="index,follow"><title>Must not be appended</title>')

    def write_target(self, url, raw):
        relative = url[len(BASE):]
        if not relative or relative.endswith("/"):
            relative += "index.html"
        path = self.site / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return path

    def cli(self, command, *extra):
        args = [sys.executable, str(SCRIPT), command, "--site-root", str(self.site)]
        if command in ("merge", "verify"):
            args += ["--generated", str(self.generated), "--override-src", str(self.overrides)]
        args += list(extra)
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", check=False)

    def merge_ok(self):
        result = self.cli("merge")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        return result

    def verify_bad(self, message):
        result = self.cli("verify")
        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn(message, result.stdout + result.stderr)

    def test_snapshot_copies_exact_bytes_before_overlay(self):
        (self.site / "index.html").write_bytes(self.generated_html)
        expected = {name: (self.site / name).read_bytes() for name in ("index.html", "sitemap.xml")}
        out = self.root / "snapshot"
        result = self.cli("snapshot", "--out", str(out))
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        for name, raw in expected.items():
            self.assertEqual(raw, (out / name).read_bytes())

    def test_snapshot_fails_closed_if_either_file_missing(self):
        for name in ("index.html", "sitemap.xml"):
            with self.subTest(name=name):
                path = self.site / name
                saved = path.read_bytes()
                path.unlink()
                result = self.cli("snapshot", "--out", str(self.root / "snapshot"))
                self.assertNotEqual(0, result.returncode)
                path.write_bytes(saved)

    def test_real_homepage_preserves_seo_bytes(self):
        result = self.merge_ok()
        merged = (self.site / "index.html").read_bytes()
        self.assertIn(LINK, merged)
        self.assertEqual(BLOCK, region(merged)[1])
        self.assertEqual(region(self.main_html)[::2], region(merged)[::2])
        self.assertEqual(1, merged.count(OPEN))
        self.assertEqual(1, merged.count(CLOSE))
        self.assertIn("::notice::homepage recent posts merged", result.stdout)
        # Samples deliberately differ outside the region; a full-page replacement must fail.
        self.assertNotEqual(region(self.main_html)[::2], region(self.generated_html)[::2])

    def test_homepage_invalid_markers_fall_back_with_warning(self):
        cases = [
            ("main_missing", self.main_html.replace(OPEN, b"").replace(CLOSE, b""), self.generated_html),
            ("generated_missing", self.main_html, self.generated_html.replace(OPEN, b"").replace(CLOSE, b"")),
            ("main_duplicate", self.main_html + OPEN + CLOSE, self.generated_html),
            ("generated_duplicate", self.main_html, self.generated_html + OPEN + CLOSE),
            ("main_reversed", self.main_html.replace(OPEN, b"TEMP").replace(CLOSE, OPEN).replace(b"TEMP", CLOSE), self.generated_html),
            ("generated_reversed", self.main_html, self.generated_html.replace(OPEN, b"TEMP").replace(CLOSE, OPEN).replace(b"TEMP", CLOSE)),
            ("main_unpaired", self.main_html.replace(CLOSE, b""), self.generated_html),
        ]
        for name, main, generated in cases:
            with self.subTest(name=name):
                (self.site / "index.html").write_bytes(main)
                (self.overrides / "index.html").write_bytes(main)
                (self.generated / "index.html").write_bytes(generated)
                result = self.merge_ok()
                self.assertEqual(main, (self.site / "index.html").read_bytes())
                self.assertEqual(1, result.stdout.count("::warning::"))
                check = self.cli("verify")
                self.assertEqual(0, check.returncode, check.stdout + check.stderr)

    def test_real_sitemap_only_indexable_posts(self):
        self.merge_ok()
        merged = (self.site / "sitemap.xml").read_bytes()
        expected = self.main_locs + [BASE + post for post in POSTS]
        self.assertEqual(expected, locs(merged))
        closing = self.main_sitemap.rindex(b"</urlset>")
        self.assertTrue(merged.startswith(self.main_sitemap[:closing]))
        self.assertTrue(merged.endswith(self.main_sitemap[closing:]))
        self.assertEqual(148, len(locs(merged)))
        self.assertEqual(len(locs(merged)), len(set(locs(merged))))
        self.assertNotIn(b"ns0:", merged)
        self.assertEqual(ET.fromstring(self.main_sitemap).tag, ET.fromstring(merged).tag)
        appended = merged[closing:merged.rindex(b"</urlset>")]
        self.assertEqual(3, len(appended.splitlines()))

    def test_sitemap_escapes_xml_and_omits_missing_lastmod(self):
        special = BASE + "posts/a&b.html"
        self.write_target(special, b'<meta content="INDEX FOLLOW" name="ROBOTS">')
        (self.generated / "sitemap.xml").write_bytes(xml_bytes([(special, "2026<&>"), (BASE + POSTS[0], None)]))
        self.merge_ok()
        raw = (self.site / "sitemap.xml").read_bytes()
        self.assertIn(b"a&amp;b.html", raw)
        self.assertIn(b"<lastmod>2026&lt;&amp;&gt;</lastmod>", raw)
        self.assertIn(("<url><loc>" + BASE + POSTS[0] + "</loc></url>").encode(), raw)
        self.assertEqual(self.main_locs + [special, BASE + POSTS[0]], locs(raw))

    def test_sitemap_skips_missing_and_nonindex_posts(self):
        bad_values = [b'<meta name="robots" content="noindex, index">',
                      b'<meta name="robots" content="follow">',
                      b'<!-- <meta name="robots" content="index"> -->',
                      b'<meta name="robots" content="index"><meta name="robots" content="noindex">',
                      b'<meta name="googlebot" content="index">']
        for raw in bad_values:
            with self.subTest(raw=raw):
                (self.site / "sitemap.xml").write_bytes(self.main_sitemap)
                self.write_target(BASE + POSTS[0], raw)
                (self.site / POSTS[1]).unlink(missing_ok=True)
                self.merge_ok()
                self.assertEqual(self.main_locs + [BASE + POSTS[2]], locs((self.site / "sitemap.xml").read_bytes()))

    def test_sitemap_accepts_indexable_posts_hub(self):
        self.write_target(BASE + "posts/", b'<meta name=robots content="index,follow">')
        (self.generated / "sitemap.xml").write_bytes(xml_bytes([(BASE + "posts/", None)]))
        self.merge_ok()
        self.assertEqual(self.main_locs + [BASE + "posts/"], locs((self.site / "sitemap.xml").read_bytes()))

    def test_merge_is_idempotent(self):
        self.merge_ok()
        before = [(self.site / name).read_bytes() for name in ("index.html", "sitemap.xml")]
        self.merge_ok()
        self.assertEqual(before, [(self.site / name).read_bytes() for name in ("index.html", "sitemap.xml")])

    def test_merge_rejects_malformed_xml_without_writing(self):
        for root in (self.site, self.generated):
            with self.subTest(root=root.name):
                path = root / "sitemap.xml"
                saved = path.read_bytes()
                path.write_bytes(b"<urlset><url>")
                before = (self.site / "index.html").read_bytes()
                result = self.cli("merge")
                self.assertNotEqual(0, result.returncode)
                self.assertEqual(before, (self.site / "index.html").read_bytes())
                self.assertEqual(b"<urlset><url>", path.read_bytes())
                path.write_bytes(saved)

    def test_verify_accepts_all_five_assertions(self):
        self.merge_ok()
        result = self.cli("verify")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("148", result.stdout)

    def test_verify_rejects_missing_override_url(self):
        self.merge_ok()
        entries = [(url, None) for url in locs((self.site / "sitemap.xml").read_bytes()) if url != self.main_locs[-1]]
        (self.site / "sitemap.xml").write_bytes(xml_bytes(entries))
        self.verify_bad("Missing override sitemap URLs")

    def test_verify_rejects_missing_target(self):
        self.merge_ok()
        (self.site / POSTS[0]).unlink()
        self.verify_bad("Missing sitemap target")

    def test_verify_rejects_nonindex_post(self):
        self.merge_ok()
        self.write_target(BASE + POSTS[0], b'<meta name="robots" content="noindex,follow">')
        self.verify_bad("Post is not indexable")

    def test_verify_rejects_duplicate_urls(self):
        self.merge_ok()
        path = self.site / "sitemap.xml"
        entries = [(url, None) for url in locs(path.read_bytes())]
        entries.append(entries[-1])
        path.write_bytes(xml_bytes(entries))
        self.verify_bad("Duplicate sitemap URLs")

    def test_verify_rejects_wrong_homepage_region(self):
        self.merge_ok()
        path = self.site / "index.html"
        path.write_bytes(path.read_bytes().replace(BLOCK, b"wrong generated region"))
        self.verify_bad("Homepage")

    def test_verify_rejects_changed_homepage_outside_region(self):
        self.merge_ok()
        path = self.site / "index.html"
        path.write_bytes(b"unexpected prefix" + path.read_bytes())
        self.verify_bad("Homepage")

    def test_verify_rejects_changed_fallback_homepage(self):
        main = self.main_html.replace(OPEN, b"").replace(CLOSE, b"")
        (self.site / "index.html").write_bytes(main)
        (self.overrides / "index.html").write_bytes(main)
        self.merge_ok()
        (self.site / "index.html").write_bytes(main + b"tampered")
        self.verify_bad("Homepage")

    def test_verify_rejects_unexpected_origin(self):
        self.merge_ok()
        path = self.site / "sitemap.xml"
        path.write_bytes(path.read_bytes().replace(b"</urlset>", b"<url><loc>https://example.invalid/a.html</loc></url></urlset>"))
        self.verify_bad("Unexpected sitemap URL")

    def test_verify_rejects_malformed_xml(self):
        self.merge_ok()
        (self.site / "sitemap.xml").write_bytes(b"<broken>")
        self.verify_bad("::error::")

    def test_generated_owned_excludes_and_comparison_manifest(self):
        module = load_production()
        self.assertEqual(("posts/", "rss.xml", "feed.json", "ai-sitemap.xml"), module.GENERATED_OWNED)
        result = subprocess.run([sys.executable, str(SCRIPT), "excludes"], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(["/" + name for name in module.GENERATED_OWNED], result.stdout.splitlines())
        tree = FIXTURES / "overlay-tree"
        manifest = {p.relative_to(tree).as_posix() for p in module.overlay_files(tree)}
        self.assertEqual({"index.html", "sitemap.xml", "guides/keep.html", "guides/feed.json"}, manifest)
        for owned in module.GENERATED_OWNED:
            self.assertTrue((tree / owned).exists())
            self.assertFalse(any(path == owned or path.startswith(owned) for path in manifest))
        # Execute the actual workflow manifest heredoc against the directory fixture.
        workflow = WORKFLOW.read_text(encoding="utf-8")
        bodies = re.findall(r"          python3 << 'PY'\n(.*?)          PY", workflow, re.S)
        manifest_body = next(body for body in bodies if "overlay_files" in body)
        code = "\n".join(line[10:] if line.startswith("          ") else line for line in manifest_body.splitlines())
        env = os.environ.copy()
        env.update(SRC=str(tree), RUNNER_TEMP=str(self.root), PYTHONDONTWRITEBYTECODE="1")
        run = subprocess.run([sys.executable, "-c", code], cwd=HERE.parent.parent, env=env, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(0, run.returncode, run.stdout + run.stderr)
        actual = {Path(os.fsdecode(p)).relative_to(tree).as_posix()
                  for p in (self.root / "overlay-manifest").read_bytes().split(b"\0") if p}
        self.assertEqual(manifest, actual)
        self.assertIn('"${RSYNC_EXCLUDES[@]}"', workflow)


class WorkflowTests(unittest.TestCase):
    def test_workflow_order_and_removals(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        for forbidden in ("Forcing noindex,follow on posts", "Removing posts/*slot* URLs", "STOPGAP"):
            self.assertNotIn(forbidden, workflow)
        order = ["unittest discover", "seo_overlay_merge.py snapshot", "rsync -a",
                 "files byte-identical", "sitemap targets exist", "seo_overlay_merge.py merge",
                 "seo_overlay_merge.py verify", "actions/upload-pages-artifact@v3"]
        positions = [workflow.index(anchor) for anchor in order]
        self.assertEqual(sorted(positions), positions)
        self.assertIn("Override sitemap contains /posts/ URLs", workflow)
        self.assertIn("MIN_OVERRIDE_HTML", workflow)
        self.assertIn("MIN_SITEMAP_URLS", workflow)
        self.assertIn("seo_overlay_merge.py excludes", workflow)
        self.assertIn('::warning::Ignoring generated-owned override:', workflow)
        self.assertIn('cmp -s "$file" "./$relative"', workflow)


class FixtureTests(unittest.TestCase):
    def test_main_homepage_fixture_is_only_two_marker_lines(self):
        raw = (FIXTURES / "main-index.html").read_bytes()
        self.assertEqual(1, raw.count(b"      " + OPEN + b"\n"))
        self.assertEqual(1, raw.count(b"      " + CLOSE + b"\n"))
        unmarked = raw.replace(b"      " + OPEN + b"\n", b"").replace(b"      " + CLOSE + b"\n", b"")
        self.assertEqual("3131dacaec0d5522670a68fe1a73a296312d39fb19058de8bf7ff5c29aa75e58",
                         hashlib.sha256(unmarked).hexdigest())

    def test_real_homepage_fixtures_retain_50_lines_around_markers(self):
        for name in ("main-index.html", "p0a-index.html"):
            with self.subTest(name=name):
                lines = (FIXTURES / name).read_bytes().splitlines()
                for marker in (OPEN, CLOSE):
                    positions = [i for i, line in enumerate(lines) if marker in line]
                    self.assertEqual(1, len(positions))
                    self.assertGreaterEqual(positions[0], 50)
                    self.assertGreaterEqual(len(lines) - positions[0] - 1, 50)


if __name__ == "__main__":
    unittest.main()
