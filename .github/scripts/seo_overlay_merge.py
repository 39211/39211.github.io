"""Preserve generated post surfaces while restoring SEO desk overrides.

Only the Python standard library is required (Python 3.12+ on Actions).
HTML and the override sitemap are edited as bytes, never reserialized.
"""

import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit
from xml.sax.saxutils import escape


GENERATED_OWNED = ("posts/", "rss.xml", "feed.json", "ai-sitemap.xml")
OPEN_MARKER = b"<!-- SXJ:RECENT_POSTS -->"
CLOSE_MARKER = b"<!-- /SXJ:RECENT_POSTS -->"
SITE_PREFIX = "https://sixiangjialaundry.com/"


def is_generated_owned(relative):
    """The constants describe root paths; similarly named nested desk files stay owned."""
    name = Path(relative).as_posix()
    return any(name == owned.rstrip("/") or
               (owned.endswith("/") and name.startswith(owned))
               for owned in GENERATED_OWNED)


def overlay_files(source):
    """Files copied by rsync and checked by cmp, with the same ownership exclusions."""
    source = Path(source)
    return sorted(path for path in source.rglob("*")
                  if path.is_file() and path.name != "README.md"
                  and not is_generated_owned(path.relative_to(source)))


def marker_parts(raw, label):
    opens, closes = raw.count(OPEN_MARKER), raw.count(CLOSE_MARKER)
    if opens != 1 or closes != 1:
        raise ValueError(f"{label}: expected one marker pair, found open={opens}, close={closes}")
    start = raw.index(OPEN_MARKER) + len(OPEN_MARKER)
    end = raw.index(CLOSE_MARKER)
    if end < start:
        raise ValueError(f"{label}: recent posts markers are reversed")
    return raw[:start], raw[start:end], raw[end:]


def homepage_result(main_raw, generated_raw):
    try:
        prefix, _, suffix = marker_parts(main_raw, "main homepage")
        _, generated_inside, _ = marker_parts(generated_raw, "generated homepage")
    except ValueError as exc:
        return main_raw, False, str(exc)
    merged = prefix + generated_inside + suffix
    return merged, True, ""


def read_sitemap(path):
    raw = Path(path).read_bytes()
    root = ET.fromstring(raw)
    if root.tag.split("}")[-1] != "urlset":
        raise ValueError(f"Expected sitemap urlset: {path}")
    entries = []
    for element in root:
        if element.tag.split("}")[-1] != "url":
            continue
        values = {child.tag.split("}")[-1]: child.text or "" for child in element}
        loc = values.get("loc", "").strip()
        if not loc:
            raise ValueError(f"Empty sitemap loc: {path}")
        entries.append((loc, values.get("lastmod")))
    return raw, entries


def sitemap_target(site_root, url):
    # Keep the original workflow's exact prefix and trailing-slash conversion.
    if not url.startswith(SITE_PREFIX):
        raise ValueError(f"Unexpected sitemap URL: {url}")
    relative = url[len(SITE_PREFIX):]
    if not relative or relative.endswith("/"):
        relative += "index.html"
    root = Path(site_root).resolve()
    target = root / relative
    if not target.resolve().is_relative_to(root):
        raise ValueError(f"Sitemap target escapes site root: {url}")
    return target


class RobotsParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.directives = set()

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attributes = dict(attrs)
        if (attributes.get("name") or "").lower() == "robots":
            self.directives.update(re.split(r"[\s,]+", (attributes.get("content") or "").lower()))


def post_is_indexable(path):
    if not path.is_file():
        return False
    parser = RobotsParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return "index" in parser.directives and "noindex" not in parser.directives


