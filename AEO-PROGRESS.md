# AEO Top-15 Implementation Progress

## Completed ✅

### Question #2: 東海洗衣店 (donghai-laundry-pickup)
- ✅ Updated dateModified from 2026-08-29 to 2026-09-24
- ✅ Updated sitemap lastmod to 2026-09-24
- ✅ FAQ already OK from PR#7

### Question #14: 發霉／精品界線 (3 pages)
- ✅ luxury-dry-cleaning: Added boundary FAQ "精品衣服能洗回全新嗎？"
- ✅ Updated JSON-LD FAQPage with new FAQ
- ✅ Updated dateModified to 2026-09-24
- ✅ Updated sitemap lastmod to 2026-09-24
- ✅ luxury-bag-mold: Already has boundary FAQ "發霉的包可以完全恢復嗎？" ✓
- ✅ leather-jacket-care: Already has boundary FAQ "皮衣發霉還有救嗎？" ✓

## Already OK from PR#7 ✅
- Question #1: birkenstock-care (勃肯鞋會臭嗎)
- Question #7: plush-doll-cleaning (絨毛娃娃清洗店)

## Remaining Work 🔄

### High Priority Pages Need Content Updates:

#### Q#3: qinghai-road-shoe-cleaning (西屯／逢甲洗鞋)
- [ ] Update H1 from "青海路洗鞋店怎麼挑" to more service-focused 
- [ ] Enhance answer-box with 40-60 char direct answer
- [ ] Ensure FAQ has "西屯洗鞋" or "逢甲洗鞋" variant
- [ ] Update dateModified to 2026-09-24
- [ ] Update sitemap lastmod

#### Q#8: luggage-wheel-cleaning (行李箱清洗服務)
- [ ] Update H1 to lead with "台中行李箱清洗服務"
- [ ] Enhance answer-box
- [ ] Update dateModified to 2026-09-24
- [ ] Update sitemap lastmod

#### Q#9: carpet-cleaning (洗地毯)
- [ ] Strengthen answer-box (材質＋潮濕判斷)
- [ ] Update dateModified to 2026-09-24
- [ ] Update sitemap lastmod

#### Q#10: curtain-cleaning (窗簾清洗)
- [ ] Make answer-box more extractable (尺寸／軌道)
- [ ] Update dateModified to 2026-09-24  
- [ ] Update sitemap lastmod

#### Q#13: luggage-wheel-cleaning (行李箱只清輪子)
- [ ] Add FAQ about partial service: "只清輪子、不清箱面可以嗎？"
- [ ] Update JSON-LD FAQ

#### Q#15: zhongke-office-laundry (中科固定收)
- [ ] Add section about fixed-cycle pickup
- [ ] Update dateModified to 2026-09-24
- [ ] Update sitemap lastmod

### Q#11: Cross-Links (birkenstock ↔ washing-machine-shoe-risk)
- [ ] Add link from birkenstock-care FAQ to washing-machine-shoe-risk
- [ ] Add link from washing-machine-shoe-risk to birkenstock-care
- [ ] Update dateModified for both if edited

### Q#12: 東海厚被窗簾
- ✅ Already covered - donghai page already mentions bedding, curtain prominently

### Machine-Readable Files
- [ ] Update answers.json
- [ ] Update llms.txt
- [ ] Update llms-lite.txt  
- [ ] Update llms.jsonl
- [ ] Update .well-known/llms.txt
- [ ] Update .well-known/ai.json
- [ ] Update ai-discovery.json
- [ ] Update services.json
- [ ] Update knowledge-graph.json

### Verification
- [ ] Script-check: JSON-LD FAQ === visible FAQ for all edited pages
- [ ] Grep: no new 東海門市 claims
- [ ] Grep: guarantee words only in negated sentences
- [ ] Verify all internal links resolve
- [ ] Verify JSON files parse

## Next Steps

Continue implementing remaining pages systematically, then sync all machine-readable files, then run verification checks before opening PR.
