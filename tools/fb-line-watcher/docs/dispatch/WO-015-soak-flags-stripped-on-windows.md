# WO-015 Windows 上 `npm run soak -- --minutes N` 的旗標被吃掉，腳本靜默落回預設值

- 提出：雲端規劃席（讀 CI log 時發現，非深審席回報）
- 日期：2026-09-04
- 嚴重度：**P1** —— 壓測是發布 gate，而 gate 在**產品的目標平台**上參數不生效
- 證據：CI run `33900382067`，job `soak (windows-latest)`

## 問題

workflow 寫的是：

```yaml
run: npm run soak -- --minutes 30 --json soak-report.json
```

Linux 上 npm 正確傳遞。**Windows（PowerShell）上旗標名稱被吃掉**，log 裡實際執行的是：

```
> node --no-warnings=ExperimentalWarning --import tsx scripts/soak.ts 30 soak-report.json
                                                                       ↑ --minutes 與 --json 不見了
```

`scripts/soak.ts` 的 `parseArgs` 只認 `--minutes` / `--json` 這兩個字面值，
遇到 `['30', 'soak-report.json']` **兩個都不匹配**，於是：

| | Linux | Windows |
|---|---|---|
| `minutes` | 30（旗標生效） | 30 **（落回預設值，純屬巧合）** |
| `json` | `soak-report.json` | `undefined` |

後果：

1. **報告檔從未寫出。** `if (args.json)` 為假 → CI 的 upload-artifact 步驟報
   `No files were found with the provided path`。Windows 側**沒有任何壓測證據可以歸檔**。
2. **`--minutes` 從來沒有在 Windows 上生效過。** 這次剛好等於預設值 30 所以看起來正常；
   若有人跑 `--minutes 5` 想快速驗證，Windows 會**安靜地跑滿 30 分鐘**。
3. 最糟的是**沒有任何錯誤訊息**。腳本收到看不懂的參數卻照常執行，這是設計缺陷 ——
   不是 npm 的錯，是 `parseArgs` 沒有拒絕未知參數。

## 1. 標的檔案與函式

| 檔案 | 標的 |
| --- | --- |
| `scripts/soak.ts` | `parseArgs`（第 33–43 行附近） |
| `.github/workflows/fb-line-watcher-ci.yml` | `soak` job 的 `Soak` 步驟 |

## 2. 規格（逐條可驗）

1. **`parseArgs` 必須對無法辨識的參數 fail fast**，丟出說明用法的錯誤並以非零 exit 結束。
   靜默落回預設值是本缺陷的根因，比旗標傳不進去更嚴重。
2. `parseArgs` 同時接受 `--minutes 30` 與 `--minutes=30` 兩種寫法（等號形式在 Windows 上比較穩）。
3. 腳本啟動時把**實際解析出來的參數**印出來（例如 `[soak] minutes=30 json=soak-report.json`），
   讓 log 本身就能看出參數有沒有生效。
4. workflow 的 `Soak` 步驟**不要經過 `npm run -- `**。直接呼叫，繞開 npm 的 `--` 處理差異：
   ```yaml
   run: node --no-warnings=ExperimentalWarning --import tsx scripts/soak.ts --minutes ${{ inputs.soak_minutes || '30' }} --json soak-report.json
   ```
   （或改用 `--minutes=…` 等號形式，但直接呼叫更不容易再出事。）
5. `package.json` 的 `soak` script 保留，讓使用者本機仍可用 `npm run soak -- --minutes=5`。
   在 `docs/dispatch/README.md` 或 `README.zh-TW.md` 註明 **Windows 上要用等號形式**。
6. 不得改動壓測的內容、gate 定義或預設分鐘數。這張只處理參數傳遞。

## 3. 驗收（測試／突變）

1. **單元測試 `parseArgs`**（新檔或既有 unit 測試檔）：
   - `['--minutes','5','--json','x.json']` → `{minutes:5, json:'x.json'}`
   - `['--minutes=5','--json=x.json']` → 同上
   - `['5','x.json']`（Windows 被吃掉旗標的形狀）→ **必須丟例外**，不得回預設值
   - `['--bogus']` → 必須丟例外
   - `['--minutes','abc']` → 必須丟例外
2. **CI 實測**：修好後在 PR 上跑一次，`soak (windows-latest)` 的 log 必須出現
   第 3 條的參數回顯行，且 `soak-report-windows-latest` artifact **必須成功上傳**。
3. 既有 148 項測試全過。不得刪測試或放寬斷言。

**突變驗證**：把第 1 條的 fail fast 拿掉 → 測試「`['5','x.json']` 必須丟例外」失敗。

## 4. 可寫路徑白名單

```
scripts/soak.ts
.github/workflows/fb-line-watcher-ci.yml
package.json                    # 僅限 soak script 那一行
docs/dispatch/README.md
tests/unit/*.test.ts            # 僅限新增 parseArgs 測試
```

禁止：`src/**`、`tests/integration/**`、`.github/workflows/pages.yml`。
