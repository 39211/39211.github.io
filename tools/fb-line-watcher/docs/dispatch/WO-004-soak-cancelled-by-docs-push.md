# WO-004 純文件的 push 會砍掉跑到一半的 30 分鐘壓測

- 提出：雲端規劃／深審席
- 日期：2026-09-04
- 嚴重度：P2（不影響產品，但每次都燒掉一小時 CI 並拖慢每一輪交付）
- 相依：無。可以跟 WO-001／002 平行做。

## 問題

`.github/workflows/fb-line-watcher-ci.yml` 目前是：

```yaml
on:
  pull_request:
    paths:
      - "tools/fb-line-watcher/**"
      - ".github/workflows/fb-line-watcher-ci.yml"

concurrency:
  group: fb-line-watcher-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

`soak` job 每台跑 30 分鐘。`cancel-in-progress: true` 取消的是**整個 run**，
所以只要在壓測期間往分支推**任何**符合 path filter 的東西 —— 包括這個 `docs/dispatch/` 目錄裡的工單 ——
兩台跑到一半的壓測就會被砍掉重來。

已實際發生：run `33895174264` 的兩台 soak 跑到第 26 分鐘，
被一個純文件 commit（`9587739`，只新增 `docs/dispatch/*.md`）觸發的 run `33898518370` 取消。
一小時的 CI 直接作廢。

這個 workflow 是雲端席寫的，這個洞也是雲端席挖的。

**程式碼變更時取消壓測是對的**（程式變了，舊的壓測結果本來就作廢）。
**文件變更時取消壓測是純浪費。** 這張工單只處理後者。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `.github/workflows/fb-line-watcher-ci.yml` | `on.pull_request.paths` 區塊 |

## 2. 規格（逐條可驗）

1. `on.pull_request.paths` 加入排除樣式，讓**純文件**變更不觸發整個 workflow：

   ```yaml
   paths:
     - "tools/fb-line-watcher/**"
     - "!tools/fb-line-watcher/docs/**"
     - ".github/workflows/fb-line-watcher-ci.yml"
   ```

   GitHub 的 path filter 是**最後一個相符的樣式獲勝**，所以排除樣式必須放在
   `tools/fb-line-watcher/**` 之後、且 `.github/...` 那條之前或之後皆可（該條不受影響）。

2. `docs/samples/**` 底下的截圖樣本同屬文件，一併排除（已包含在上述樣式內）。

3. **不得**改動 `concurrency` 區塊。程式碼變更時取消進行中的 run 是正確行為。

4. **不得**改動 `soak` job 的 `timeout-minutes: 75`、matrix、或 `needs: verify`。

5. **不得**把 `soak` 變成手動觸發或關掉它。壓測是發布 gate 的一部分。

## 3. 驗收（測試／突變）

沒有單元測試可以涵蓋 workflow 觸發條件，改用實際觀察：

1. **語法**：`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/fb-line-watcher-ci.yml'))"` 無錯，且 `jobs` 仍為 `['verify', 'soak']`。
2. **負向**：推一個只改 `tools/fb-line-watcher/docs/` 底下檔案的 commit → **不得**產生新的 workflow run。
3. **正向**：推一個改 `tools/fb-line-watcher/src/` 底下檔案的 commit → **必須**產生新的 run，且會取消進行中的 run（維持既有行為）。
4. **混合**：同一個 commit 同時改 `src/` 與 `docs/` → **必須**觸發（positive 樣式仍相符）。

第 2、3 條要附上 run 清單截圖或 `gh run list` 輸出當證據。

## 4. 可寫路徑白名單

```
.github/workflows/fb-line-watcher-ci.yml
```

以上之外一律唯讀。特別禁止：`src/**`、`tests/**`、`scripts/**`、`.github/workflows/pages.yml`。
