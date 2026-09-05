# 驗收報告（ACCEPTANCE_REPORT.md）

日期：2026-09-04　版本：fb-line-watcher 0.3.0　adapter：`fb-web-2026.09-v1`

## 【實作結論】CONDITIONAL GO

- 程式碼、測試、文件、Windows 常駐腳本已完整交付，端對端流程（畫面 → 結構化偵測 → 精準截圖 → LINE）在**本機模擬的 Facebook 頁面與模擬 LINE API** 上全部通過。
- **尚未完成、也無法在開發環境完成**的是「真實 Facebook 24～48 小時 canary」與「真實 LINE 發送」：開發環境的網路政策封鎖 `facebook.com` 與 `line.me`（CONNECT 403）。這兩項必須在使用者的 Windows 電腦上以真實帳號執行（README 第 9 節有逐步清單）。
- 因此判定為 **CONDITIONAL GO**：可以直接安裝試跑；正式長期使用前需完成真機 canary，並可能需要依真實 Facebook 畫面微調 selector catalog（已提供 `npm run probe` 與 `ADAPTER_MAINTENANCE.md`）。

## 更新（2026-09-03，第二版）

新增**手機通知觸發模式**（`poll_mode: triggered`）。原因：使用者要監看的是**別人的公開粉專**與**需審核才能加入的私密社團**，兩者都拿不到 Meta 官方 API（粉專 API 需粉專管理權限；社團 API 已於 2024 年對一般開發者關閉），因此只能走畫面巡邏，而固定週期輪詢正是帳號風險的主要來源。

作法：一支閒置 Android 手機跑官方 Facebook App，MacroDroid 監看自己手機的通知並打一個家用區網內的網址，watcher 收到後才巡邏一次。Facebook 完全看不到手機端這段流程。效果：時間點不再是固定節奏，新貼文通知更快（數秒 vs. 最多 3 分鐘）。載入次數的降幅**不是固定保證值**：安全網巡邏次數固定（15 分鐘間隔＝96 次／天），觸發次數等於通過節流的手機通知數。典型情境（兩個來源合計一天 10～30 則動態）約 110～130 次／天，比 480 次少約 75%；但熱門社團若不調高 `trigger.min_interval_seconds`（上限為 86400÷該值），可能反而更多。算式與實測方式見 `PHONE_TRIGGER.md`。

誠實限制：Facebook **不會**為「別人貼文底下的新留言」推播通知，因此 `poll_interval_seconds` 保留為安全網（建議 900 秒）用來補抓留言。實際效果是新貼文數秒到、留言最慢 15 分鐘到。詳見 `PHONE_TRIGGER.md`。

---

## 更新（2026-09-04，第三版）：新增純手機模式

使用者提出「為什麼不乾脆全部在手機上做」。重新查證後，我原本的兩個反對理由有一個站不住：

- **我原本說手機端只有像素、沒有結構——這是錯的。** Android 的通知本身就帶 `title`、`text` 與未截斷的 `bigText`，MacroDroid 的通知觸發器能直接讀取並用正規表達式過濾。也就是說「只有群主說話才通知」這件事在手機端就能篩掉，而且拿到的是文字而非像素。
- **Facebook Android App 的 Litho 問題只在「導覽 App 內部」時成立。** 使用者提出的是截通知欄，不需要在 App 裡找元素，這個反對理由不適用。
- 我原本擔心的 Android 14 截圖權限與螢幕常亮，使用者用「改用 Android 13 的閒置備用機、放家裡」解決，兩者都不再是問題。

因此新增第三種模式 `phone_ingest`：手機把通知（與可選截圖）POST 到電腦，電腦負責去重、過濾、合併、發 LINE。`targets` 可留空，**電腦完全不連 Facebook**，唯一的 Facebook session 是手機上的官方 App。

設計取捨：**文字是主路徑，截圖是可選加值。** 純文字 POST 不需要任何特殊權限一定會動；截圖需要 MediaProjection 或 ADB 授權，拿不到也不影響其他功能。MacroDroid 不支援 multipart，所以圖片以原始位元組當 body 傳送，接收端依 magic bytes 判斷。

誠實限制：只抓得到 Facebook 有推播通知的內容。**別人貼文底下的新留言通常不會產生通知**，要完整覆蓋仍須併用瀏覽器巡邏。兩種模式可以並用，各自去重。

