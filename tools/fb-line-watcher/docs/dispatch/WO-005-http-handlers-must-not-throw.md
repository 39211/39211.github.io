# WO-005 觸發與手機接收伺服器：一個未驗證的畸形 request 就能結束整個 watcher

- 提出：雲端深審席三（HTTP／MIME／設定）
- 日期：2026-09-04
- 嚴重度：**P0**
- 驗證狀態：**已由規劃席獨立重現**（見下方輸出）

## 問題

上一輪修 P0-1 時，只加固了 `src/publish/local-http.ts` **一個檔案**。另外兩個 HTTP 伺服器有一模一樣的缺陷，而且**預設對區網開放**：

| 伺服器 | 檔案:行 | `bind` 預設 | 狀態 |
| --- | --- | --- | --- |
| 圖片伺服器 | `src/publish/local-http.ts` | `127.0.0.1`（`schema.ts:48`） | 上一輪已修 |
| **觸發伺服器** | `src/worker/trigger-server.ts:85` | **`0.0.0.0`**（`schema.ts:84`） | **未修** |
| **手機接收伺服器** | `src/worker/phone-ingest.ts:220` | **`0.0.0.0`**（`schema.ts:99`） | **未修** |

兩處都是 request callback 的**第一行**，裸的 `new URL(req.url ?? '/', 'http://…')`，
沒有 try/catch，且在 method 檢查與 **token 檢查之前** —— 因此**不需要 token**。

```ts
// trigger-server.ts:85
const url = new URL(httpReq.url ?? '/', 'http://trigger.local');
// phone-ingest.ts:220
const url = new URL(req.url ?? '/', 'http://phone.local');
```

全庫沒有任何 `process.on('uncaughtException')` 兜底（`src/cli.ts` 只處理 SIGINT／SIGTERM）。

**規劃席的重現輸出**（真實 `startTriggerServer`，raw TCP）：

```
new URL("//[")        -> THROWS TypeError: Invalid URL
new URL("//]")        -> THROWS TypeError: Invalid URL
new URL("//[::1")     -> THROWS TypeError: Invalid URL
new URL("//a%ZZ")     -> THROWS TypeError: Invalid URL
new URL("/\\")        -> THROWS TypeError: Invalid URL
new URL("/%E0%A4%A")  -> OK          ← 上一輪的 payload 在這裡「不會」觸發

TypeError: Invalid URL
    at Server.<anonymous> (src/worker/trigger-server.ts:85:17)
    at parserOnIncoming (node:_http_server:1186:12)
>>> EXIT CODE = 1
```

**注意**：舊的 payload `/%E0%A4%A` 在這裡不會觸發，這是另一類畸形。照抄 WO 之前那批測試抓不到。

**補充向量（深審席二回報，規劃席已驗證）**：Node 的 HTTP parser 接受 **absolute-form** request target
並原樣放進 `req.url`，所以下面這條同樣會炸，而且更像真實世界的 proxy 流量：

```
GET http://[ HTTP/1.1        -> new URL('http://[', base) THROWS -> exit 1
```

回歸測試**兩種都要測**：origin-form（`//[`）與 absolute-form（`http://[`）。

> 深審席二認為本工單原先引用的向量是 `/%E0%A4%A`，這是誤讀 —— 本文件第 38 與 46 行一開始就
> 明寫該 payload **不會**觸發。原始向量 `//[` 經規劃席以真實伺服器重現無誤。此註記僅為存證，
> 不影響規格；`http://[` 是有價值的新增。

一句話：`GET //[ HTTP/1.1` 送到區網上的觸發埠，watcher（瀏覽器 context、排程、LINE 補送佇列）全部結束。

## 附帶：同一結構的第二個洞（P1）

`src/worker/phone-ingest.ts:145`（`db.get`）、`:178`（`db.run` INSERT）、`:191`（`onAccepted`）
由 `end` handler（`:250-276`）呼叫。寫檔部分有 try/catch（`:163-175`），**DB 存取與 callback 沒有**。
磁碟寫滿（SQLITE_FULL）、IO error 或 DB 損毀時，一則合法通知就讓 watcher 死掉。
深審席已用注入 `SQLITE_BUSY` 的 `db.run` 重現，exit 1。
`trigger-server.ts:80` 的 `opts.onTrigger(req)` 同樣裸露在 `end` handler 內（目前實作風險低，但結構相同）。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `src/worker/trigger-server.ts` | `http.createServer` callback（第 84 行起）、`end` handler 內的 `opts.onTrigger` |
| `src/worker/phone-ingest.ts` | `http.createServer` callback（第 219 行起）、`end` handler（第 250–276 行）、`ingestNotification` 的 DB 區段 |
| `src/publish/local-http.ts` | **唯讀參考**，`safeDecodeRequestName` 是既有的正確作法 |

