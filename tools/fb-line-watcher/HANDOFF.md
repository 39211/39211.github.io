# 交接文：從雲端 session 交給本機 Windows Claude Code

- 日期：2026-09-05
- 交接人：雲端 Claude Code session（規劃／深審席）
- 接手人：使用者 Windows 本機的 Claude Code
- 分支：`claude/facebook-screenshot-line-notify-tjq1s8`，HEAD `0c202dc`
- 專案：`tools/fb-line-watcher/`

---

## 0. 先讀這段：為什麼要交接

**雲端這台容器被網路政策禁止連 `api.line.me` 與 `www.facebook.com`（gateway 對 CONNECT 回 403）。**

實測紀錄：
```
api.line.me:443       → connect_rejected, gateway answered 403 to CONNECT
api-data.line.me:443  → connect_rejected, gateway answered 403 to CONNECT
www.facebook.com:443  → connect_rejected, gateway answered 403 to CONNECT
```

後果：**這個專案最關鍵的兩件事，雲端在架構上就不可能驗證。** 就算使用者把 LINE 的 channel token 給雲端也沒用 —— 打不出去，只會白白洩漏憑證。

**所以第 1 節那兩個驗證動作，只有你（本機）做得到。在那之前，任何往下的開發都是在未驗證的假設上疊東西。**

---

## 1. 最優先：證明前端兩件事（其他全部往後排）

使用者的原話：「你前端的攝取你就沒有做到，後面做再好都沒有用。」他是對的。

### 1-1. 證明 LINE 收得到圖（不需要本專案任何程式碼）

拿到 LINE channel access token 與家庭群組 ID 後，直接打：

```bash
curl -v -X POST https://api.line.me/v2/bot/message/push \
  -H "Authorization: Bearer <CHANNEL_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "<GROUP_ID>",
    "messages": [
      { "type": "text", "text": "測試一：文字" },
      { "type": "image",
        "originalContentUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/640px-PNG_transparency_demonstration_1.png",
        "previewImageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png" }
    ]
  }'
```

一條指令同時證明：token 正確、群組 ID 正確、**LINE 發得出圖**、**LINE 抓得到外部圖片網址**。

**先用這個現成公開圖片測，不要一開始就用自己的 R2** —— 才能分辨「LINE 抓不到圖」與「我的 R2 設錯」。

> ⚠️ **API 回 200 不代表圖有出來。** LINE 抓圖失敗時訊息照常送出、API 照回 200，只有圖是破的。**一定要用手機肉眼確認。**

### 1-2. 證明真實 Facebook 抓得到

在 Windows 上依 `README.zh-TW.md` 完成 `scripts\setup.ps1`、填 `config\targets.yaml`、`scripts\login.ps1` 人工登入後：

```
npm run probe -- --target page
```

`probe` 不發 LINE、不需要 LINE 設定。它開真的粉專，印出抓到幾則貼文／幾則留言／信心值，並存一張診斷截圖。

**那個數字和那張截圖就是「FB 截不截得到」的答案。第 1-2 步失敗的話，本文件其餘所有內容都不重要。**

---

## 2. 目標（修正後的正確理解）

早期我誤把這個專案當成「即時通知器」。使用者 2026-09-05 澄清後的真正需求是**檔案庫，通知只是它的一個出口**：

> 把粉專發佈的內容與大家的討論**全部收集 → 歸檔 → 變成屬於我的記憶 → 整理重點發 LINE**

使用者明確選擇：
- **粉專關係**：完全是別人經營的粉專（不是管理員 → **沒有 Graph API 捷徑，爬蟲是唯一路**）
- **LINE 要收到**：圖片（截圖或原圖）**＋** 整理過的重點摘要
- **歸檔用途**：之後可搜尋回顧、餵給 AI 當背景知識、匯出成檔案保存

### 這個轉向的重要性

| | 通知器（舊理解） | 檔案庫（真實需求） |
|---|---|---|
| 核心指標 | 即時 | 完整 |
| 巡邏間隔 | 3 分鐘（帳號風險最高） | **15～30 分鐘完全夠** |
| LINE 輸出 | 每則推一次 | **每日一則摘要** |
| 截圖保留 | 72 小時就刪 | **必須長期保留** |

**使用者的真實需求與「降低帳號風險」「省 LINE 額度」的方向是一致的。**

---

## 3. 現在的真實狀態

### 已證明（對假 Facebook + 假 LINE）
- 181 項測試全綠（25 個檔案），雲端 Linux 實跑確認
- 30 分鐘壓測：552 cycles、6 重啟、9/9 gate PASS、誤報 0、未提交狀態殘留 0
- 核心鏈在受控輸入下是通的：偵測 → 截圖 → 合成 → 發布 → LINE 訊息

