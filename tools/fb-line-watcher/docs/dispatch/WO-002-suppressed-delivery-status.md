# WO-002 預算抑制被寫成 DEAD_LETTER，同一件事三個地方三種說法

- 提出：雲端規劃／深審席
- 日期：2026-09-04
- 嚴重度：P1（狀態模型缺口。會讓監控在兩個方向上說謊）
- 相依：**在 WO-001 之後做**（兩張都動 `scripts/soak.ts`）
- 注意：這張**只做「正名」，不改任何投遞行為**。要不要在隔天補送是 WO-003 的範圍，不要在這張裡順手做。

## 問題

`src/line/notifier.ts:246-258` 的每日預算分支，對同一件事寫了三種說法：

```
248  setEventStatus(deps.db, event.event_key, 'SUPPRESSED')   // event 說「抑制」
249  updateDelivery(deps.db, d.id, { status: 'DEAD_LETTER' }) // delivery 說「投遞失敗」
250  stats.suppressed++                                        // 記憶體統計說「抑制」
```

根因：`src/storage/repo.ts:18` 的 `DeliveryStatus` 只有 `'PENDING' | 'SENT' | 'FAILED_RETRYABLE' | 'DEAD_LETTER'`，**沒有可以表達「刻意抑制」的狀態**，只好借用 `DEAD_LETTER`。

後果（兩個方向都會說謊）：

- 誤報：預算抑制是刻意的正常行為，卻讓「零 dead letter」這類 gate 失敗。
- 漏報：**真正的投遞失敗會被藏在一堆預算抑制裡數不出來。** 這條比誤報嚴重。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `src/storage/repo.ts` | `DeliveryStatus` 型別（第 18 行）；`listDueDeliveries`（第 398 行起）的 `status IN (...)` |
| `src/line/notifier.ts` | 預算分支（第 246–258 行）；`DeliveryStats` 介面（第 41 行起） |
| `src/storage/db.ts` | 新增 migration v5（目前最新為 v4） |
| `scripts/soak.ts` | gate「零 dead letter」的 SQL 與 `report` 欄位 |
| `tests/unit/notifier.test.ts` | 新增回歸測試 |

## 2. 規格（逐條可驗）

1. `DeliveryStatus` 增加 `'SUPPRESSED'`，成為 `'PENDING' | 'SENT' | 'FAILED_RETRYABLE' | 'DEAD_LETTER' | 'SUPPRESSED'`。
2. `src/line/notifier.ts` 預算分支的 `updateDelivery` 改寫 `status: 'SUPPRESSED'`。`last_error` 維持原字串 `'daily notification budget exceeded'` 不變（下游與 migration 靠它辨識）。
3. `setEventStatus(..., 'SUPPRESSED')` 與 `stats.suppressed++` 維持不變。三個地方在這張工單後必須一致。
4. `listDueDeliveries` 的 `status IN ('PENDING', 'FAILED_RETRYABLE')` **維持不變**。`SUPPRESSED` 不重試 —— 行為與現在完全相同，這張只是正名。
5. `deliveries.status` 是無 CHECK 限制的 TEXT 欄位，新值不需要改表結構。但要新增 **migration v5** 回填歷史資料：
   ```sql
   UPDATE deliveries SET status = 'SUPPRESSED'
   WHERE status = 'DEAD_LETTER' AND last_error = 'daily notification budget exceeded';
   ```
   必須冪等（重跑無副作用）。
6. `scripts/soak.ts` 的 gate 拆成兩條，兩條都必須存在：
   - `零 dead letter`：`SELECT COUNT(*) FROM deliveries WHERE status = 'DEAD_LETTER'`，門檻 `= 0`
   - `預算抑制筆數`：`SELECT COUNT(*) FROM deliveries WHERE status = 'SUPPRESSED'`，**只回報數字，不設門檻、不影響 PASS/FAIL**
   `report` 物件同步加上 `suppressed` 欄位。
7. 「event 與 delivery 一致」這條 gate 改成把抑制算進去：`events === deliveries && deliveries === sent + suppressed`。
8. 不得改動每日預算的判定邏輯、`max_notifications_per_day` 的預設值、或 `raiseAlert` 的訊息內容。

## 3. 驗收（測試／突變）

**新增回歸測試**（`tests/unit/notifier.test.ts`），至少三條：

1. 預算未達上限 → delivery 為 `SENT`，`getBudgetCount` 遞增。
2. 預算達上限 → **delivery 為 `SUPPRESSED`（不是 `DEAD_LETTER`）**，event 為 `SUPPRESSED`，`stats.suppressed` 遞增、`stats.dead` **不變**。
3. 預算達上限時，`SYSTEM_ALERT` 等 `UNCOUNTED_KINDS` 仍然送得出去（維持既有行為）。

**migration v5 測試**（`tests/unit/` 內自選檔案）：建一個含舊格式資料列的 DB，跑 migration，驗證只有 `last_error` 相符的列被改名，其他 `DEAD_LETTER` 原封不動；重跑 migration 結果相同。

**驗收指令**

```
npm run typecheck
npm test
npm run soak -- --minutes 2 --json /tmp/wo002.json
```

**通過條件**

1. `npm test` 全綠，且**項數 ≥ 148 + 你新增的條數**。不得刪測試、不得放寬既有斷言。
2. 壓測 gate 全 PASS，`/tmp/wo002.json` 同時有 `dead: 0` 與 `suppressed` 兩個欄位。
3. `npm run typecheck` 無錯。

**突變驗證（證明新測試真的抓得到）**

把第 249 行改回 `status: 'DEAD_LETTER'`，上面第 2 條測試必須失敗。確認後改回 `'SUPPRESSED'`。

## 4. 可寫路徑白名單

```
src/storage/repo.ts
src/storage/db.ts
src/line/notifier.ts
scripts/soak.ts
tests/unit/notifier.test.ts
tests/unit/*.test.ts        # 只允許新增 migration v5 的測試
```

以上之外一律唯讀。特別禁止：`src/detect/**`、`src/worker/**`、`src/capture/**`、`.github/**`、`tests/integration/**`。
