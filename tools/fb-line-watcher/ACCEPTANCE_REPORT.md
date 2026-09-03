# 驗收報告（ACCEPTANCE_REPORT.md）

日期：2026-09-03　版本：fb-line-watcher 0.1.0　adapter：`fb-web-2026.09-v1`

## 【實作結論】CONDITIONAL GO

- 程式碼、測試、文件、Windows 常駐腳本已完整交付，端對端流程（畫面 → 結構化偵測 → 精準截圖 → LINE）在**本機模擬的 Facebook 頁面與模擬 LINE API** 上全部通過。
- **尚未完成、也無法在開發環境完成**的是「真實 Facebook 24～48 小時 canary」與「真實 LINE 發送」：開發環境的網路政策封鎖 `facebook.com` 與 `line.me`（CONNECT 403）。這兩項必須在使用者的 Windows 電腦上以真實帳號執行（README 第 9 節有逐步清單）。
- 因此判定為 **CONDITIONAL GO**：可以直接安裝試跑；正式長期使用前需完成真機 canary，並可能需要依真實 Facebook 畫面微調 selector catalog（已提供 `npm run probe` 與 `ADAPTER_MAINTENANCE.md`）。

## 採用方案

以**方案 B（結構化偵測＋精準截圖）為主、方案 A（視覺比對）為降級模式**，兩者合併於同一個程式：

- 結構化：以 role／aria／permalink／可見文字抽取貼文、留言、回覆與媒體 → entity key／content hash → SQLite 比對 → `NEW_POST`／`EDITED_POST`／`NEW_COMMENT`／`NEW_REPLY`／`EDITED_COMMENT`。
- 降級：連續 N 次無法辨識結構 → 對可視區域做 256-bit dHash 雙重取樣 → `VISUAL_CHANGE`，通知中標示 `DEGRADED_VISUAL_MODE`；恢復後自動 resync。
- 與方案 A 提示詞的偏離：視覺 baseline 在**事件建立時**即更新（而非 LINE 成功後），因為事件已持久化在 SQLite 並由 delivery 層負責重試，不會遺失通知，且可避免 LINE 延遲時重複產生事件。

## 【已完成】

- 專用 persistent profile 手動登入流程（不代填、不存密碼、不處理驗證碼），登入後逐 target 檢查可見性。
- 登入頁／安全檢查／權限不足／空白頁分類，各自發一次系統警報（60 分鐘冷卻），恢復後自動解除。
- 粉專與社團共用 adapter；社團以 `sorting_setting=CHRONOLOGICAL` 取最新貼文；留言排序切「所有留言」；自動點「查看更多」「查看更多留言」「查看全部 N 則回覆」，每篇有展開上限並記錄完整性。
- Selector catalog 集中管理、可由 YAML `adapter_overrides` 覆寫、未知欄位 fail fast；不依賴任何隨機 class name（fixture 每次渲染都隨機化 class）。
- 首次 BASELINE_ONLY 不通知；`--notify-existing` 需明確指定；adapter 版本變更或從降級恢復時自動 resync。
- 留言 per-post debounce 合併（預設 60 秒）；重啟後 pending group 仍會送出。
- 精準截圖：貼文容器元素截圖、新留言紅框＋NEW 標記、資訊條（來源／事件／時間／信心／完整性／模式）、JPEG 大小符合 LINE 限制（原圖 ≤10MB、預覽 ≤1MB）、可選文字個資模糊。
- LINE Messaging API push，`X-Line-Retry-Key` 冪等、429/5xx 有上限退避、409 視為成功、4xx dead-letter＋警報並附修復提示；每日通知額度保護。
- 圖片發布器三種：`none`、`local_http`（只服務亂數檔名、不列目錄）、`s3`（R2／S3 相容），72 小時到期自動刪除。
- SQLite（Node 內建 `node:sqlite`，Windows 不需編譯工具）migration；events／deliveries／entities／snapshots／pending_groups／alerts／extractor_health／visual_baselines／budget／published_images。
- 單實例鎖、每 target 獨立 timeout 與退避、健康報告（CLI 與 `data/health.json`）、可選每日健康摘要。
- 日誌祕密遮罩（token、Bearer、cookie、LINE ID、敏感鍵名），有測試。
- Windows：`setup.ps1`、`login.ps1`、`install-task.ps1`（登入自動啟動、失敗自動重啟）、`uninstall-task.ps1`、`status.ps1`、`baseline.ps1`、`resync.ps1`。
- 文件：`README.zh-TW.md`（含「你需要準備什麼」清單）、`SECURITY.md`、`ADAPTER_MAINTENANCE.md`、本報告。
- 範例截圖：`docs/samples/`（新圖片貼文、貼文編輯、社團新留言＋回覆、降級模式畫面變化）。

## 【未完成／偏離提示詞】

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 真實 Facebook 24～48 小時 canary | **未執行** | 開發環境無法連 Facebook。需在使用者電腦執行（README 第 9 節）。 |
| 真實 LINE 發送 | **未執行** | 同上；`npm run test-line` 可在使用者電腦一鍵驗證。 |
| Selector 對真實 Facebook 的準確度 | 待驗證 | 規則依 Facebook 現行無障礙結構撰寫（role=article、aria-labelledby、permalink、data-ad-preview），但未能在真站驗證；準備了 `probe` 診斷與覆寫機制。 |
| 視覺 baseline 更新時機 | 有意偏離 | 見「採用方案」。 |
| 無 permalink 之貼文／留言的編輯 | 限制 | 會被視為新貼文／新留言（README 第 12 節）。 |
| 「刪除」事件 | 不通知 | 只在資料庫標記 `active=0`，避免因排序或載入造成誤報。 |
| 截圖內圖片中的個資 | 無法遮罩 | 只能模糊文字節點。 |

