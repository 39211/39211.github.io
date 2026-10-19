# 待確認的發現（尚未成為工單）

深審席回報，但**還不足以直接派工**的項目。不要因為沒有工單就當作不存在。

## B-1 baseline 期間建立的低信心貼文，第一次編輯被靜默吞掉（P2，已重現）

`src/detect/diff.ts:213-216` 與 `:238`

`setEntityFlags(db, id.key, { confirmed: true })` 只寫 DB，**沒有更新本機的 `existing.confirmed`**，
所以同一輪後面第 238 行的 `existing.confirmed === 1` 仍是 `false` → 走 else 分支 `updateEntityContent` 靜默前移。

觸發條件：baseline 時 `known = ctx.baselineMode = 1`、`confirmed = highConf = 0` ——
也就是任何 `confidence < min_confidence`（預設 0.85）的貼文。沒抓到 permalink 的貼文最高只有 0.75，
所以這類貼文不算罕見。每個實體只會被吞一次。

深審席重現：`baseline: known=1 confirmed=0` → 編輯後 `postChanges=[]`，hash 從 `c459d160` 靜默變成 `fda14e81`。

**為什麼還不派**：修法很小（把 `existing.confirmed` 一併更新，或改讀本機變數），
但它就在 WO-007 要動的同一段程式碼裡。**併進 WO-007 一起做比較安全**，
避免兩張工單改同一個 if-else 鏈造成衝突。派 WO-007 時請一併交代這條。

## B-2 `postIdentity` 策略翻轉造成同一則貼文兩則 NEW_POST（P2，機制已重現，真實觸發率未知）

`src/extract/fingerprint.ts:96-102`

有 permalink 走 `permalink` 策略，沒有就走 `author_time_text`（含 text 前 60 字）。
同一則貼文若在兩輪之間 permalink 從無到有，entity key 完全改變 → 新實體 → 第二則 `NEW_POST`。
`postEventKey` 以 entityKey 為基礎，所以 `INSERT OR IGNORE` 擋不住。

**這是既有行為，不是這次修正引入的。**

**為什麼還不派**：深審席明講「**沒有**驗證 FB 真的會在觀測窗內把 permalink 補上，
這條的真實觸發率我不確定，不要當成已證實的線上問題」。這個誠實標注要保留。

**下一步**：真機 B 段時順便量測 —— 在真實粉專與社團各跑 20 輪，
統計 `entities` 表裡 `key_strategy` 從 `author_time_text` 變成 `permalink` 的次數。
若 > 0 再開工單；若為 0，記一筆「已量測、不成立」關掉。

## B-3 `markMissingEntities` 是安全的無效程式碼（非缺陷，但值得知道）

`src/storage/repo.ts:271-283`

深審席在檢查「會不會把待補送的實體標成 inactive」時發現：
`WHERE … last_seen_at = ?`（上一輪時間戳）意味著 `missing_count` 只能加到 1，
`>= 3` 的 `active = 0` 分支**永遠碰不到**；而且 `active` 這個欄位在整個 codebase 裡
**從來沒有被讀取來擋通知**。`markAllEntitiesKnown` 同樣沒有任何呼叫者。

結論：不會造成漏報（所以不是缺陷），但這是一段從未生效的邏輯。
要嘛把它修好讓「連續消失 3 輪就不再追蹤」真的生效，要嘛刪掉它與 `markAllEntitiesKnown`。
**先不要動** —— 在 WO-005..011 全部落地、PR 回到綠燈之前，不要為了整潔去碰沒有壞的東西。

## B-4 留言 debounce 在特定設定下可被無限延後（P2）

`src/worker/target-worker.ts:362`

`upsertPendingGroup` 每輪重設 `hold_until`，`created_at` 有保留卻沒有拿來設上限。
所以 `comment_debounce_seconds >= poll_interval_seconds` 的設定下，
持續有新留言的貼文可以被**無限延後**送出。

預設值（60s < 180s）不會發生，所以是 P2。

**修法建議**：`hold_until` 取 `min(now + debounce, created_at + debounce * 3)` 之類的硬上限，
或在 schema 加交叉驗證，禁止 `comment_debounce_seconds >= poll_interval_seconds`。
後者更簡單且 fail-fast，但會限制使用者的設定自由；請實作者提案。

**為什麼還不派**：預設設定不會踩到，優先度低於 WO-005..011。