未在真機驗證的項目已列在 `PHONE_INGEST.md` 末節（MacroDroid 魔術文字在真實 FB 通知上的實際內容、以檔案內容當 body 的實際行為、Android 13 截圖權限能否記住、FB 各類通知的樣式）。

---

## 更新（2026-09-04，第四版）：獨立驗證的 NO-GO 判定與修正

一位獨立 agent 從 PR head `a5b84be` 建立隔離分支做對抗式驗證與 30 分鐘兩平台壓測，結論是
**架構可行、壓測通過，但因為 7 項缺陷判定 NO-GO、必須維持 Draft**。這一版把 7 項全部修掉，
每一項都補上會在修正前失敗的回歸測試。

| # | 嚴重度 | 缺陷 | 修正 | 回歸測試 |
| --- | --- | --- | --- | --- |
| 1 | P0 | 畸形百分比路徑（`/%E0%A4%A`）讓 `decodeURIComponent` 丟 `URIError`，例外從 HTTP callback 逸出，整個 watcher 以 exit 1 結束 | 新增 `safeDecodeRequestName()`，整個 callback 包 try/catch，補 `clientError` 與 stream error handler；解析失敗回 400 | `tests/unit/local-http.test.ts`：5 種畸形路徑都回 400、不產生 `uncaughtException`、之後仍能正常供圖 |
| 2 | P0 | `dedup_window_seconds` 到期後同一則手機通知回 `accepted`，卻因為事件鍵永遠等於內容雜湊而不會再送到 LINE | 資料表拆成 `content_fingerprint`（去重）與 `occurrence_id`（本次發生，事件鍵來源），migration v3 保留舊資料 | `tests/unit/phone-ingest.test.ts` 驗身分拆分；`tests/integration/phone-ingest.test.ts` 端到端驗「視窗內不送、視窗外真的再送一次」 |
| 3 | P0 | `applyDiff()` 在交易中就把 `known` / content hash 前移，之後才截圖；截圖失敗只發警報，下一輪不會補送 → 永久漏報 | `applyDiff` 只回報變更並附 `PendingCommit`，呼叫端等 `enqueueEvent()` / `upsertPendingGroup()` 成功才 `commitChange()`；`known = 0` 的實體下一輪會重新偵測補送 | `tests/integration/capture-failure.test.ts` 三條故障注入（新貼文／貼文編輯／留言）＋ `tests/unit/diff.test.ts` 提交邊界 5 條 |
| 4 | P1 | Android 套件 allowlist 在 `packageName` 缺失時 fail-open | 改為 fail-closed，要放行必須明確設 `allow_missing_package: true` | `tests/unit/phone-ingest.test.ts`：缺 `pkg` 回 `filtered:package_missing` |
| 5 | P1 | 只看 magic bytes，204 bytes 的假 JPEG 被當成有效截圖寫進 captures | 新增 `src/util/image.ts` 真正解碼（PNG 走 pngjs、JPEG 逐段走 marker），限制像素與邊長，暫存檔後原子 rename；圖片無效仍保留通知文字 | `tests/unit/image.test.ts` 9 條（含驗證報告的 204 bytes 樣本、截斷 JPEG、假 PNG、解壓炸彈上限、專案內真實樣本） |
| 6 | P1 | PNG 被存成 `.jpg`，發布器又固定宣告 `image/jpeg` | 副檔名由實際格式決定，`PublishOptions` 帶 `originalExtension` / `previewExtension`，local HTTP 與 S3 各自宣告正確 MIME | `tests/unit/local-http.test.ts`：PNG 回 `image/png`、JPEG 回 `image/jpeg`、原圖與預覽可不同格式 |
| 7 | P2 | `/facebook\.com$/` 沒有主機名邊界，`notfacebook.com` 會被接受 | 改成 `host === 'facebook.com' \|\| host.endsWith('.facebook.com')` | `tests/unit/config.test.ts`：`notfacebook.com`、`evilfacebook.com`、`facebook.com.evil.tld` 等 6 個負例 |

順帶修掉的兩個同性質問題：

