# 假模式壓力／功能測試報告（2026-09-05）

執行環境：Linux x86_64、Node v22.14.0、Playwright Chromium 141、`images.publisher=none`、mock LINE、fixture Facebook。  
**沒有**真實 Facebook 登入，**沒有**打真實 LINE API，**沒有**讀取或列印 `.env` 祕密。  
本報告只對假模式負責。不得解讀成「可以上真實 Facebook／LINE／Windows」。

分支：`cursor/stress-func-fake-8b7d`（從 PR #1 head `claude/facebook-screenshot-line-notify-tjq1s8` 分出）。  
產品版本：fb-line-watcher 0.3.0。

## 0. 直白結論（先看這個）

- 假模式：**比送進來時硬**。基準 148×4 全綠；修正後 181×2 全綠；30 分鐘 soak 9／9 gate、0 誤報、0 錯、0 zombie browser、0 lock 檔。
- 修正前預設路徑上**活著的 P0**：編輯留言被同一把 `event_key` 永久吞掉。已修，回歸綠。
- 修正前預設關閉才活著的 P0：畸形 HTTP target 可弄死 trigger／phone-ingest；假 JPEG／未先查 IHDR 的 PNG 炸彈。預設關，一開就活。已修。
- **不要 GO 真實 Facebook／LINE／Windows。** 那三條這次沒做。

---

## 1. 基準 suite

指令：`npm test`（vitest run，`fileParallelism: false`）

### 1.1 未改碼（148 項）

| 輪次 | 結果 | 時長 | 備註 |
| --- | --- | --- | --- |
| 1 | **148/148 PASS** | 383.35 s | 2026-09-04 18:52:29Z |
| 2 | **148/148 PASS** | 383.64 s | |
| 3 | **148/148 PASS** | 382.86 s | |
| 4 | **148/148 PASS** | 383.36 s | |

Flakiness：**4 次全綠，0 失敗，時長差 < 1 s**。既有 148 項在這台 Linux VM 上穩定。  
這不代表覆蓋足夠——下面獨立重現的洞，全部是在 148 全綠的情況下存在的。

### 1.2 修正後（178 項，空牆邏輯收窄之後）

| 輪次 | 結果 | 時長 | 備註 |
| --- | --- | --- | --- |
| 1（空牆過寬，resilience 連坐） | **174 pass / 4 fail / 178** | — | 骨架／noroles 被當成 READY；已收回。此輪不算綠 |
| 2 | **178/178 PASS** | 561.29 s | 2026-09-04 19:46:09Z |

之後又加了空 DOM／時鐘快轉／壞 HTTPS 語法 3 項（**181**）。soak 後全套見第 5.2 節。

---

## 2. 獨立重現（修正前，不依賴既有 WO 文字）

| ID | 嚴重度 | 證據 | 預設是否活著 |
| --- | --- | --- | --- |
| JPEG 空 SOF／只有標頭 | **P0（phone_ingest 開時）／預設關閉** | `validateImage(JPEG_EMPTY_SOF)` 回 `{format:jpeg,width:100,height:100}`（16 bytes）；`JPEG_HEADER_ONLY` 回 1024×1024（21 bytes） | `phone_ingest.enabled=false` 時不活 |
| `ConfigSchema.safeParse` 對壞 URL 丟例外 | **P2** | `url: 'not a url' \| '' \| 'http://' \| 'https://'` → `TypeError: Invalid URL`，不是 `ConfigError` | 設定打錯就炸 |
| `new URL('//[')` 等 6 種畸形 target | **P0（trigger／phone_ingest 開時）** | 6／6 丟 `Invalid URL`。`/%E0%A4%A` **不**丟（上一輪 payload 測不到這條） | 預設兩伺服器都關 |
| 畸形 request 讓 callback 丟例外 | **P0（同上）** | raw TCP 腳本掛在「沒有回應」；`uncaughtException` 收集器一掛上，程序不退出但連線卡住。未掛收集器時 Node 對未捕捉例外是 exit 1 | 預設關閉 |
| 編輯留言被同一把 event_key 吞掉 | **P0（預設活著）** | `flushDueGroups` 的 key 只含 entityKey 集合；`insertEvent` 是 `INSERT OR IGNORE`。回歸測試在修正前的語意下會漏第二則 | **活著**（debounce 0 或過了 debounce 都中） |
| 空 feed 當成抽取失敗 | **P1** | `extractorFailed = posts.length === 0`；fixture 0 貼文仍有 `role=feed` → 連續失敗後 `DEGRADED_VISUAL_MODE`。修正必須避開骨架／noroles（同樣是 0 則） | 活著 |
| soak 預算 | **P2（腳本）** | `scripts/soak.ts` 未覆寫 `max_notifications_per_day`（預設 150）。30 分鐘會超過 → dead letter。這是壓測設定，不是產品日額度邏輯本身 | 只影響 `npm run soak` |

