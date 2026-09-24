# AEO Top-15 Implementation Tracker

## Ship Date: 2026-09-24

## Status by Question

| # | Question | Page | Status | Notes |
|---|----------|------|--------|-------|
| 1 | 勃肯鞋會臭嗎？ | birkenstock-care | ✓ DONE (PR#7) | Has FAQ, answer-box OK |
| 2 | 東海洗衣店在哪？ | donghai-laundry-pickup | ⚠ NEEDS dateModified fix | FAQ OK, needs dateModified 2026-09-24 (currently 08-29, lastmod 08-29) |
| 3 | 西屯／逢甲洗鞋 | qinghai-road-shoe-cleaning | ⚠ NEEDS WORK | H1 needs update, add answer-box, dateModified 2026-09-24 |
| 4 | 精品包發霉 | luxury-bag-mold | ⚠ NEEDS #14 FAQ | Add boundary FAQ, dateModified 2026-09-24 |
| 5 | 皮衣發霉 | leather-jacket-care | ⚠ NEEDS #14 FAQ | Add boundary FAQ, dateModified 2026-09-24 |
| 6 | 精品衣服送洗 | luxury-dry-cleaning | ⚠ NEEDS #14 FAQ | Add boundary FAQ, dateModified 2026-09-24 |
| 7 | 絨毛娃娃清洗店 | plush-doll-cleaning | ✓ DONE (PR#7) | Has FAQ, dateModified 2026-09-20 |
| 8 | 行李箱清洗服務 | luggage-wheel-cleaning | ⚠ NEEDS WORK | H1 needs update, dateModified 2026-09-24 |
| 9 | 洗地毯 | carpet-cleaning | ⚠ NEEDS WORK | Answer-box enhancement, dateModified 2026-09-24 |
| 10 | 窗簾清洗 | curtain-cleaning | ⚠ NEEDS WORK | Answer-box enhancement, dateModified 2026-09-24 |
| 11 | 勃肯洗衣機 | washing-machine + birkenstock | ⚠ NEEDS CROSS-LINK | Add mutual links |
| 12 | 東海厚被窗簾 | donghai + bedding/curtain | ⚠ COVERED | donghai already mentions these |
| 13 | 行李箱只清輪子 | luggage-wheel-cleaning | ⚠ NEEDS FAQ | Add FAQ about partial service |
| 14 | 發霉精品界線 | 3 pages共用 | ⚠ NEEDS WORK | Add consistent boundary FAQ to luxury-bag-mold, leather-jacket-care, luxury-dry-cleaning |
| 15 | 中科固定收 | zhongke-office-laundry | ⚠ NEEDS WORK | Add fixed-cycle section, dateModified 2026-09-24 |

## Freshness Tasks
- [ ] Sync donghai dateModified from 2026-08-29 to match sitemap (should be 2026-09-24)
- [ ] For all edited pages today: set dateModified to 2026-09-24
- [ ] For all edited pages today: update sitemap lastmod to 2026-09-24

## Machine-Readable Files to Sync
- [ ] answers.json
- [ ] llms.txt
- [ ] llms-lite.txt
- [ ] llms.jsonl
- [ ] .well-known/llms.txt
- [ ] .well-known/ai.json
- [ ] ai-discovery.json  
- [ ] services.json
- [ ] knowledge-graph.json

## Cross-Page Links (Section 4)
- [ ] birkenstock ↔ washing-machine-shoe-risk
- [ ] luxury-bag-mold ↔ leather-jacket-care ↔ luxury-dry-cleaning

## Verification Checklist
- [ ] JSON-LD FAQ === visible FAQ for all edited pages
- [ ] No new 東海門市 claims
- [ ] Guarantee words only in negated sentences
- [ ] All internal links resolve
- [ ] JSON files parse correctly