- `flushDueGroups()` 原本無論 `enqueueEvent()` 是否成功都刪掉 pending group，事件建立失敗時整批留言會消失。改成只有成功才刪；payload 壞掉才丟棄。
- local HTTP 與手機接收伺服器關閉時沒有中斷 keep-alive 連線，`close()` 會卡到閒置逾時（測試中觀察到每次 4 秒）。加上 `closeAllConnections()`。

截圖連續失敗的處理刻意分成兩段：**第一次失敗不送、下一輪補送**（滿足「不能漏報」），
連續失敗達 `capture_failure_fallback_threshold`（預設 3）才改送**純文字事件**並提交，
避免內容永遠卡在補送迴圈裡。兩段行為都有測試覆蓋。

壓測改成可重跑的腳本 `scripts/soak.ts`（`npm run soak -- --minutes 30`），
以及手動觸發的 workflow `fb-line-watcher-soak.yml`（Linux 與 Windows 各跑一次、產出 JSON 報告）。
gate 為：0 錯誤、0 誤報、0 pending delivery、0 dead letter、event/delivery 數量一致、
沒有未提交的偵測狀態殘留、瀏覽器頁數受控、記憶體無明顯成長。

**仍未完成的現場驗證與第三版相同**：真實 Facebook DOM、真實 LINE 圖片抓取、MacroDroid → 家用 Wi-Fi → Windows 防火牆、
真機 Android 通知欄位、Windows 工作排程器重開機自啟、24～48 小時 canary。PR 維持 Draft。

---

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

## 靜態複審回應（2026-09-04）

| # | 複審意見 | 處理 |
| --- | --- | --- |
| 1 | `setup.ps1` 未檢查 Playwright 與 `icacls` 的結束代碼，安裝失敗仍印出完成；應優先用 `npm ci` | 已修。新增 `Invoke-Native` helper（PowerShell 的 try/catch 不會攔截原生程序的非零結束代碼，必須自己檢查 `$LASTEXITCODE`）；npm 改用 `npm ci`；Playwright 與 icacls 失敗改為累積警告，結尾據實顯示「有 N 項警告」而非無條件印出完成 |
| 2 | trigger server 的 request limit 按 chunk 數而非累計 bytes | 已修。改為 `MAX_BODY_BYTES = 8 KiB` 的真實位元組上限，先看 `Content-Length` 擋，串流超量時回 413 並 `destroy()` 連線、丟棄已收資料。新增 3 項測試 |
| 3 | `package.json` 0.2.0 但 lockfile 根 metadata 仍 0.1.0 | 已修（commit `ba1321d`，以 `npm install --package-lock-only` 重新產生，未變動任何依賴） |
| 4 | 載入量下降 75%～85% 取決於通知量，不是固定保證值 | 已修文件。四份文件改為「安全網次數固定、觸發次數隨動態量變動」，附上 `86400 ÷ min_interval_seconds` 的上限公式與各設定值對照表，並明說**熱門社團若不調高 `min_interval_seconds`，觸發模式可能比固定週期載入更多次**；另加上用 `extractor_health` 表實測當日載入次數的方法 |

---

## 【測試證據】

開發過程中修正的兩個真實問題（皆已加入回歸測試）：留言合併的等待時間原本從「巡邏開始時間」起算，導致巡邏耗時超過等待時間時同一輪就送出（改為從寫入當下起算）；以 `tsx` 執行時 esbuild 會在注入頁面的函式中插入 `__name` 輔助函式而在瀏覽器內報錯（已在每個分頁注入 no-op shim，並由 CLI 端對端測試覆蓋 `npm run probe` 路徑）。