**沒有在這台機器上引爆 20000×20000 PNG 解碼**（WO-012 規劃席測過 RSS 4.7 GB／event loop 卡 25 s）。原因：與正在跑的 148 項 suite 並行會把 VM 打掉。改成「IHDR 先檢查 + 100ms 計時斷言」，修正後該測試 20ms 內結束。

---

## 3. 功能矩陣（假 FB + 假 LINE）

`tests/integration/adversarial.test.ts` + 既有 posts／comments／resilience + 新增 `edited-comment.test.ts`。

| 事件 | 結果 | 誤報 | 漏報 |
| --- | --- | --- | --- |
| 新貼文 → 截圖 → compose → mock LINE | PASS | 0 | 0 |
| 貼文編輯 | PASS | 0 | 0 |
| 新留言／回覆 | PASS（既有 + 矩陣） | 0 | 0 |
| 安靜重跑 | PASS | 0 | — |
| 相對時間／反應數／排序 | PASS（既有 posts） | 0 | — |
| unicode／emoji／零寬字元 | PASS | 0 | 0 |
| 快速連續編輯同一則貼文 ×3 | PASS | 0 | 0 |
| LINE 429 → 重試成功、同一 retry key | PASS | 0 | 0 |
| `publisher=none` 只傳文字、截圖留本機 | PASS | — | — |
| 大量留言（20 則）去重 | PASS（抓到的不重複） | 0 | 超出展開上限視為已知限制 |
| 登入牆／安全檢查／權限不足 | PASS（既有 resilience） | 冷卻內不重複警報 | — |
| **編輯留言（預設路徑 P0）** | **修正後 PASS** | 0 | **修正前會永久漏；修正後連編三版都送到** |
| **空 feed（0 貼文、feed 還在、從未有過貼文實體）** | **修正後 PASS**：空 baseline、不降級、之後第一則會通知 | 0 | 修正前會走 DEGRADED。若已有貼文實體再變成 0 則，仍當抽取失敗（骨架畫面測試依賴這條） |
| 空白 HTML（無 feed、無 article） | PASS：0 內容事件；恢復後不把舊貼文當新的 | 0 | 0（會走抽取失敗／可能警報，不當新貼文） |
| 時鐘快轉 +3h／回撥 −2h | PASS | 0 | — |
| LINE 登入牆／checkpoint／permission | PASS（resilience） | 冷卻內不重複 | — |
| `trigger.enabled=true` 無 token | PASS：`validateSecrets(..., {requireTrigger:true})` 拒絕 | — | — |
| `publisher=none` vs 非 https 公開網址 | PASS：http／空值拒絕；`https://127.0.0.1:1/...` 語法通過 | — | 運行期壞掉的 HTTPS 主機無法在假模式證明 |

已知且**這次故意不改**的產品行為：

- `notify_event_types` 沒有 `EDITED_COMMENT` 這個值；過濾用的是 `NEW_COMMENT`／`NEW_REPLY`。不是這次的洞。
- 每日 150 則預算把 event 標 `SUPPRESSED`、delivery 標 `DEAD_LETTER`（WO-002，狀態模型／政策，未動）。

---

## 4. 這次修了什麼（只修明確 bug）

| 修正 | 對應 | 測試 |
| --- | --- | --- |
| PNG 先讀 IHDR 再 `checkSize`，通過才解碼；JPEG SOF `length<8` 拒絕；必須走到 SOS＋entropy | 68-byte 殺程序級／假 JPEG 落地 | `tests/unit/image.test.ts`（含 100ms 炸彈斷言、`ingestNotification` 不落檔） |
| `parseRequestTarget`；trigger／phone-ingest 整個 callback + `end` + `clientError` 包起來；`watch` 加 uncaughtException／unhandledRejection 後 exit 1 | 畸形 `GET //[`／`http://[` 結束 watcher | `http-target.test.ts`、trigger／phone-ingest raw TCP |
| `commentGroupEventKey` 含 kind＋contentHash；同 entity 再出現覆寫而不是略過；`enqueueEvent` 回 false 不遞增 `flushedGroups` | 編輯留言永久漏報 | `comment-group-key.test.ts`、`edited-comment.test.ts` |
| 從未見過貼文的空牆（feed 在、0 則、0 個 post entity）不當抽取失敗；已有實體的 0 則維持降級 | 空牆誤降級 vs 骨架誤 READY | `adversarial.test.ts`；既有 `resilience.test.ts` 骨架／noroles 必須仍綠 |
| `superRefine` 的 `new URL` 包 try/catch | 打錯網址拿到堆疊 | `adversarial.test.ts` 設定段 |
| soak `max_notifications_per_day: 100000` | 壓測被預算截斷 | 見第 5 節 |

