# WO-010 發布中途失敗留下永久孤兒物件，繞過保存期承諾

- 提出：雲端深審席三 ／ 嚴重度：**P2**（但對私密社團截圖有隱私意涵） ／ 深審席已重現兩種

## 問題

`src/publish/local-http.ts:130-131`、`src/publish/s3.ts:53-54` 都是「連續寫兩個物件」而非原子操作。
第二個失敗時第一個已送出，`publish()` 丟例外 → `notifier.ts:279` 接住 → 重試，
`recordPublished` **從未執行** → `published_images` 沒有紀錄 → `cleanupExpiredImages` 永遠看不到它。
而 `runMaintenance` 只用 mtime 掃 `captures` 與 `logs`，**完全沒有掃 `data/public` 或 bucket**。

深審席重現：
- S3 第二個 PutObject 丟 `InternalError` → bucket 留下 `fb-line-watcher/2026/09/98267d69….jpg`，無 DB 紀錄。
- local_http 第二次 `writeFile` 丟 `ENOSPC` → `data/public/` 留下 `c14702c9….jpg`，無 DB 紀錄。

每次重試用新 token 重新發布，預設重試表 `[5,30,120,600,1800]` → 單一事件最多洩漏 5 組孤兒。

**影響不只是垃圾累積**：local_http 的孤兒檔案透過 tunnel 仍可公開存取，且**永遠不會過期**，
等於私密社團截圖的 `retention_hours` 承諾被繞過。

次要變體：`notifier.ts:276-277`，`updateDelivery` 成功後 `recordPublished` 若丟例外，
下一輪會沿用已存 URL 送出成功，但那兩個物件永遠不會被清掉。

## 1. 標的檔案與函式

`src/publish/local-http.ts` `publish()`、`src/publish/s3.ts` `publish()`、
`src/publish/publisher.ts` `recordPublished`、`src/worker/scheduler.ts` `runMaintenance`／`cleanupExpiredImages`

## 2. 規格（逐條可驗）

1. `publish()` 必須「要嘛兩個物件都成功、要嘛一個都不留」：第二個失敗時，**主動刪掉第一個**再丟例外。
   刪除失敗只記 warn，不得掩蓋原始例外。
2. 先寫 `published_images` 紀錄再發布（或發布後立刻在同一交易內記錄），
   使任何已存在的物件都一定有對應紀錄可供清理。實作者可提方案，但必須關掉「有物件、無紀錄」這個窗口。
3. `runMaintenance` 增加一道掃描：`data/public` 內超過 `retention_hours` 且不在 `published_images` 內的檔案一律刪除。
   S3 側同樣以 prefix 列舉比對（若成本考量不做，要在文件寫明並提供手動清理指令）。
4. 不得改動 `retention_hours` 預設值或既有的清理排程時點。

## 3. 驗收（測試／突變）

1. 注入「第二個物件寫入失敗」→ `data/public` 內**不得**留下任何檔案。
2. 同上，S3 版本 → 用假 S3 client 斷言第一個物件收到 DeleteObject。
3. 預先放一個不在 `published_images` 內的舊檔 → 跑 `runMaintenance` → 被刪除。
4. 正常發布路徑行為不變，`tests/integration/publisher.test.ts` 既有 2 條全過。

指令：`npm run typecheck && npm test`。不得刪測試或放寬斷言。
突變：拿掉第 1 條的補償刪除 → 測試 1 必須失敗。

## 4. 可寫路徑白名單

```
src/publish/local-http.ts
src/publish/s3.ts
src/publish/publisher.ts
src/worker/scheduler.ts
tests/integration/publisher.test.ts
tests/unit/local-http.test.ts
```

禁止：`src/detect/**`、`src/worker/target-worker.ts`、`src/line/**`、`.github/**`。
