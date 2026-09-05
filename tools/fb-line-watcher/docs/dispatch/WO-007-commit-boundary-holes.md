# WO-007 提交邊界的四個邊角漏洞（上一輪 P0-3 修正的殘留）

- 提出：雲端深審席一（提交邊界）
- 日期：2026-09-04
- 嚴重度：**P1**（其中兩條會造成永久靜默漏報，一條會造成無限迴圈）
- 驗證狀態：**已由規劃席逐行確認四條全部成立**
- 相依：與 WO-006 **不可並行**（WO-006 動 `scheduler.ts`，本張動 `diff.ts` / `target-worker.ts`，
  但兩者共用留言路徑的語意。建議 WO-006 先合併，本張再基於其上做。）

## 背景

上一輪修 P0-3，把「偵測狀態」與「事件持久化」拆開：`applyDiff` 只回報變更並附 `PendingCommit`，
呼叫端等事件寫入成功才 `commitChange()`。核心是對的 —— 30 分鐘壓測跑 900 個巡邏週期、9 次重啟，
`known=0` 的殘留為 **0**。但**邊角有四個洞，壓測的正常路徑全部沒有走到**。

## 缺陷一：純文字備援丟掉 `contentHash` → 無限迴圈（P1）

`src/worker/target-worker.ts:254`

```ts
commit(...entityKeys.map((entityKey) => ({ entityKey, known: true })));
```

這行**憑空造了一個新的 PendingCommit**，丟掉了 `ch.commit` 原本帶的 `contentHash`。
`EDITED_POST` 的 commit 是 `{ entityKey, contentHash }`（沒有 `known`，因為實體早就 `known=1`）。

後果：某則貼文被編輯且截圖永久失敗（影片貼文永遠不 settle、highlight 元素解析不到）→
第 3 輪達門檻送出純文字事件並「提交」，但 `current_content_hash` **沒動** →
第 4 輪 `applyDiff` 又產生 `EDITED_POST` → 又截圖、又失敗 →
`commitChange` 內的 `resetCaptureFailures` 把計數歸零 → **每 3 輪重跑一次，永不終止**。
純文字事件因 event_key 相同只建立一次，使用者只看到一次通知，但 watcher 永遠在重試。
留言群組路徑同樣（`EDITED_COMMENT` 的 commit 也只有 contentHash）。

深審席重現：`cycle 3 giveUp=true 送出純文字` → `cycle 4 EDITED_POST failures=1` → `cycle 6 giveUp=true 事件被吞` →（迴圈繼續）。

**規格**：`onCaptureFailure` 必須接收並提交**原本的 `PendingCommit` 物件**，不得自行構造。
簽章改成收 `commits: PendingCommit[]`（或同時收 entityKeys 與 commits），
give-up 時 `commit(...commits)`。`known` 與 `contentHash` 都要照原樣提交。

## 缺陷二：`baselineMode` 靜默吞掉未提交的變更（P1）

`src/detect/diff.ts:221-223`（貼文）、`src/detect/diff.ts:320-322`（留言）

```ts
if (ctx.baselineMode) {
  setEntityFlags(db, id.key, { known: true });
  if (hashChanged) updateEntityContent(db, id.key, hash, now);
}
```

`known=0` 代表「偵測到了但還沒有事件」。baselineMode 直接把它設成 1，**沒有事件、沒有 PendingCommit**。

三條路徑都會進 baselineMode：`opts.resync`（人工 `npm run resync`）、
`adapterChanged`（軟體升版後第一輪，`target-worker.ts:139/219`）、
`recovering`（從 `DEGRADED_VISUAL_MODE` 恢復，`target-worker.ts:218`）。

最可能的真實序列：FB 改版 → 抽取連續失敗 → 進入視覺降級 → 恢復那一輪是 resync →
**降級前所有未提交的變更一起蒸發**。這正是 P0-3 想消滅的那一類缺陷。

深審席重現：`週期1 NEW_POST known=0` → `週期2(resync) postChanges=0, known=1` → `週期3/4 postChanges=0`。

**規格**：baselineMode 遇到 `known=0` 的既有實體時，**不得**直接提交。至少要滿足下列其一：
(a) 仍產生事件（baseline 的原意是「不通知既有內容」，但這個實體是**上一輪已偵測、只是還沒送出**的，不算既有內容）；或
(b) 保留 `known=0`，讓下一個非 baseline 週期補送。
**建議 (a)**，因為 resync 之後可能很久才有下一次變更。實作者若選 (b) 要說明為什麼可接受。
首次 baseline（`targetRow.baseline_completed_at === null`）不受影響 —— 那時不可能有 `known=0` 的殘留。

## 缺陷三：新貼文底下的留言無 PendingCommit 就標 `known=1`（P1）

`src/detect/diff.ts:281`（`coveredByPost = ctx.baselineMode || postIsNew`）、`:299`、`:320-322`

`coveredByPost` 假設「貼文這輪一定會被通知，截圖含留言」。但貼文可能：

- **被 `suppressedReason` 過濾掉** —— 使用者設 `ignore_authors: ['店長']` 或 `notify_event_types` 不含 `NEW_POST`
  （＝「只想知道有人留言，不要收粉專自己的貼文」，是完全合理的設定）。
  新貼文帶客人留言 → 貼文被過濾 → 留言 `known=1`、`commentChanges=0` → **這些留言永遠不通知**。
  在這種設定下**每一則新貼文都會發生**。