- unit：`npx vitest run tests/unit` → 13 個檔案、95 項全部通過（正規化、指紋、比對引擎與提交邊界、視覺 dHash 與雙重取樣、設定驗證與 facebook 主機名邊界、LINE 重試／額度／警報、日誌遮罩、單實例鎖、簽章、留言合併、觸發伺服器驗證與節流、圖片解碼驗證、本機圖片伺服器畸形請求與 MIME）。
- integration（真實 Chromium + 假 Facebook + 假 LINE + 模擬手機）：`npx vitest run tests/integration` → 8 個檔案、53 項全部通過（posts 8、capture-failure 4、comments 5、resilience 7、phone-ingest 8、trigger 4、publisher 2、cli 5）。全套 `npx vitest run` 最終結果：**21 個檔案、148 項通過**，耗時 391 秒（第三版為 112 項；本輪只新增測試，沒有刪除或放寬任何既有斷言）。
- 長時間壓測：`npm run soak -- --minutes 30`，Linux 與 Windows 各跑滿一次（workflow `fb-line-watcher soak`，產出 `soak-report.json`）。
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
| T1 | 觸發模式下沒有觸發就不會巡邏 | ✅ | `tests/integration/trigger.test.ts` |
| T2 | 手機觸發後數秒內完成巡邏並發出 LINE | ✅ | 同上，實測 4.8 秒 |
| T3 | 觸發 token 錯誤不會讓 watcher 動作，且 token 不進日誌 | ✅ | `tests/unit/trigger.test.ts`、`tests/integration/trigger.test.ts` |
| T4 | 連續觸發有節流，不會重複巡邏 | ✅ | `tests/unit/trigger.test.ts` |
| P1 | 零 target 時不啟動瀏覽器，純手機模式可運作 | ✅ | `tests/integration/phone-ingest.test.ts` |
| P2 | 手機通知 → LINE，原文與全形標點未被竄改 | ✅ | 同上 |
| P3 | 同一則通知重複送達不重複通知（去重視窗內） | ✅ | `tests/unit/phone-ingest.test.ts`、整合測試 |
| P4 | 只通知指定發話者，其他人被擋且不入庫 | ✅ | 同上 |
| P5 | 多則通知合併成一則 LINE 訊息 | ✅ | `tests/integration/phone-ingest.test.ts` |
| P6 | 截圖以原始 body 上傳、存檔並附到 LINE 圖片訊息 | ✅ | 同上 |
| P7 | 重啟後未送出的通知仍會送出，已送出的不重送 | ✅ | 同上 |
| P8 | token 錯誤回 401、超量 body 回 413，token 不進日誌 | ✅ | `tests/unit/phone-ingest.test.ts` |
| T5 | 觸發 body 有真正的位元組上限，超過回 413 且不觸發 | ✅ | `tests/unit/trigger.test.ts`（含未宣告 Content-Length 的串流情況） |
| T6 | `setup.ps1` 對 npm／Playwright／icacls 檢查結束代碼，失敗不會被當成成功 | ✅（靜態） | `scripts/common.ps1` 的 `Invoke-Native`；CI 有 PowerShell 語法 gate，實際執行仍待真機 |

## 【已知限制】

見 README 第 0 節與第 12 節；重點：非官方整合、帳號有被要求驗證的風險（建議專用帳號）、Facebook 改版需維護 catalog、只能看到已載入且可見的內容、LINE 圖片需公開 HTTPS 主機、LINE 免費額度、電腦需常開並保持登入。

## 【安全檢查】

- secrets：只在 `.env` 與記憶體；日誌 hook 全面遮罩；`.env`/`data`/`captures`/`targets.yaml` 不進 Git。觸發 token 亦納入遮罩，長度不足 16 字元時啟動即失敗。
- 觸發伺服器：僅綁家用區網、固定長度比較驗證 token、有最小間隔節流；唯一能做的事是「要求立即巡邏一次」，不提供任何資料讀取。
- browser profile：獨立於日常瀏覽器；不讀取 cookie 值；不做任何反偵測。
- logs：pino 結構化，14 天自動清理；已驗證 token／Bearer／LINE ID／cookie 不出現。
- screenshot retention：本機 30 天、公開圖片 72 小時自動刪除，檔名 128-bit 亂數。

## 【下一個最小動作】（給使用者）

1. Windows 上執行 `scripts\setup.ps1` → 填 `targets.yaml` 與 `.env` → `scripts\login.ps1`（私密社團須用已是成員的帳號登入）。
2. `npm run test-line` 確認 LINE；`npm run once` 兩次確認 baseline 與零通知。
3. 發一篇測試貼文與一則留言，確認兩個巡邏週期內收到通知；若信心低或抓不到，執行 `npm run probe -- --target <key>`，把 `captures\diagnostics\probe_*.json` 提供給維護者調整 catalog。
4. 依 `PHONE_TRIGGER.md` 設定手機觸發（強烈建議；先用 interval 模式跑一兩天量出實際動態量，再據以設定 `min_interval_seconds`）。
5. `scripts\install-task.ps1` 常駐，跑 24～48 小時 canary，依 README 第 9 節逐項勾選。