## 【測試證據】

- unit：`npx vitest run tests/unit` → 9 個檔案、48 項全部通過（正規化、指紋、比對引擎、視覺 dHash 與雙重取樣、設定驗證、LINE 重試／額度／警報、日誌遮罩、單實例鎖、簽章、留言合併）。
- integration（真實 Chromium + 假 Facebook + 假 LINE）：`npx vitest run tests/integration` — 結果見下表；共 5 個檔案。
- fixture：`fixtures/server.ts` 模擬粉專與社團（巢狀 role=article、aria-labelledby、時間 aria-label、permalink、data-ad-preview、查看更多／更多留言／回覆 template、留言排序選單、隨機 class name），並可切換登入頁／安全檢查／權限不足／骨架載入／無 role 五種異常模式。
- real Facebook canary：**未執行**（環境限制）。
- LINE delivery：對假 LINE API 驗證 push 內容、retry key 冪等、500→成功、401 dead-letter、409、額度抑制；真實 LINE 未驗證。

### 放行 Gate 對照（方案 B 第 21 節 + 方案 A 第 17 節）

| # | Gate | 結果 | 證據 |
| --- | --- | --- | --- |
| B1 | 首次 baseline-only 不傳舊內容 | ✅ | `posts.test.ts`「首次巡邏只建立 baseline」、`comments.test.ts` baseline |
| B2 | 一個粉專與至少一個社團可穩定抽取 | ✅（fixture） | 兩種 surface 各 3 篇貼文、9 則留言、信心 ≥0.95 |
| B3 | 新貼文、新圖片、貼文編輯、新留言、新回覆正確分類 | ✅ | `posts.test.ts`、`comments.test.ts`、`diff.test.ts` |
| B4 | 排序改變、相對時間、反應數不誤報 | ✅ | `posts.test.ts`「相對時間、反應數與貼文排序改變不通知」、`diff.test.ts` |
| B5 | 同一 entity/event 重複掃描不重複通知 | ✅ | 「同一畫面重新巡邏 20 次不重複通知」 |
| B6 | 事件截圖清楚顯示父貼文與新增內容 | ✅ | `docs/samples/03_group_new_comments_and_reply.jpg`（紅框） |
| B7 | 多則留言 debounce 合併正確 | ✅ | `comments.test.ts` 兩個 debounce 案例 |
| B8 | selector／extractor 失效不靜默，能降級或告警 | ✅ | `resilience.test.ts` noroles → 警報 → DEGRADED_VISUAL_MODE |
| B9 | 故障恢復後 resync 不造成事件洪水 | ✅ | 同上，恢復後 baselineMode=true、0 事件 |
| B10 | LINE 失敗可恢復且 delivery 冪等 | ✅ | `notifier.test.ts`、`resilience.test.ts` LINE 500×2 |
| B11 | Cookie、token、截圖與個資未進 Git 或普通日誌 | ✅ | `.gitignore`、`logger.test.ts`、文字摘要遮罩測試 |
| B12 | Windows 重開機後可自動恢復 | ✅（腳本） | `install-task.ps1`（AtLogOn＋RestartCount）；未在真機驗證 |
| B13 | 48 小時真機 canary | ❌ 未執行 | 環境限制，需使用者執行 |
| B14 | README 明確揭露無法保證零遺漏 | ✅ | README 第 0、12 節 |
| A3 | 同一畫面刷新 20 次不重複通知 | ✅ | 同 B5 |
| A6 | LINE 發送失敗可恢復且不重複事件 | ✅ | 同 B10 |
| A7 | 登入失效與版面破壞可被監測並告警 | ✅ | `resilience.test.ts` login／checkpoint／permission／noroles |
| A9 | Windows 重開機後 watcher 自動恢復 | ✅（腳本） | 同 B12 |
| A10 | README 可讓另一台 Windows 依步驟安裝 | ✅ | README 第 1～8 節 |

## 【已知限制】

見 README 第 0 節與第 12 節；重點：非官方整合、帳號有被要求驗證的風險（建議專用帳號）、Facebook 改版需維護 catalog、只能看到已載入且可見的內容、LINE 圖片需公開 HTTPS 主機、LINE 免費額度、電腦需常開並保持登入。

## 【安全檢查】

- secrets：只在 `.env` 與記憶體；日誌 hook 全面遮罩；`.env`/`data`/`captures`/`targets.yaml` 不進 Git。
- browser profile：獨立於日常瀏覽器；不讀取 cookie 值；不做任何反偵測。
- logs：pino 結構化，14 天自動清理；已驗證 token／Bearer／LINE ID／cookie 不出現。
- screenshot retention：本機 30 天、公開圖片 72 小時自動刪除，檔名 128-bit 亂數。

## 【下一個最小動作】（給使用者）

1. Windows 上執行 `scripts\setup.ps1` → 填 `targets.yaml` 與 `.env` → `scripts\login.ps1`（建議用專用 Facebook 帳號）。
2. `npm run test-line` 確認 LINE；`npm run once` 兩次確認 baseline 與零通知。
3. 發一篇測試貼文與一則留言，確認兩個巡邏週期內收到通知；若信心低或抓不到，執行 `npm run probe -- --target <key>`，把 `captures\diagnostics\probe_*.json` 提供給維護者調整 catalog。
4. `scripts\install-task.ps1` 常駐，跑 24～48 小時 canary，依 README 第 9 節逐項勾選。