- **降級成純文字送出**（缺陷一的路徑）→ `PostEventPayload` 沒有留言欄位、`formatEventText` 也不印
  → 兩則留言的內容從頭到尾沒進過任何事件、也沒進過任何截圖。

深審席兩種都重現了。

**規格**：`coveredByPost` 只有在「貼文這一輪確定會產生一則**含截圖**的事件」時才成立。
- 貼文被過濾（`suppressedReason` 非空）時，底下的留言**不得**視為 covered，必須各自產生變更與 PendingCommit。
- 純文字降級時，留言同樣不得被視為 covered。由於降級發生在 `applyDiff` 之後，
  最簡單的作法是讓 `coveredByPost` 只在 `ctx.baselineMode` 時成立，
  非 baseline 的新貼文改為：留言照常產生變更，但由呼叫端在貼文截圖**成功**時一併提交（截圖已含留言，不另外發 LINE）。
  實作者可提其他方案，但必須讓上述兩個失敗情境都不再漏。

## 缺陷四：`capture_failures` 只在 `commitChange` 內重設，殘值會誤判（P2）

`src/detect/diff.ts:103`、`src/storage/repo.ts:277`、`src/worker/target-worker.ts:247`

`resetCaptureFailures` 唯一呼叫點在 `commitChange`；`touchEntitySeen` 不重設。
任何「bump 了但最後沒 commit」的路徑都留下永久計數 —— 最直接的就是缺陷二的 resync 吞噬。

失敗情境：貼文 P 某天截圖失敗 2 次（網路抖動）→ adapter 升版 resync 吞掉變更 → `capture_failures` 永遠停在 2
→ 一個月後 P 被編輯，**第一次**截圖失敗就 `failures=3 >= threshold` → 直接送純文字、沒有截圖，
而且操作者收到的訊息寫「連續 3 次截圖失敗」，與事實不符。

另外 `Math.max(...entityKeys.map(bump))`（`target-worker.ts:247`）讓留言群組裡**最舊那則**的殘值決定整批命運。

**規格**：`capture_failures` 必須代表「**連續**失敗次數」。截圖成功時就要歸零，不能只在 commit 時歸零。
建議在 `captureEntity` 成功後、或 `touchEntitySeen` 時重設。留言群組的 give-up 判定改用該群組**本輪實際失敗**的次數，
不要用跨實體的 `Math.max` 殘值。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `src/worker/target-worker.ts` | `onCaptureFailure`（第 246–271 行）、`commit`（第 236–240 行）、貼文與留言群組兩個迴圈 |
| `src/detect/diff.ts` | `applyDiff` 的 baselineMode 分支（221-223、320-322）、`coveredByPost`（281、299） |
| `src/storage/repo.ts` | `resetCaptureFailures` 的呼叫時機（若需要新增呼叫點） |

## 2. 規格

見上方四個缺陷各自的「規格」段落。四條都要做，且做完後：

5. `Db.transaction` 使用 `BEGIN IMMEDIATE`、**不可重入**。目前 `commit()` 沒有在 `applyDiff` 的交易內被呼叫，
   所以還沒踩到，但這個約束沒寫在任何地方。請在 `Db.transaction` 的 JSDoc 補上一行說明。

## 3. 驗收（測試／突變）

**新增回歸測試**，四個缺陷各至少一條，全部要求「修正前失敗」：

1. `EDITED_POST` 截圖連續失敗達門檻 → 送出純文字事件後，**下一輪不得再產生 `EDITED_POST`**
   （`stats.editedPosts === 0`）。跑 6 輪確認迴圈終止。
2. 週期 1 新貼文截圖失敗（不提交）→ 週期 2 以 `resync: true` 執行 → **必須仍然送出該貼文**
   （或維持 `known=0`，依實作者選的方案；兩者都要有對應斷言，不得兩邊都不成立）。
3. `ignore_authors` 命中貼文作者、貼文底下有新留言 → **留言必須被通知**。
4. 新貼文截圖連續失敗達門檻降級純文字 → 底下的留言**必須另外被通知**（不能被 covered 吞掉）。
5. 截圖失敗 2 次後成功一次 → `capture_failures` 必須為 0；再失敗 1 次不得 give-up。

**驗收指令**

```
npm run typecheck
npm test
npm run soak -- --minutes 5
```

**通過條件**

1. `npm test` 全綠，項數 ≥ 148 + 新增條數。不得刪測試、不得放寬既有斷言。
2. 既有的 `tests/integration/capture-failure.test.ts` 四條**必須仍然全過** —— 那四條是上一輪 P0-3 的證據，
   本張是補它的邊角，不是推翻它。若它們壞了代表方向錯了。
3. 壓測 gate 全 PASS，`未提交的偵測狀態殘留` 維持 0。

**突變驗證**

- 把缺陷一的 `commit(...commits)` 改回自行構造 `{known:true}` → 測試 1 必須失敗。
- 把缺陷三的 `coveredByPost` 改回 `ctx.baselineMode || postIsNew` → 測試 3、4 必須失敗。

## 4. 可寫路徑白名單

```
src/worker/target-worker.ts
src/detect/diff.ts
src/storage/repo.ts
src/storage/db.ts              # 僅限 Db.transaction 的 JSDoc
tests/integration/capture-failure.test.ts
tests/unit/diff.test.ts
tests/integration/*.test.ts
```

以上之外一律唯讀。特別禁止：`src/worker/scheduler.ts`（WO-006 的範圍）、`src/line/**`、`src/publish/**`、`.github/**`。
