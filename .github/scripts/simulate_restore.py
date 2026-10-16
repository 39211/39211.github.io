"""Local-only, offline rehearsal of the restore sequence (not called by pages.yml)."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

from seo_overlay_merge import GENERATED_OWNED, overlay_files


HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
SCRIPT = HERE / "seo_overlay_merge.py"
BASE = "https://sixiangjialaundry.com/"
OPEN = b"<!-- SXJ:RECENT_POSTS -->"
CLOSE = b"<!-- /SXJ:RECENT_POSTS -->"
POSTS = [f"posts/2026-10-17-slot-{n:02d}.html" for n in range(1, 4)]


def sitemap_locs(raw):
    return [el.text or "" for el in ET.fromstring(raw).iter()
            if el.tag.split("}")[-1] == "loc"]


def write(root, relative, raw):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)


def simulate_rsync(source, target, exclusions):
    """Implement the workflow's root-anchored exclusions independently of its manifest."""
    copied = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.name == "README.md":
            continue
        relative = path.relative_to(source).as_posix()
        excluded = False
        for pattern in exclusions:
            name = pattern.removeprefix("/")
            if relative == name.rstrip("/") or (name.endswith("/") and relative.startswith(name)):
                excluded = True
                break
        if not excluded:
            dest = target / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            copied.append(path)
    return copied


def run():
    # A missing D: drive is an error; this rehearsal never falls back to C:.
    temp_root = Path(r"D:\AI-Lanes-work\_tmp\seop0b")
    if os.name != "nt" or not Path(r"D:\AI-Lanes-work").is_dir():
        raise RuntimeError("Run this local rehearsal on the configured Windows D: workspace")
    temp_root.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = os.environ["TMP"] = str(temp_root)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    with tempfile.TemporaryDirectory(prefix="restore-simulation-", dir=temp_root) as folder:
        work = Path(folder)
        site, source, generated = work / "site", work / "overrides", work / "generated"
        for path in (site, source):
            path.mkdir()
        main_html = (FIXTURES / "main-index.html").read_bytes()
        p0a_html = (FIXTURES / "p0a-index.html").read_bytes()
        start = p0a_html.index(OPEN) + len(OPEN)
        end = p0a_html.index(CLOSE, start)
        link = BASE + POSTS[0]
        block = ('\n      <section class="section surface" id="daily">'
                 f'<a href="{link}">2026-10-17 published post</a></section>\n      ').encode()
        produced_html = p0a_html[:start] + block + p0a_html[end:]
        desk_xml = (FIXTURES / "main-sitemap.xml").read_bytes()
        main_urls = sitemap_locs(desk_xml)
        if len(main_urls) != 145:
            raise AssertionError("Expected real 145-URL SEO desk fixture")
        for url in main_urls:
            relative = url[len(BASE):]
            if not relative or relative.endswith("/"):
                relative += "index.html"
            write(source, relative, b"<!doctype html><title>SEO desk target fixture</title>\n")
        write(source, "index.html", main_html)
        write(source, "sitemap.xml", desk_xml)
        write(source, "README.md", b"Do not copy\n")
        write(site, "index.html", produced_html)
        entries = [(BASE, None)] + [(BASE + post, "2026-10-17") for post in POSTS]
        produced_xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for url, lastmod in entries:
            produced_xml += "  <url><loc>" + escape(url) + "</loc>"
            if lastmod:
                produced_xml += "<lastmod>" + lastmod + "</lastmod>"
            produced_xml += "</url>\n"
        produced_xml += "</urlset>\n"
        write(site, "sitemap.xml", produced_xml.encode())
        robots = b'<head><meta name="robots" content="index, follow"></head>\n'
        for post in POSTS:
            write(site, post, robots)
        write(site, "posts/index.html", robots + b"Generated hub\n")
        feed = ('{"items":[{"url":"' + link + '"}]}\n').encode()
        rss = ('<rss><channel><item><link>' + link + '</link></item></channel></rss>\n').encode()
        write(site, "feed.json", feed)
        write(site, "rss.xml", rss)
        write(site, "ai-sitemap.xml", produced_xml.encode())
        # Deliberately conflicting overrides demonstrate all generated-owned exclusions.
        for owned in GENERATED_OWNED:
            relative = owned + "index.html" if owned.endswith("/") else owned
            write(source, relative, b"Conflicting override must be ignored\n")
        protected = {p.relative_to(site).as_posix(): p.read_bytes()
                     for p in site.rglob("*") if p.is_file()
                     and (p.relative_to(site).as_posix().startswith("posts/") or p.name in GENERATED_OWNED)}

        def call(command, *args):
            completed = subprocess.run([sys.executable, str(SCRIPT), command, *map(str, args)],
                                       capture_output=True, text=True, encoding="utf-8", check=False)
            print(completed.stdout, end="")
            if completed.returncode:
                raise RuntimeError(completed.stderr or f"{command} failed")
            return completed.stdout

        # Same order as pages.yml after its unittest/pre-overlay gate.
        call("snapshot", "--site-root", site, "--out", generated)
        exclusions = call("excludes").splitlines()
        for owned in GENERATED_OWNED:
            if (source / owned).exists():
                print(f"::warning::Ignoring generated-owned override: {owned.rstrip('/')}")
        copied = simulate_rsync(source, site, exclusions)
        manifest = overlay_files(source)
        if set(copied) != set(manifest) or not manifest:
            raise AssertionError("rsync exclusions and comparison manifest disagree")
        for path in manifest:
            if path.read_bytes() != (site / path.relative_to(source)).read_bytes():
                raise AssertionError(f"Overlay byte mismatch: {path}")
        for url in sitemap_locs((site / "sitemap.xml").read_bytes()):
            relative = url[len(BASE):]
            if not relative or relative.endswith("/"):
                relative += "index.html"
            if not (site / relative).is_file():
                raise AssertionError(f"Post-overlay target missing: {relative}")
        call("merge", "--site-root", site, "--generated", generated, "--override-src", source)
        call("verify", "--site-root", site, "--generated", generated, "--override-src", source)
        homepage = (site / "index.html").read_bytes()
        urls = sitemap_locs((site / "sitemap.xml").read_bytes())
        if link.encode() not in homepage or len(urls) != 148:
            raise AssertionError("Homepage link or merged sitemap count is wrong")
        if homepage[:homepage.index(OPEN)] != main_html[:main_html.index(OPEN)]:
            raise AssertionError("SEO desk homepage prefix changed")
        if homepage[homepage.index(CLOSE):] != main_html[main_html.index(CLOSE):]:
            raise AssertionError("SEO desk homepage suffix changed")
        for relative, raw in protected.items():
            if (site / relative).read_bytes() != raw:
                raise AssertionError(f"Generated-owned bytes changed: {relative}")
        print("homepage_has_fake_post_link=True")
        print(f"final_sitemap_urls={len(urls)} (145 SEO desk + 3 generated posts)")
        for post in POSTS:
            if (site / post).read_bytes() != robots:
                raise AssertionError(f"Post robots changed: {post}")
            print(f"post_robots[{post}]=index, follow (unchanged)")
        print(f"feed_json_preserved={(site / 'feed.json').read_bytes() == feed}")
        print(f"rss_xml_preserved={(site / 'rss.xml').read_bytes() == rss}")
        print("ai_sitemap_preserved=True; posts_hub_preserved=True")
        print(f"overlay_cmp_files={len(manifest)}; all_targets_exist=True; all_assertions_passed=True")
    print("simulation_temp_removed=True")


if __name__ == "__main__":
    run()