### 完全未證明
- 真實 Facebook 登入與 DOM 抽取
- 真實 LINE 發送（文字與圖片皆未驗證）
- 真實圖片主機（R2 / tunnel）
- Windows 工作排程器常駐、重開機自啟
- MacroDroid → 家用 Wi-Fi → Windows 防火牆（手機模式）

**測試全綠只代表「對我們自己寫的 fixture 是對的」，不代表對真實世界是對的。**

---

## 4. 程式碼現況

### 已修（PR #2 已合併進分支）
| 缺陷 | 檔案 |
|---|---|
| 畸形 `GET //[` 讓 trigger／phone-ingest 行程 exit 1 | `src/util/http-target.ts`（新）、兩個 server、`cli.ts` 加了 uncaughtException 兜底 |
| 留言編輯事件被 `INSERT OR IGNORE` 永久吞掉 | `src/detect/groups.ts` `commentGroupEventKey` 含 kind + contentHash |
| PNG 先解碼才檢查尺寸 → 68 bytes 可 OOM 殺掉行程 | `src/util/image.ts` 改為先讀 IHDR 再 `checkSize` |
| 假 JPEG（空 SOF）被當有效圖 | 同上，加 `length < 8` 檢查與 SOS 要求 |
| 空 feed 被誤判為抽取失敗 | `src/adapters/` |
| 壞 URL 讓 `safeParse` 丟 TypeError | `src/config/schema.ts` 改用 `ctx.addIssue` |

### 未修的工單（`docs/dispatch/`，共 15 張）
仍待處理：**WO-002、003、004、007、008、009、010、013、014、015**

> ⚠️ `docs/dispatch/README.md` 的狀態表在 PR #2 合併後**沒有更新**，仍把 WO-001/005/006/011/012 列為待派。請以本節為準，並順手更新該檔。

其中與使用者目標最相關的三張：
- **WO-009**：手機路徑把原圖直接當預覽圖（同一個 URL）→ 超過 LINE 1MB 預覽上限會破圖。Chatwoot 2025-10 還在踩同一個坑
- **WO-010**：發布中途失敗留下永遠不會被清掉的公開圖片，繞過 `retention_hours`
- **WO-003**：每日額度用完後內容永久消失（已拍板：`notify_authors` 命中者豁免 + 隔日摘要）

工單格式為四段：標的檔案與函式、逐條可驗規格、驗收（含突變驗證）、可寫路徑白名單。

---

## 5. 研究結論中「會改變設計」的五件事

三席帶網路搜尋的研究席的結論，全部附出處在對話紀錄中。以下是會實際改動程式的：

### 5-1.（最高風險）3 分鐘輪詢，而且沒有抖動
`scheduler.ts` 是 `poll_interval_seconds * 1000`，**沒有任何隨機化**。

3 分鐘 = 每目標每天 480 次載入，兩目標約 960 次/天、29,000 次/月，同一帳號反覆刷同樣兩頁。**精準的 180.000 秒週期本身就是指紋。**

→ 改 **15～30 分鐘 + ±40% 抖動 + 只在 08:00–24:00 跑**。降到約 40～60 次/天。**風險最大、改動最小，第一個做。**

### 5-2. LINE 按「群組人數」計費（已查證官方文件）
> The number of messages is counted by **the number of people you send a message to**.

推一則到 5 人群組 = 扣 5 則。免費約 200 則/月 → **一個月只能推 40 次**。

我們預設 `max_notifications_per_day: 150`，約為免費額度的 **112 倍**。

→ 改**每日彙整一則**。同一個請求放多個 message object 不影響計數（文字＋圖片一起送仍只算群組人數）。

### 5-3. 原圖上限坐在爭議區
LINE 文件自己打架（1 MB vs 10 MB）。我們 `max_original_bytes: 9_500_000`。

→ 取安全區間 **≤1 MB**；預覽獨立產生、**≤1 MB**（此上限無爭議）。

### 5-4. `retention_hours: 72` 與「歸檔」需求直接衝突
**文字永久保留**（`entities` / `entity_snapshots` / `events` 三張表整個 codebase 沒有任何 DELETE），**但截圖 72 小時就刪**。

使用者三個月後回查，會找到貼文全文但截圖不見了。

→ **這是唯一「現在不做就來不及」的事**，刪掉的救不回來。建議先改成長期保留。

### 5-5. LINE 依 URL 快取（我們剛好避開了）
同一個網址換內容，LINE 會一直顯示第一次抓到的那張，**不報錯**。

我們兩個發布器都用 `randomToken(16)` 產生唯一檔名 → **踩不到**。**維持這個行為，不要改成固定檔名。**

---

## 6. 使用者必須知情的風險（關於他爸爸的帳號）

Meta 服務條款 **2025-01-01** 修訂後：

