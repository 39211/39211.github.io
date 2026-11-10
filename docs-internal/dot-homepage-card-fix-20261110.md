# Homepage card correction by dot — 2026-11-10

## What was wrong
The live R10 homepage uses posts-data.js + r9-core.js, despite retaining the r6-post CSS class. Changing legacy r6.js or a generated index.html alone would not fix both refresh paths. Daily cards selected original multi-megabyte PNGs even though equivalent WebP files already exist.

Five PNG cards observed in the homepage total 12,573,072 repository bytes; their existing WebP counterparts total 770,654 bytes (93.87% less). This is an asset-size comparison, not a measured page-speed, SEO ranking, traffic or conversion improvement. The YouTube thumbnail is unchanged.

## Changes in this repository
- r10_homepage.py: homepage cards prefer an existing same-site daily slot WebP. Missing derivative, curated images, external images and query/hash URLs keep the original. Journals and source feeds retain original image URLs.
- homepage_content_dates.py + seo_overlay_merge.py: after restoring SEO overrides and inserting recent cards, synchronize only canonical homepage WebPage.dateModified and sitemap homepage lastmod. Use max(authored homepage date, dates actually included in the card region), never build time. Invalid/ambiguous inputs leave both dates unchanged with a diagnostic; verification checks the final date pair.
- Accept editorial_title for card/journal titles when present; preserve old title fallback.

## Verification
Base commit: 7d24d244fe5dae0f785967121449f6355bf7c63c.
python -m unittest discover -s .github/scripts -p 'test_*.py': 43 tests passed. Covers existing overlay fixtures, card refresh, missing derivative, journal/feed preservation, editorial titles, included/authored dates, graph/array JSON-LD, missing lastmod, invalid inputs and repeat-build stability, and full merge()/verify() orchestration with date-tampering rejection.

## Scope / handoff
Implemented and recorded by dot at the owner's request. This record describes the code defect and correction, not an attribution of blame to a prior author. This is a draft review branch only: no merge, deployment, IndexNow submission or publishing action was performed. The counterpart repository changes are needed to cover both interactive and no-JS paths. Existing WebP generation is not changed; new slots without derivatives still use original images. Browser visual/performance and production rollout verification have not been performed. Full laundry test/typecheck suite is left to exact-commit CI, not claimed as a local pass.