## 2. 規格（逐條可驗）

1. 建立一個共用的安全解析函式（放在 `src/util/` 下新檔或既有工具檔），行為：輸入 raw request target，回傳 `{ pathname, searchParams }` 或 `null`；內部 `new URL` 包 try/catch，任何例外一律回 `null`。**不得**沿用 `local-http.ts` 的 `safeDecodeRequestName`（那支只回檔名字串，語意不同）。
2. `trigger-server.ts` 與 `phone-ingest.ts` 改用該函式。解析失敗一律回 **400** `bad request`，且**在 token 檢查之前**就回，不得洩漏任何伺服器狀態。
3. 兩個 callback 的**整個函式體**包 try/catch，比照 `local-http.ts:59`。catch 內記 warn，若 header 未送出回 500，否則 `res.destroy()`。**例外絕對不得逸出 callback。**
4. 兩個 `end` handler 的整段（含 `ingestNotification`、`opts.onTrigger`）同樣包 try/catch，語意同上。DB 失敗必須是「記一筆 warn、回 500、程序繼續」，不是程序結束。
5. 兩個伺服器都加上 `server.on('clientError', …)`，比照 `local-http.ts:106-109`。
6. 在 `src/cli.ts` 的 watcher 啟動路徑加上 `process.on('uncaughtException')` 與 `process.on('unhandledRejection')` 兜底：記 error 級日誌 + 發系統警報，**不得**靜默吞掉，也**不得**在此之後照常運作 —— 這是最後一道網，不是藉口。行為由實作者提案，但必須留下可稽核的紀錄。
7. **不得**改動 `bind` 的預設值。把預設從 `0.0.0.0` 改成 `127.0.0.1` 會讓手機連不上，那是功能而非缺陷。

## 3. 驗收（測試／突變）

**新增回歸測試**（`tests/unit/trigger.test.ts`、`tests/unit/phone-ingest.test.ts`），每個伺服器至少：

1. 對 `//[`、`//]`、`//[::1`、`//a%ZZ`、`/\`、**`http://[`** 六種 raw target 各送一次 → **全部回 400**，且伺服器仍存活。
   必須用 `net.connect` 送 raw TCP，**不能用 `fetch`**（fetch 會先幫你正規化掉畸形路徑，測不到）。
2. 上述請求**不帶 token** → 仍回 400（證明在 token 檢查之前擋下）。
3. 送完之後 `/health`（phone-ingest）或一個正常帶 token 的請求（trigger）仍正常回應。
4. 全程掛 `process.on('uncaughtException')` 收集器，斷言收集到的陣列為空。
5. phone-ingest：注入一個丟例外的 `db.run`，送一則帶正確 token 的合法通知 → 回 500、程序存活、日誌有 warn。

**驗收指令**

```
npm run typecheck
npm test
```

**通過條件**

1. `npm test` 全綠，項數 ≥ 148 + 新增條數。不得刪測試、不得放寬既有斷言。
2. 上述五種 payload 在**兩個**伺服器上都不再造成非零 exit。

**突變驗證**

把 `trigger-server.ts` 的安全解析改回裸 `new URL` → 測試 1 必須失敗並看到非零 exit。確認後改回。

## 4. 可寫路徑白名單

```
src/worker/trigger-server.ts
src/worker/phone-ingest.ts
src/util/http-target.ts     # 新檔，共用的安全 request target 解析
src/cli.ts                  # 僅限新增 uncaughtException / unhandledRejection 兜底
tests/unit/trigger.test.ts
tests/unit/phone-ingest.test.ts
```

以上之外一律唯讀。特別禁止：`src/detect/**`、`src/publish/**`、`src/config/schema.ts`、`.github/**`、
**`src/util/image.ts`（WO-012 的範圍）**、**`tests/unit/image.test.ts`（WO-012 的範圍）**。

> 這三張 P0 併行時的唯一接觸點是 `tests/unit/phone-ingest.test.ts` —— **由本張獨佔**。
> WO-012 需要的 ingest 層圖片斷言請寫在 `tests/unit/image.test.ts`（可直接 import `ingestNotification`）。
