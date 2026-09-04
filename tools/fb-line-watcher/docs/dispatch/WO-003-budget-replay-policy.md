# WO-003 每日預算用完之後，內容永久消失

> **狀態：BLOCKED — 等使用者拍板產品決定。在決定前不要派工實作。**
> 本文第 2 節的規格是「建議方案（甲）」的完整寫法，拍板後即可直接派；
> 若使用者選乙／丙／丁，第 2 節整段作廢，退回重寫。

- 提出：雲端規劃／深審席
- 日期：2026-09-04
- 嚴重度：**P1，若目標社團夠熱鬧則為 P0**
- 相依：**在 WO-002 之後做**（需要 `SUPPRESSED` 這個 delivery 狀態）

## 問題

`src/line/notifier.ts:248` 是整個 codebase 裡**唯一**寫入 `EventStatus = 'SUPPRESSED'` 的地方。
`src/worker/scheduler.ts`、`src/line/notifier.ts` 或任何其他檔案，**都沒有再把它讀回來過**。

也就是說：

> 每日通知數一達到 `max_notifications_per_day`（預設 150），
> 當天之後的所有內容事件**永久消失**。不會隔天補送、不會出摘要，
> 只有一則 24 小時冷卻的系統警報。

`notification_budget` 表隔天歸零，但**今天被抑制的事件永遠不會被重新考慮**。

這與獨立驗證判為 HIGH 的 P0-3 是同一類缺陷 —— **內容進入不可重播的 terminal 狀態** ——
差別只在觸發條件是計數器而不是截圖失敗。P0-3 已修，這條還在。

對照原始需求：「只要群主說話就要收到」。目前的行為無法保證這件事。

## 決定點（需使用者拍板）

| 方案 | 行為 | 代價 |
| --- | --- | --- |
| **甲（建議）** | `notify_authors` 命中者不受預算限制，永遠送；其餘超額者隔天出一則摘要 | 實作最複雜；但直接對上原始需求 |
| 乙 | 全部超額者隔天補送 | 隔天可能一次湧入數百則，且會排擠隔天的額度 |
| 丙 | 維持丟棄，但每天出一則「今天有 N 則沒送」摘要 | 最簡單；群主的話仍可能被丟 |
| 丁 | 只調高預設值並在文件寫清楚 | 治標。額度一樣會有用完的一天 |

**深審席建議：甲。** 理由：預算的目的是保護 LINE 免費額度，
但「群主說了什麼」正是這套系統存在的唯一理由，不該和路人的留言競爭同一個額度。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `src/line/notifier.ts` | 預算分支（第 246–258 行）、`processDeliveries` |
| `src/config/schema.ts` | 新增 `budget_exempt_notify_authors`、`daily_suppressed_digest` |
| `src/storage/repo.ts` | 查詢昨日 `SUPPRESSED` 事件用的函式 |
| `src/worker/scheduler.ts` | 每日摘要的觸發點（參考既有的 `HEALTH_SUMMARY` 排程） |
| `src/events.ts` | 新增 `SUPPRESSED_DIGEST` 事件型別 |
| `config/targets.example.yaml`、`README.zh-TW.md` | 設定說明 |

## 2. 規格（方案甲；未拍板前不生效）

1. 新增設定 `budget_exempt_notify_authors: boolean`，預設 **`true`**。
2. 預算分支加一個前置判定：當 `budget_exempt_notify_authors` 為真，且該事件的作者命中所屬 target 的 `notify_authors` 規則（沿用 `src/util/text.ts` 的 `matchesAuthorRule`，含 `/正則/` 語法）時，**跳過預算檢查直接送出**，但仍照常計入 `notification_budget`（額度要誠實反映實際用量）。
3. `notify_authors` 為空的 target 視為「沒有指定群主」，不適用豁免 —— 否則等於整個預算失效。
4. 新增設定 `daily_suppressed_digest: boolean`，預設 **`true`**。為真時，每天固定時間（沿用既有 `HEALTH_SUMMARY` 的排程時點）掃描前一天 `status = 'SUPPRESSED'` 的事件，若有則發一則 `SUPPRESSED_DIGEST`：
   - 內容含：被抑制的則數、依 target 分組的計數、最早與最晚的時間、以及「完整內容留在本機 captures」的說明。
   - 摘要本身列入 `UNCOUNTED_KINDS`，不佔額度。
   - 發出後把那些事件標記為已納入摘要，**同一批不得在隔天重複出現在摘要裡**（新增欄位或新表皆可，但必須可重播安全 —— 摘要送出失敗時不可讓事件變成再也不會被摘要到）。
5. 摘要**不重送原始內容**。方案甲的立場是：群主的話靠豁免保證送達，其餘只給數量交代。
6. 不得改動 `max_notifications_per_day` 的預設值 150。

## 3. 驗收（測試／突變）

**新增回歸測試**，至少六條：

1. 預算已滿 + 事件作者命中 `notify_authors` → **送出**，且 budget 計數遞增。
2. 預算已滿 + 事件作者未命中 → `SUPPRESSED`。
3. 預算已滿 + target 的 `notify_authors` 為空 → `SUPPRESSED`（豁免不生效）。
4. `budget_exempt_notify_authors: false` → 命中者也被抑制（回到舊行為）。
5. 前一天有 N 則 `SUPPRESSED` → 摘要事件送出一次，內容含 N 與分組計數；**再跑一次排程不得重複送**。
6. 摘要送出失敗（注入 LINE 500 直到重試耗盡）→ 那批事件**下一輪仍會被納入摘要**，不得永久遺失。

**驗收指令**

```
npm run typecheck
npm test
npm run soak -- --minutes 2 --json /tmp/wo003.json
```

**通過條件**

1. `npm test` 全綠，項數 ≥ 前一張工單完成後的基準 + 6。不得刪測試、不得放寬既有斷言。
2. 壓測 gate 全 PASS。
3. `config/targets.example.yaml` 與 `README.zh-TW.md` 有新設定的說明，且說明與實際行為一致。

**突變驗證**

- 拿掉第 2 條的豁免判定 → 測試 1 必須失敗。
- 拿掉第 4 條的「已納入摘要」標記 → 測試 5 的「不得重複送」必須失敗。

## 4. 可寫路徑白名單

```
src/line/notifier.ts
src/config/schema.ts
src/storage/repo.ts
src/storage/db.ts
src/worker/scheduler.ts
src/events.ts
config/targets.example.yaml
README.zh-TW.md
tests/unit/notifier.test.ts
tests/integration/*.test.ts
```

以上之外一律唯讀。特別禁止：`src/detect/**`、`src/capture/**`、`src/adapters/**`、`src/publish/**`、`.github/**`。