> 禁止自動化蒐集，**「不論該自動化存取或蒐集是否在登入 Facebook 帳號的狀態下進行」**

那段字是 Meta 在 **Meta v. Bright Data**（N.D. Cal. 2024-01-23）敗訴後補上的。該判決替「登出爬公開資料」開了空間，但同時確認「登入後的自動化」正是條款管得到的那一半。**本工具明確落在被禁止的一側。**

實務觀察到的執法樣態是 **checkpoint／CAPTCHA／暫時功能封鎖**，不是永久停權。但 2025 年有大規模停權潮（含未明顯違規者），**一旦中獎，自動化紀錄會削弱申訴立場**。

**這件事應該讓使用者的爸爸知情後再決定。**

### 現實的維護預期
**每 1～3 個月因 FB 版面變動壞一次，每月需人工重新登入一次。** 這是結構性的 —— RSSHub 與 rss-bridge 兩個有社群規模的專案都在 Facebook 這件事上放棄了；3.3k★ 的 `kevinzg/facebook-scraper` 停止維護 12 個月後就完全失效。**沒有共享的 selector 清單可以外包。**

### 值得抄的兩個開源作法
- [`BoPeng/ai-marketplace-monitor`](https://github.com/BoPeng/ai-marketplace-monitor)（323★，架構最像）：Docker 內建 **noVNC**，遇到 CAPTCHA／重新登入時人工點一下就好。**業界作法不是「避免 checkpoint」，是「設計成人可以隨時接手」。**
- [`tamnd/facebook-cli`](https://github.com/tamnd/facebook-cli)：解析頁內 `<script type="application/json" data-sjs>` 的 Relay JSON。同一次 `page.goto()` 就拿得到、**不多發請求**，且對版面 A/B、繁中在地化、feed 虛擬化免疫。建議當作 DOM 抽取之外的第二條路，DOM 保留為 fallback。

---

## 7. 建議執行順序

```
1. curl 測 LINE（第 1-1 節）           ← 沒有這個，其他都不用做
2. npm run probe 測真 FB（第 1-2 節）   ← 失敗的話整個專案要重新評估
3. retention_hours 改長期保留          ← 唯一來不及會後悔的
4. 巡邏間隔 3min → 15-30min + 抖動      ← 風險最大、改動最小
5. 每日彙整摘要（取代每則推播）          ← 同時解決額度與風險
6. test-line 加上圖片測試              ← 目前只發文字，測不到最重要的一段
7. 其餘工單 WO-002..015
8. 搜尋／匯出／AI 背景知識（使用者的「記憶」需求）
```

---

## 8. 不要做的事

- **不要**在 WO-005／WO-012 之外的情況下開啟 `trigger.enabled` 或 `phone_ingest.enabled` 去「順便驗證手機路徑」—— 第一次真機試跑用預設的 `interval` 模式，少一個變數
- **不要**把發布的圖片改成固定檔名（會踩 LINE 的 URL 快取，症狀是每天收到同一張舊圖，且不報錯）
- **不要**刪既有測試或放寬斷言來讓 CI 變綠。目前 181 項，新增測試必須「修正前失敗、修正後通過」
- **不要**把 `.env`、`data/`、`captures/`、`config/targets.yaml` 提交進 git（已在 `.gitignore`）
- **不要**用 API 回應判斷圖片成功與否 —— 必須肉眼確認 + 看圖床存取日誌

---

## 9. 目前開著的東西

- **PR #1**（Draft，base `main`）：整個專案。**維持 Draft**，離 Ready 還很遠
- **PR #2**：已合併進 PR #1 的分支
- **CI 全綠**（run `33947159742`，head `de88a5f`，2026-09-05）：`verify` 與 `soak` 在 Linux／Windows 四個 job 全部 success

  > ⚠️ **但 WO-002 沒有被修，只是不再觸發。** soak 之所以轉綠，是因為 PR #2 讓壓測腳本覆寫了 `max_notifications_per_day`（WO-001），預算抑制不再發生 → `dead = 0` → gate 通過。
  >
  > `DeliveryStatus` 仍然沒有 `SUPPRESSED` 這個狀態，預算抑制仍然被寫成 `DEAD_LETTER`（`src/line/notifier.ts:249`）。**一旦正式環境的每日額度用完，監控就會把「刻意抑制」報成「投遞失敗」，而且會把真正的投遞失敗藏在裡面數不出來。** 這條在真機上線前要修。
- `docs/dispatch/` 的 15 張工單與 `BACKLOG.md` 的 4 項待確認發現

---

## 10. 一句話總結

**核心鏈已經寫完並在假環境證明可用，但真實 Facebook 與真實 LINE 一次都沒碰過；雲端因網路政策無法驗證這兩件事，所以請先做第 1 節的兩個動作，其餘全部往後排。**
