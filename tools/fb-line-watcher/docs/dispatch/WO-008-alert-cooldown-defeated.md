# WO-008 巡邏結尾把自己剛發的截圖警報標成已解決，冷卻完全失效 → 每輪一則 LINE

- 提出：雲端深審席一 ／ 嚴重度：**P1** ／ 已由規劃席逐行確認

## 問題

`onCaptureFailure` 在巡邏中發 `target:<key>:capture` 警報（`target-worker.ts:260`）。
同一輪結尾 `target-worker.ts:405` 執行 `resolveAlertsByPrefix(db, 'target:<key>:')`，
把**自己這一輪剛發的警報**標成已解決。

下一輪 `recordAlert`（`repo.ts:479-482`）：
```ts
const cameBack = existing.resolved_at !== null;
notify = cameBack || cooled || existing.last_notified_at === null;
```
`cameBack` 為真 → **無視 60 分鐘冷卻直接再通知**。

其他 target 警報（NETWORK_ERROR／LOGIN_REQUIRED）不受影響，因為那些路徑在 `target-worker.ts:160/169` 就 return，
走不到第 405 行。**截圖警報是唯一「發完又走到結尾」的**。

後果：任何持續性截圖失敗 → 每輪一則 LINE WARN。預設 `poll_interval_seconds=180` → **每小時 20 則**。
`SYSTEM_ALERT` 在 `UNCOUNTED_KINDS` 內，不吃每日 150 額度，**完全沒有上限**。
與 WO-007 缺陷一（無限迴圈）疊加 = 永久每輪一則。

深審席重現：24 分鐘 8 輪 → `notify=true` 8 次（冷卻設定 60 分鐘，應只有 1 則）。

## 1. 標的檔案與函式

`src/worker/target-worker.ts:405`（`resolveAlertsByPrefix` 呼叫）、
`src/storage/repo.ts:499-505`（`resolveAlert` / `resolveAlertsByPrefix`）

## 2. 規格（逐條可驗）

1. 巡邏結尾**不得**解決本輪剛發出的警報。做法自選，擇一：
   (a) 收窄 prefix，只解決確實已恢復的類別（`network`、`LOGIN_REQUIRED`、`CHECKPOINT`、`PERMISSION_DENIED`、`extractor`），
       **不含** `capture`；或
   (b) `resolveAlertsByPrefix` 加上「只解決 `last_seen_at < 本輪開始時間` 的」條件。
   **建議 (a)** —— 語意更清楚：截圖警報要在**截圖成功**時才解決，不是在巡邏成功時。
2. 若採 (a)，截圖成功時要主動 `resolveAlert('target:<key>:capture')`，否則警報永遠掛著。
3. `resolveAlertsByPrefix` 的 60 分鐘冷卻在修正後必須真的生效。

## 3. 驗收（測試／突變）

1. 連續 8 輪截圖失敗（時鐘每輪推進 3 分鐘）→ LINE 上的 `capture` 警報**恰好 1 則**。
2. 時鐘推進超過 `system_alert_cooldown_minutes` 後再失敗 → 第 2 則。
3. 截圖恢復成功 → 警報被解決；之後再失敗 → 立即通知（`cameBack` 正確生效）。
4. NETWORK_ERROR／LOGIN_REQUIRED 的既有解決行為不變。

指令：`npm run typecheck && npm test`。
通過條件：全綠、項數 ≥ 148 + 新增；不得刪測試或放寬斷言。
突變：把第 405 行改回原本的寬 prefix → 測試 1 必須失敗。

## 4. 可寫路徑白名單

```
src/worker/target-worker.ts
src/storage/repo.ts
tests/integration/resilience.test.ts
tests/unit/notifier.test.ts
```

禁止：`src/detect/**`、`src/worker/scheduler.ts`、`src/line/notifier.ts` 的投遞邏輯、`.github/**`。
