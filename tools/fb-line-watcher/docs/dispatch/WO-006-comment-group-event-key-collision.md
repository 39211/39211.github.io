# WO-006 留言群組的 event_key 不含 kind 與內容，留言被編輯後事件被靜默吞掉

- 提出：雲端深審席一（提交邊界）
- 日期：2026-09-04
- 嚴重度：**P0**（日常操作即可觸發，無警報、無日誌、統計還顯示成功）
- 驗證狀態：**已由規劃席逐行確認**

## 問題

`src/worker/scheduler.ts:39-40`

```ts
const itemKeys = payload.items.map((i) => i.entityKey).sort().join(',');
const eventKey = sha256Hex(`${g.target_key}|COMMENTS|${g.root_post_key}|${itemKeys}`);
```

這把 key **不含 kind、不含內容雜湊、不含時間**。因此「留言 C 的新增」與「留言 C 的編輯」是**同一把 key**。

`src/storage/repo.ts:327` 的 `insertEvent` 是 `INSERT OR IGNORE` 並回傳 boolean，
但 `scheduler.ts:41` **沒有看回傳值**，`n++` 照加、第 48 行 `deletePendingGroup` 照刪。

失敗序列（全部是日常操作）：

1. 客人留言「你們幾點開門？」→ group `[C]` → 事件 K 建立 → 送出 → group 刪除。
2. 客人自己編輯成「你們幾點開門？（補充：週日呢）」→ `applyDiff` 正確產生 `EDITED_COMMENT`
   → `upsertPendingGroup` 成功 → `commit()` 把 `current_content_hash` 前移。
3. `flushDueGroups` 算出**同一把 K** → `insertEvent` 回傳 false → 事件沒建立
   → 但 `n++`、`deletePendingGroup` 照做。

結果：這則編輯**永遠不會通知**。沒有警報、沒有錯誤日誌，`flushedGroups` 統計上還算成功一次。
狀態已提交，下一輪不會補送。第三次、第四次編輯同樣被吞。

深審席重現：
```
T1 NEW_COMMENT    | 你們幾點開門？              | key=c1221ba11f → 新事件
T2 EDITED_COMMENT | 你們幾點開門？（補充：週日呢） | key=c1221ba11f → 事件被丟掉，但已提交
--- 實際留下的事件 --- 只有 T1
```

**上一輪的修正沒有涵蓋這條。** 當時的 commit message 寫「`flushDueGroups()` 不再刪除事件建立失敗的
pending group」—— 那只擋了 `throw`，沒擋 `insertEvent` 回傳 `false`。這個宣稱當時就是過度宣稱。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `src/worker/scheduler.ts` | `flushDueGroups`（第 24–56 行） |
| `src/events.ts` | `CommentsEventPayload`（若需要新增欄位來構成 key） |
| `src/detect/groups.ts` | `mergeCommentGroup`（若 key 需要內容雜湊，來源在這裡） |

## 2. 規格（逐條可驗）

1. `eventKey` 必須能區分「同一組留言的不同版本」。做法自選，但必須滿足：
   - 同一批 items 的**同一份內容**重複 flush → 同一把 key（維持冪等，重啟後不重送）
   - 同一批 items 的**不同內容**（任一則被編輯）→ **不同的 key**
   - 建議：把每個 item 的 `kind` 與內容雜湊納入 key 的組成，例如
     `sha256(target|COMMENTS|rootPostKey|<每個 item 的 entityKey:kind:contentHash 排序後串接>)`。
     若 `CommentItem` 目前沒有內容雜湊，在 `mergeCommentGroup` 內以 `commentContentHash` 補上。
2. `enqueueEvent` 的回傳值**必須檢查**。回傳 `false`（＝event_key 已存在）時：
   - 這代表這批內容先前已經成功建立過事件，是正常的冪等路徑 → 可以刪除 group
   - 但 `n++` **不得**遞增（統計要誠實）
   - 記一筆 debug 級日誌
3. `enqueueEvent` 回傳 `true` → `n++`、刪除 group（現行行為）。
4. `throw` 的路徑維持現狀（保留 group、下一輪重試）。
5. 修正後，第 1 條的三個性質必須同時成立 —— 特別是「重啟後不重送」不能因為 key 加了時間戳之類的東西而破功。**key 內不得含有 wall-clock 時間。**

## 3. 驗收（測試／突變）

**新增回歸測試**（`tests/integration/comments.test.ts` 或 `tests/unit/`），至少四條：

1. 新留言 → 送出一則。同一批再 flush 一次 → **不重送**（冪等）。
2. 該留言被編輯 → `EDITED_COMMENT` → **必須送出第二則**，且內容含編輯後文字。
3. 同一則留言連續編輯三次 → 收到三則，內容各自不同。
4. `enqueueEvent` 回傳 false 時，`flushDueGroups` 的回傳值**不**遞增，且 group 被刪除（不留殘骸）。

**驗收指令**

```
npm run typecheck
npm test
npm run soak -- --minutes 2
```

**通過條件**

1. `npm test` 全綠，項數 ≥ 148 + 新增條數。不得刪測試、不得放寬既有斷言。
2. 特別確認 `tests/integration/comments.test.ts` 既有的 5 條仍然全過 —— 那些測的是「不重複通知」，改 key 很容易把它們弄壞。

**突變驗證**

把 `eventKey` 改回只含 entityKey 集合 → 測試 2 必須失敗。確認後改回。

## 4. 可寫路徑白名單

```
src/worker/scheduler.ts
src/events.ts
src/detect/groups.ts
tests/integration/comments.test.ts
tests/unit/comment-group-key.test.ts   # 新檔
```

以上之外一律唯讀。特別禁止：`src/detect/diff.ts`、`src/worker/target-worker.ts`（WO-007 的範圍，兩張同時改會衝突）、
`src/line/**`、`src/util/**`、`tests/unit/phone-ingest.test.ts`、`tests/unit/image.test.ts`、`.github/**`。