**沒有**改 `trigger.bind`／`phone_ingest.bind` 預設 `0.0.0.0`（改成 loopback 會讓手機連不上，那是功能不是缺陷）。

---

## 5. 30 分鐘 soak（已跑完，不是口號）

指令：`npm run soak -- --minutes 30 --json reports/soak-linux-20260905.json`  
牆鐘：2026-09-04 **19:56Z–20:30Z**（約 34 分鐘含收尾）。exit **0**。  
原始數字：同目錄 `soak-linux-20260905.json`。

**這不是產品預設。** soak 會打開 `trigger.enabled` 與 `phone_ingest.enabled`（bind `127.0.0.1`），並把 `max_notifications_per_day` 設成 100000。產品預設是兩伺服器關、日額度 150、`poll_mode=interval`。

| 項目 | 數字 |
| --- | --- |
| 輪次／target cycles | 30 輪／**552** cycles |
| 重啟 | **6**（每 5 輪一次） |
| mock LINE 接受 | **270**（events=deliveries=sent=270） |
| trigger HTTP | 600（20 併發 × 30；只驗狀態碼，`onTrigger` 是 noop，**沒有**真的踢巡邏） |
| phone ingest | accepted 30／duplicate 270（每輪同一則 ×10，必須 1 接受） |
| 誤報 | **0** |
| 錯誤 | **0** |
| pending／dead letter／uncommitted | **0／0／0** |
| 瀏覽器頁數最大 | 4（門檻 ≤6） |
| RSS | 145.3 → 182.2 MiB（最大 182.2；門檻 +300） |
| cycle 延遲 | p50 3.868 s／p95 6.063 s／p99 8.637 s／max 8.723 s |

9／9 gate **PASS**。腳本的「至少跑滿指定時間」只檢查 `iterations > 0`，真正的牆鐘是上面那 34 分鐘，不是這個 gate。

### 5.1 soak 之後殘留

| 檢查 | 結果 |
| --- | --- |
| `headless_shell`／playwright／soak node | **0**（不是 zombie） |
| `watcher.lock` | **0** |
| soak 暫存目錄 `/tmp/fblw-soak-*` | 已刪（腳本預設清掉） |
| `/tmp/fblw-lock-*` | soak 結束時 **7** 個空目錄；兩輪全套後 **9** 個。裡面 **0 個 lock 檔**。來自 `lock-ids.test.ts` 的 `mkdtempSync` 沒 `rmSync`，測試衛生問題，不是產品鎖洩漏 |

soak **沒有**覆蓋編輯留言（那條在 `edited-comment.test.ts`，不在 soak 迴圈裡）。

### 5.2 soak 後全套（含空 DOM／時鐘／壞 URL 語法）

對抗子集先跑過：`adversarial` 14 + `edited-comment` 5 = **19/19 PASS**（215.56 s），含空白 HTML、時鐘快轉／回撥。全套數字：

| 輪次 | 結果 | 時長 | 備註 |
| --- | --- | --- | --- |
| 對抗子集 | **19/19 PASS** | 215.56 s | 2026-09-04 20:30:44Z |
| 全套 3 | **181/181 PASS** | 598.46 s | 2026-09-04 20:34:27Z |
| 全套 4 | **181/181 PASS** | 597.12 s | 2026-09-04 20:46:27Z |

Flakiness（修正後、含新對抗項）：**2 次全套全綠，時長差 < 2 s，0 失敗**。兩輪結束後 `headless_shell` = 0、`watcher.lock` = 0。

---

## 6. 仍然無法證明的事

沒有真實 Facebook、真實 LINE、真實 Windows，以下全部是未知：

1. 真實 Facebook DOM／Litho／登入 cookie／checkpoint 是否被 adapter 認得出來。
2. 真實 LINE Messaging API 收圖、429 額度、群組權限。
3. Windows 工作排程器、headed Chromium、鎖檔、登入後自啟。
4. MacroDroid → 家用 Wi-Fi → `0.0.0.0:8799/8800` 防火牆與真機通知欄位。
5. 24–48 h canary、真實帳號被要求驗證的機率。
6. 40000×40000 PNG 在未修程式上的 OOM killer（這台沒有引爆）。
7. soak 與產品預設同時開著 trigger／phone_ingest 的差異之外，**預設路徑的 30 分鐘巡邏**（只 interval、兩伺服器關閉）沒有單獨再跑一條。既有 soak 比較接近「功能全開的假模式」，不是使用者第一次試跑的設定。

**結論：假模式比送進來時硬（含 30 分鐘功能全開 soak、9／9 gate）。真實 Facebook／LINE／Windows 仍然是沒做過。不要 GO。**
