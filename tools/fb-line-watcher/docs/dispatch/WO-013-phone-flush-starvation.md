# WO-013 手機通知 debounce 沒有最長等待上限，持續有通知就永遠不送；累積過量後再也送不出去

- 提出：雲端深審席二 ／ 嚴重度：**P1 + P2（兩者串成一條鏈）** ／ 深審席已重現

## 缺陷一（P1）：debounce 是會被重設的靜默期，沒有上限

`src/worker/scheduler.ts:76-77`

```ts
const newest = Math.max(...rows.map((r) => Date.parse(r.received_at)));
if (!opts.force && cfg.debounce_seconds > 0 && now.getTime() - newest < cfg.debounce_seconds * 1000) return 0;
```

`newest` 隨每一則新通知往前推。只要**通知到達間隔小於 `debounce_seconds`**，這個 gate 就永遠不放行，
batch 無限累積。全 `src/` 沒有任何 `force: true` 的呼叫端（只有 `scheduler.ts:269` 與 `:309` 兩處
`flushPhoneNotifications(app)`），**沒有逃生口**。

深審席重現（`debounce_seconds = 45` 預設，每 40 秒一則）：
```
after notification #1  (t+40s):   flushed=0  pending=1
after notification #25 (t+1000s): flushed=0  pending=25
--> 20 分鐘的流量，送出的 LINE 訊息數：0
```

使用者看到的是「**手機一直響、LINE 完全沒動靜**」，而 `/health`、日誌、統計全部正常。
熱門社團活動期間，或使用者把 `debounce_seconds` 調到 300，都會踩到。

## 缺陷二（P2）：超過 32766 列後永久卡死，與缺陷一直接串接

`src/worker/scheduler.ts:112-113`

flush 的 `IN (?, ?, …)` 每列一個佔位符。SQLite 上限 32766。

```
 32766 pending -> flushed=32766  remaining=0
 32767 pending -> THROWS: too many SQL variables   remaining=32767（永久卡住）
```

throw 發生在 `app.db.transaction` 內 → rollback → 那些列還是 `batched = 0`
→ 下一輪 flush 重跑同一句、再次失敗，**無限循環**。
缺陷一負責把列數堆上去，缺陷二讓它再也回不來。

順帶：`Db.stmt()` 以 SQL 字串為 key 快取 prepared statement，這句 SQL 每種列數都是新字串，
會在快取裡各留一份（記憶體緩慢累積）。

## 1. 標的檔案與函式

`src/worker/scheduler.ts`（`flushPhoneNotifications`，第 60–130 行）、
`src/config/schema.ts`（`PhoneIngestSchema`，若新增上限設定）

## 2. 規格（逐條可驗）

1. debounce 加**最長等待上限**：即使一直有新通知進來，最舊的一則等超過上限就必須送出。
   建議新增設定 `max_hold_seconds`，預設 `debounce_seconds * 4`（或一個明確的秒數，例如 300）。
   判定改成：`now - newest < debounce` **且** `now - oldest < max_hold` 才繼續等。
2. 每次 flush 的列數加上硬上限（建議 500，遠低於 32766），一次處理一批；
   還有剩就下一輪繼續，不得因為列數多就整批失敗。
3. `IN (…)` 的佔位符數量必須有界。批次上限要以常數表示，不得依 pending 列數動態展開到無上限。
4. 兩者修好後，缺陷二的「永久卡死」必須不可能發生：即使 DB 裡有 10 萬列待送，
   也必須能靠連續多輪 flush 全部清空。
5. `max_items_per_message` 的既有截斷行為（超出的只記 `omittedCount`）不變。

## 3. 驗收（測試／突變）

1. `debounce_seconds = 45`，每 40 秒餵一則、連續 30 則 → **必須在 `max_hold_seconds` 到達時送出**，
   不得 20 分鐘 0 則。
2. 一次塞 40000 列 pending → 連續呼叫 `flushPhoneNotifications` 直到回 0 →
   **全部送完、`batched = 0` 的殘留為 0**，過程中不得丟例外。
3. 一次塞 33000 列 → 不得出現 `too many SQL variables`。
4. 既有的 `tests/integration/phone-ingest.test.ts` 8 條全過（含合併與重啟持久化）。

**驗收指令**：`npm run typecheck && npm test`
**通過條件**：全綠、項數 ≥ 148 + 新增；不得刪測試或放寬斷言。
**突變**：拿掉第 2 條的批次上限 → 測試 3 必須失敗。

## 4. 可寫路徑白名單

```
src/worker/scheduler.ts
src/config/schema.ts
config/targets.example.yaml
PHONE_INGEST.md
tests/integration/phone-ingest.test.ts
tests/unit/phone-ingest.test.ts
```

禁止：`src/detect/**`、`src/worker/target-worker.ts`、`src/line/**`、`.github/**`。