def merged_sitemap(site_root, generated_root):
    main_raw, main_entries = read_sitemap(Path(site_root) / "sitemap.xml")
    _, generated_entries = read_sitemap(Path(generated_root) / "sitemap.xml")
    seen = {loc for loc, _ in main_entries}
    additions = []
    for loc, lastmod in generated_entries:
        if not urlsplit(loc).path.startswith("/posts/"):
            continue
        if loc in seen:
            continue
        target = sitemap_target(site_root, loc)
        if not post_is_indexable(target):
            continue
        seen.add(loc)
        line = "  <url><loc>" + escape(loc) + "</loc>"
        if lastmod is not None:
            line += "<lastmod>" + escape(lastmod) + "</lastmod>"
        additions.append((line + "</url>\n").encode("utf-8"))
    closing = main_raw.rfind(b"</urlset>")
    if closing < 0:
        raise ValueError("Override sitemap has no closing </urlset>")
    merged = main_raw[:closing] + b"".join(additions) + main_raw[closing:]
    # Parse before writing: malformed inputs/results cannot reach the artifact.
    if ET.fromstring(merged).tag != ET.fromstring(main_raw).tag:
        raise ValueError("Sitemap namespace changed")
    return merged, len(additions)


def snapshot(site_root, out):
    # Read both first so a missing input cannot produce a partial snapshot.
    contents = {name: (Path(site_root) / name).read_bytes()
                for name in ("index.html", "sitemap.xml")}
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, raw in contents.items():
        (out / name).write_bytes(raw)
    print("::notice::generated homepage and sitemap snapshotted")


def merge(site_root, generated, override_src):
    site_root, generated = Path(site_root), Path(generated)
    # override_src is required at the CLI boundary; cmp has already established
    # that the site's current desk files are byte-identical to that source.
    main_raw = (site_root / "index.html").read_bytes()
    generated_raw = (generated / "index.html").read_bytes()
    homepage, mergeable, reason = homepage_result(main_raw, generated_raw)
    sitemap, added = merged_sitemap(site_root, generated)
    (site_root / "index.html").write_bytes(homepage)
    (site_root / "sitemap.xml").write_bytes(sitemap)
    if mergeable:
        print("::notice::homepage recent posts merged")
    else:
        print(f"::warning::homepage recent posts not merged: {reason}")
    print(f"::notice::sitemap appended {added} indexable generated post URLs")


def verify(site_root, override_src, generated):
    site_root, override_src, generated = Path(site_root), Path(override_src), Path(generated)
    _, source_entries = read_sitemap(override_src / "sitemap.xml")
    _, final_entries = read_sitemap(site_root / "sitemap.xml")
    source = {loc for loc, _ in source_entries}
    final = [loc for loc, _ in final_entries]
    missing = source - set(final)
    if missing:
        raise ValueError(f"Missing override sitemap URLs: {', '.join(sorted(missing))}")
    if len(final) != len(set(final)):
        raise ValueError("Duplicate sitemap URLs")
    for url in final:
        target = sitemap_target(site_root, url)
        if not target.is_file():
            raise ValueError(f"Missing sitemap target: {target.relative_to(site_root.resolve())}")
        if urlsplit(url).path.startswith("/posts/") and not post_is_indexable(target):
            raise ValueError(f"Post is not indexable: {url}")
    expected, mergeable, _ = homepage_result((override_src / "index.html").read_bytes(),
                                           (generated / "index.html").read_bytes())
    if (site_root / "index.html").read_bytes() != expected:
        state = "merged region or SEO desk bytes" if mergeable else "unchanged SEO desk fallback"
        raise ValueError(f"Homepage mismatch: {state}")
    print(f"::notice::Final SEO assertions: {len(final)} sitemap URLs; all five checks passed")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    snap = commands.add_parser("snapshot")
    snap.add_argument("--site-root", required=True, type=Path)
    snap.add_argument("--out", required=True, type=Path)
    for name in ("merge", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--site-root", required=True, type=Path)
        command.add_argument("--generated", required=True, type=Path)
        command.add_argument("--override-src", required=True, type=Path)
    commands.add_parser("excludes")
    args = parser.parse_args(argv)
    try:
        if args.command == "snapshot":
            snapshot(args.site_root, args.out)
        elif args.command == "merge":
            merge(args.site_root, args.generated, args.override_src)
        elif args.command == "verify":
            verify(args.site_root, args.override_src, args.generated)
        else:
            print("\n".join("/" + name for name in GENERATED_OWNED))
    except (OSError, ValueError, ET.ParseError) as exc:
        print(f"::error::{args.command} failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
