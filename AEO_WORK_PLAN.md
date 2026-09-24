# AEO Top-15 强化工作計畫

## 目標
根據 aeo-question-map section 5 的 Top 15 問題，更新落地頁以提供：
- 40-60字直接答案（首段 answer-box）
- 搜尋者用語的 FAQ 項目
- FAQ JSON-LD 與可見文字一致
- dateModified 與 sitemap lastmod 同步
- 機器可讀檔案同步

## Top 15 問題與落地頁清單

| # | 問題 | 落地頁 | 現況 sitemap lastmod | JSON-LD dateModified | 行動 |
|---|------|--------|---------------------|---------------------|------|
| 1 | 勃肯鞋會臭嗎？（含拖鞋／口語變體） | birkenstock-care.html | 2026-08-29 | 2026-08-29 | ✓ 已有FAQ，檢查是否需補"勃肯會臭嗎"變體 |
| 2 | 東海洗衣店在哪？有沒有門市？ | donghai-laundry-pickup.html | 2026-08-29 | 2026-08-29 | ✓ PR#7已處理，檢查FAQ是否足夠 |
| 3 | 西屯／逢甲洗鞋怎麼約？ | qinghai-road-shoe-cleaning.html | 2026-08-18 | 2026-08-18 | ⚠ 需更新H1及answer-box，補"西屯洗鞋"FAQ |
| 4 | 精品包發霉怎麼辦？先別擦？ | luxury-bag-mold.html | 2026-08-23 | 2026-08-23 | ⚠ 檢查answer-box，補#14界線FAQ |
| 5 | 皮衣發霉找洗衣店？ | leather-jacket-care.html | 2026-09-20 | 2026-09-20 | ⚠ 補"皮衣發霉洗衣店"FAQ，補#14界線FAQ |
| 6 | 台中精品衣服怎麼送洗？ | luxury-dry-cleaning.html | 2026-09-20 | 2026-09-20 | ⚠ H1需補"衣服送洗"字面，補#14界線FAQ |
| 7 | 台中絨毛娃娃清洗店／洗娃娃店？ | plush-doll-cleaning.html | 2026-09-20 | 2026-09-20 | ⚠ 補"娃娃清洗店""洗娃娃店"FAQ變體 |
| 8 | 台中行李箱清洗服務？ | luggage-wheel-cleaning.html | 2026-09-20 | ? | ⚠ H1改"台中行李箱清洗服務"置前 |
| 9 | 台中洗地毯要注意什麼？ | carpet-cleaning.html | 2026-08-29 | ? | ⚠ 首屏answer-box補強 |
| 10 | 台中窗簾清洗怎麼送？ | curtain-cleaning.html | 2026-08-29 | ? | ⚠ answer-box更可摘 |
| 11 | 勃肯可以丟洗衣機嗎？ | washing-machine-shoe-risk.html + birkenstock FAQ | 2026-08-30 | ? | ⚠ 兩頁互鏈，勃肯FAQ補此問 |
| 12 | 東海厚被／窗簾可以收嗎？ | donghai + bedding/curtain | 已處理donghai | ? | ⚠ 首屏前置厚被窗簾 |
| 13 | 行李箱只清輪子可以嗎？ | luggage-wheel-cleaning.html | 2026-09-20 | ? | ⚠ 保留輪子FAQ，加"整箱vs只清輪子" |
| 14 | 發霉／精品能保證變全新嗎？（界線題） | luxury-bag-mold + leather-jacket + luxury-dry-cleaning | 各不同 | ? | ⚠ 三頁共用界線FAQ |
| 15 | 中科襯衫／公司件怎麼固定收？（探索） | zhongke-office-laundry.html | 2026-08-29 | ? | ⚠ 升"固定週期"小節 |

## 今日工作範圍（2026-09-24）

所有編輯頁面的 dateModified 更新為 2026-09-24
所有編輯頁面的 sitemap lastmod 更新為 2026-09-24

## 驗證檢查清單
- [ ] JSON-LD FAQ text === 可見FAQ text（逐頁）
- [ ] 無新增"東海門市"宣稱
- [ ] guarantee詞僅出現於否定句
- [ ] 所有內鏈href指向repo實際檔案
- [ ] JSON檔案可parse

## Cross-page answer graph (section 4)
補充站內鏈：
- birkenstock ↔ washing-machine-shoe-risk
- luxury-bag-mold ↔ leather-jacket-care ↔ luxury-dry-cleaning
- donghai → bedding/curtain/carpet
- qinghai-road → birkenstock/fengjia
