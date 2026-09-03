# fb-line-watcher｜Facebook 粉專／社團 → 截圖 → LINE 群組通知

> 用「已授權、已登入」的專用瀏覽器巡邏你有權看到的 Facebook 粉絲專頁與社團畫面；
> 一有**新貼文、貼文編輯、新留言、新回覆**，就對該區塊精準截圖，連同摘要透過 **LINE Messaging API** 送到指定 LINE 群組。
> **Facebook 端完全不用 Graph API、Meta App、Webhook**；LINE 端用官方 Messaging API。

適用情境（本專案的原始需求）：要盯著**別人經營的公開粉絲專頁**，以及**自己已經加入的私密社團**；只要粉專有新貼文（文字／圖片）、社團裡有人（特別是群主）發言或留言，就把畫面截圖傳到家人的 LINE 群組。

因為粉專不是自己的、社團又是私密的，Meta 官方 API 這條路是關的（粉專 API 需要該粉專的管理權限；社團 API 已於 2024 年對一般開發者停止提供），所以只能用「授權帳號看畫面」的方式。這也是為什麼降低帳號風險特別重要，請務必看第 7.5 節的手機通知觸發模式。

---

## 0. 先講清楚：做得到什麼、做不到什麼

| 做得到 | 說明 |
| --- | --- |
| 粉專新貼文（文字、圖片、影片縮圖、連結） | 對整篇貼文容器截圖，附作者、時間、摘要、媒體數 |
| 貼文編輯 | 同一篇貼文文字或圖片改變 → 通知「已編輯」並附原文摘要 |
| 社團新貼文 | 以「最新貼文」排序巡邏最新 N 篇 |
| 新留言、新回覆 | 自動點開「查看更多留言／回覆」，新留言在截圖上加紅框 NEW，60 秒內多則合併成一則 |
| 只看特定人 | `notify_authors` 可限定只通知群主／管理員的貼文與留言 |
| 去重 | SQLite 記住每則貼文／留言，重開機、重跑都不會重複通知 |
| 首次不洗版 | 第一次只建立 baseline，不會把既有幾百篇全部傳到 LINE |
| 失效告警 | Facebook 要求重新登入、安全檢查、看不到內容、版面改版 → 發一則系統警報到 LINE（有冷卻，不洗版） |
| 降級模式 | Facebook 改版導致辨識不到結構時，自動切成「畫面視覺比對」繼續告警，並明確標示 `DEGRADED_VISUAL_MODE` |
| Windows 常駐 | 工作排程器登入後自動啟動、失敗自動重啟；單實例鎖避免重複 |
| 手機通知觸發 | 用一支閒置 Android 手機當觸發器，只在真的有新內容時才去看 Facebook，一天載入次數從約 480 次降到約 120 次（見 `PHONE_TRIGGER.md`） |

| 做不到／風險（請務必知道） | 說明 |
| --- | --- |
| **這不是 Facebook 官方整合** | 它是「模擬一個人開著瀏覽器看畫面」。Facebook 使用條款不歡迎自動化存取，帳號有被要求驗證、暫時限制的可能。降低風險的第一優先是改用**手機通知觸發模式**（`PHONE_TRIGGER.md`），其次是拉長巡邏間隔。若監看的社團是公開社團，也可以考慮用專用小帳；私密社團則必須用已經是成員的帳號。 |
| 不繞過任何安全機制 | 遇到登入、雙重驗證、CAPTCHA、安全檢查一律停下來通知人工處理，程式不會也不該自動突破。 |
| 不保證零遺漏 | 只能看到「當次巡邏中已載入、已展開、此帳號可見」的內容。被 Facebook 排序藏起來、載入前就刪除、需要額外權限的內容抓不到。 |
| Facebook 改版需要維護 | 辨識規則集中在一個檔案（`src/adapters/catalog.ts`），可用 YAML 覆寫；改版後用 `npm run probe` 診斷。見 `ADAPTER_MAINTENANCE.md`。 |
| 電腦要一直開著、保持登入 | 巡邏需要一個看得到的瀏覽器視窗（可以縮小，但 Windows 不能登出）。 |
| LINE 圖片需要公開 HTTPS 網址 | LINE 只能顯示「LINE 伺服器連得到」的圖片。所以截圖要先放到 Cloudflare R2（推薦、免費額度夠用）或你自己的 HTTPS tunnel；沒設定就只傳文字摘要，截圖留在電腦裡。 |
| LINE 訊息有額度 | LINE 官方帳號免費方案每月有免費訊息則數上限（台灣「輕用量」目前為每月 200 則；以你的 LINE 官方帳號後台顯示為準）。一則通知＝1 則訊息（文字＋圖片同一次送出算一則；群組不論人數算一則）。程式有 `max_notifications_per_day` 保護。 |
| 真機長期穩定性需要驗收 | 本專案在開發環境用「假 Facebook 頁面」完成完整流程測試；**真實 Facebook 的 24～48 小時 canary 必須在你的 Windows 電腦上跑**（見第 9 節）。 |

---

## 1. 你需要準備的東西（清單）

1. **一台可以一直開著的 Windows 10／11 電腦**（或迷你電腦），有網路。螢幕可鎖定，但不要登出。
2. **Node.js 22 LTS**（22.13 以上）：<https://nodejs.org/>，安裝時勾選加入 PATH。
3. **一個 Facebook 帳號**（建議專用小帳）：已追蹤要監看的粉專、已加入要監看的社團。密碼由你在瀏覽器裡自己輸入，程式不會問你、也不會存。
4. **要監看的網址**：粉專網址（例：`https://www.facebook.com/你的粉專`）、社團網址（例：`https://www.facebook.com/groups/1234567890`）。
5. **LINE 官方帳號 + Messaging API channel**（免費）：<https://developers.line.biz/console/>
   - Channel access token（long-lived）
   - Channel secret
   - 把這個官方帳號加進要接收通知的 LINE 群組，並取得群組 ID（第 4 節有一步步教學）
6. **圖片主機（三選一）**
   - `none`：不用準備，只傳文字，截圖留在電腦（最快先跑起來）
   - `s3`（推薦）：Cloudflare R2（免費 10 GB）或任何 S3 相容儲存：bucket、公開讀取網址、Access Key／Secret
   - `local_http`：自己架 HTTPS tunnel（cloudflared／ngrok）指到本機 8787 port

> LINE Notify 已於 2025 年 3 月停止服務，所以這裡只能用 Messaging API；也因此需要上面第 5、6 項。

---

## 2. 安裝（Windows）

以 PowerShell 在專案資料夾執行：

```powershell
cd tools\fb-line-watcher
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # 第一次需要，允許執行本機腳本
.\scripts\setup.ps1
```

`setup.ps1` 會：安裝 npm 依賴、下載 Playwright Chromium、複製 `config\targets.yaml` 與 `.env` 範本、把 `data\` 與 `captures\` 權限限制為目前使用者。

> 若 `npm install` 出現 peer dependency 錯誤，專案已附 `.npmrc`（`legacy-peer-deps=true`），直接重跑即可。
> 想用 Windows 內建 Edge 而不下載 Chromium：把 `targets.yaml` 的 `browser.channel` 改成 `msedge`。

---

## 3. 設定 `config\targets.yaml`

用記事本或 VS Code 打開，至少改這幾行：

```yaml
targets:
  - key: watched_page
    name: 要監看的粉絲專頁
    type: facebook_page
    url: https://www.facebook.com/你的粉專
  - key: group_main
    name: 指定的 Facebook 社團
    type: facebook_group
    url: https://www.facebook.com/groups/社團ID或名稱
    notify_authors: []        # 例：['林大明', '/管理員/'] 只通知這些人；空的 = 全部
```

常用選項（完整說明見 `config\targets.example.yaml` 內的註解）：

| 欄位 | 預設 | 用途 |
| --- | --- | --- |
| `poll_interval_seconds` | 180 | 幾秒巡邏一次。太短會增加 Facebook 安全檢查機率 |
| `comment_debounce_seconds` | 60 | 同一篇貼文的新留言等幾秒合併成一則 |
| `scan_latest_posts` | 8～10 | 每次檢查最新幾篇 |
| `notify_event_types` | 四種都通知 | 只想收貼文可設 `[NEW_POST]` |
| `notify_authors` / `ignore_authors` | 空 | 只通知／忽略特定畫面顯示名稱，支援 `/正規表達式/` |
| `max_notifications_per_day` | 150 | 保護 LINE 額度 |
| `browser.headed` | true | 建議 true（最接近真實畫面）。`--headless` 參數可臨時覆寫 |
| `images.publisher` | none | `none` / `s3` / `local_http` |
| `privacy.redact_phone/email` | true | LINE 文字摘要中遮蔽電話、Email |

**祕密一律放 `.env`，不要寫進 YAML。** `.env`、`data\`、`captures\`、`config\targets.yaml` 都已在 `.gitignore`。

---

## 4. LINE 設定（含取得群組 ID）

### 4.1 建立 Messaging API channel

1. 到 <https://developers.line.biz/console/> 用 LINE 帳號登入 → Create a new provider → Create a Messaging API channel（會同時建立一個 LINE 官方帳號）。
2. 在 channel 的 **Messaging API** 分頁：
   - 下方 **Channel access token (long-lived)** → Issue → 複製到 `.env` 的 `LINE_CHANNEL_ACCESS_TOKEN`
   - **Basic settings** 分頁的 **Channel secret** → 複製到 `LINE_CHANNEL_SECRET`
3. 到 **LINE Official Account Manager**（同頁面有連結）→ 設定 → 回應設定：**關閉「自動回應訊息」**、關閉「加入好友的歡迎訊息」（否則官方帳號會在群組亂講話）；**聊天** 可關閉。
4. Messaging API 分頁 → **Allow bot to join group chats** 設為 Enabled（否則無法加進群組）。

### 4.2 取得 LINE 群組 ID

LINE 群組 ID 只能從 webhook 事件拿到，所以需要跑一次接收器：

```powershell
npm run get-line-ids            # 在 127.0.0.1:3000 等待 webhook
```

另開一個 PowerShell，用 Cloudflare 免費的臨時 tunnel 把它對外（不需帳號）：

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:3000
```

會印出一個 `https://xxxx.trycloudflare.com` 網址。回到 LINE Developers Console → Messaging API → **Webhook URL** 填 `https://xxxx.trycloudflare.com/webhook` → 開啟 **Use webhook** → 按 Verify（應顯示 Success）。

然後用手機：把官方帳號**加入目標 LINE 群組**（群組 → 邀請 → 選官方帳號），在群組裡隨便講一句話。`get-line-ids` 那個視窗會印出：

```
✅ 事件 message（來源 group）→ 群組 ID（groupId）：Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

把它填到 `.env` 的 `LINE_DESTINATION_ID`，確認 `targets.yaml` 的 `line.destination_type: group`。之後可以 Ctrl+C 關掉接收器與 tunnel，並在 Console 關閉 Use webhook（正式運作不需要 webhook）。

> 想改傳給個人：`destination_type: user`，ID 用 Console → Basic settings 最下方的 **Your user ID**（U 開頭）。

### 4.3 測試

```powershell
npm run test-line
```

看到 LINE 群組收到「【fb-line-watcher 測試】」就對了。

---

## 5. 圖片主機設定

### 選項 A：`none`（先跑起來）

`images.publisher: none`。LINE 只收到文字摘要，末行會寫「截圖已存本機：檔名」；截圖在 `captures\日期\target\`。

### 選項 B：Cloudflare R2（推薦）

1. <https://dash.cloudflare.com/> → R2 → Create bucket（例 `fb-line-watcher`）。
2. bucket → Settings → **Public access** → 開啟 **R2.dev subdomain**（會得到 `https://pub-xxxx.r2.dev`）；或綁自己的網域。
3. R2 → **Manage R2 API Tokens** → Create API token → 權限 **Object Read & Write**、限定這個 bucket → 記下 Access Key ID、Secret Access Key，以及頁面上的 S3 endpoint（`https://<account_id>.r2.cloudflarestorage.com`）。
4. `.env`：

```
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=fb-line-watcher
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
```

5. `targets.yaml`：`images.publisher: s3`。檔名是 32 字元亂數，預設 72 小時後自動刪除（`images.retention_hours`）。

（AWS S3 也可以：`S3_ENDPOINT` 留空、`S3_REGION` 填區域、`images.s3.acl: public-read`、`force_path_style: false`。）

### 選項 C：`local_http` + 自己的 HTTPS tunnel

程式會在 `127.0.0.1:8787` 提供圖片；你需要一個**固定網址**的 HTTPS tunnel（Cloudflare Tunnel 具名隧道＋自己的網域，或 ngrok 付費固定網域）指到它，並把網址填 `PUBLIC_BASE_URL=https://img.你的網域`。臨時的 trycloudflare 網址每次重啟都會變，不適合長期。

---

## 6. 第一次登入 Facebook

```powershell
.\scripts\login.ps1        # 或 npm run login
```

會開一個獨立的瀏覽器視窗（專用 profile，存在 `data\browser-profile\`，與你平常的瀏覽器完全分開）。**請自己輸入帳密、完成雙重驗證**。程式偵測到登入成功後，會逐一開啟每個 target 檢查看得到內容，然後關閉視窗。

- 登入狀態會留在 profile 裡，之後不需要再登入，除非 Facebook 要求。
- 程式不讀取、不儲存密碼；也不會把 cookie 寫到日誌或 Git。

---

## 7. 第一次巡邏（baseline）與試跑

```powershell
npm run once
```

第一次只會**建立 baseline**（記住現在畫面上有哪些貼文與留言），**不會通知**。結果類似：

```
✅ watched_page：READY／STRUCTURED（baseline／resync，不通知） 貼文 8、留言 37、信心 0.98
✅ group_main：READY／STRUCTURED（baseline／resync，不通知） 貼文 10、留言 52、信心 0.96
```

接著請人在粉專發一篇測試貼文，再跑一次 `npm run once`，LINE 應在這一輪收到通知。若信心值偏低或貼文數為 0，請跑 `npm run probe` 並看第 11 節。

---

## 7.5 建議：改用手機通知觸發（降低帳號風險）

固定每 3 分鐘巡邏，一天要載入 Facebook 約 480 次，時間點又極規律，這是最容易被判定為機器人的行為。

如果家裡有一支閒置的 Android 手機，可以把它當成觸發器：手機上的官方 Facebook App 收到通知 → MacroDroid 打一個家用區網內的網址 → 電腦這時才去看一次 Facebook。搭配 15 分鐘的安全網間隔，一天載入次數從約 480 次降到約 120 次（降約 75%；安全網改 30 分鐘則約 70 次，降約 85%），時間點也不再那麼規律，而新貼文通知反而更快（數秒而不是最多 3 分鐘）。

要注意的是：Facebook **不會**為「別人貼文底下的新留言」推播通知，所以仍要保留一個較長的安全網間隔來補抓留言。實際效果是**新貼文幾秒內到、留言最慢 15 分鐘到**。

完整設定步驟（含 MacroDroid 畫面設定、防火牆、疑難排解）見 **`PHONE_TRIGGER.md`**。摘要：

```yaml
# config/targets.yaml
poll_mode: triggered
poll_interval_seconds: 900
trigger:
  enabled: true
```

```powershell
npm run trigger-url      # 產生密鑰並印出手機要打的網址
```

不想用手機也沒關係，維持預設的 `poll_mode: interval` 即可，只是建議把 `poll_interval_seconds` 拉長到 300。

---

## 8. 常駐（Windows 工作排程器）

```powershell
.\scripts\install-task.ps1              # 登入 Windows 後自動啟動，異常 2 分鐘後自動重啟
.\scripts\status.ps1                    # 看排程狀態與健康報告
.\scripts\uninstall-task.ps1            # 移除
```

- 任務以「互動登入」身分執行，因此會出現一個黑色命令列視窗與一個瀏覽器視窗（都可縮到最小，不要關閉）。電腦鎖定沒關係，**登出或關機就會停**。
- 想要不顯示視窗：`.\scripts\install-task.ps1 -Headless`（headless 與真實畫面可能略有差異，建議先用 headed 跑穩再考慮）。
- 手動前景執行：`npm run watch`。Ctrl+C 可安全停止。

---

## 9. 真機驗收（請在你的電腦完成）

開發環境無法連 Facebook 與 LINE（網路政策封鎖），所有流程是用「假 Facebook 頁面 + 假 LINE 伺服器」驗證的。請在 Windows 上照下面清單跑 24～48 小時：

1. `npm run once` 兩次：第一次 baseline、第二次零通知。
2. 在粉專發一篇文字貼文、一篇圖片貼文 → 各收到一則通知，截圖清楚。
3. 在社團貼文下新增留言、回覆各一則 → 收到一則合併通知，紅框標在新留言上。
4. 編輯一篇貼文 → 收到「貼文已編輯」。
5. 不動任何內容放 24 小時 → LINE 沒有誤報（或誤報數在你可接受範圍）。
6. 在另一台裝置登出這個 Facebook 帳號的所有 session → 下一輪收到「要求重新登入」警報；`scripts\login.ps1` 重登後恢復。
7. `npm run health` 各 target 為 READY，dead-letter 為 0。

任何一步不符合預期，把 `npm run probe` 產生的 `captures\diagnostics\probe_*.json`（內含畫面可見文字，請先確認可分享）與 `data\logs\` 最新日誌提供給維護者。

---

## 10. 指令一覽

| 指令 | 用途 |
| --- | --- |
| `npm run login` | 手動登入 Facebook（headed） |
| `npm run once [-- --target key] [-- --headless]` | 單次巡邏 |
| `npm run watch [-- --headless]` | 常駐巡邏 |
| `npm run trigger-url` | 產生／印出手機通知觸發用的網址與密鑰 |
| `npm run baseline` | 重建 baseline，不通知 |
| `npm run resync` | 改版／更新 adapter 後重新同步，不把舊內容當新事件 |
| `npm run probe [-- --target key]` | 診斷：印出辨識結果、存截圖與 JSON |
| `npm run health [-- --json]` | 健康報告 |
| `npm run get-line-ids [-- --port 3000]` | 取得 LINE 群組／使用者 ID |
| `npm run test-line` | 發測試訊息 |
| `npm run cleanup` | 立即清理過期截圖與公開圖片 |
| `npm test` | 跑全部自動測試（需 Chromium） |

資料位置：`data\watcher.sqlite`（狀態）、`data\logs\`（日誌，14 天）、`captures\`（證據截圖，30 天）、`data\public\`（local_http 公開圖片，72 小時）、`data\health.json`。

---

## 11. 疑難排解

| 現象 | 原因與處理 |
| --- | --- |
| LINE 收到「要求重新登入」 | Facebook session 失效。到 watcher 電腦跑 `scripts\login.ps1` 重登。watcher 會自動恢復，不用重啟。 |
| 「安全檢查／身分驗證」警報 | Facebook 對這個帳號要求驗證。用 `scripts\login.ps1` 開視窗人工完成。頻繁發生 → 拉長 `poll_interval_seconds`（例 300）、減少 `scan_latest_posts`、改用專用小帳。 |
| 「看不到內容」警報 | 帳號未加入社團／粉專不存在／網址錯。用瀏覽器登入同一帳號確認看得到。 |
| 「無法辨識貼文結構」／`SELECTOR_BROKEN`／`DEGRADED_VISUAL_MODE` | Facebook 改版或頁面異常。`npm run probe -- --target key` 看抽到什麼；依 `ADAPTER_MAINTENANCE.md` 調整 `adapter_overrides` 或更新 catalog；修好後 `npm run resync`。 |
| 一直收到「畫面有變化（降級模式）」 | 降級模式只看畫面像素，廣告輪播也算。這是提醒你盡快修 adapter；不想收可暫時 `visual_fallback_enabled: false`。 |
| 新留言沒被抓到 | 檢查 probe 輸出的「留言 N」與「完整性」。`PARTIAL_EXPANSION` 表示展開次數到上限，調高 `max_comment_expansions_per_post`。Facebook 也可能把留言預設隱藏在「最相關」之外，程式會嘗試切成「所有留言」，切換失敗會記在 probe 的「排序切換」。 |
| 通知太多 | 用 `notify_authors` 只看群主／管理員、`notify_event_types` 只收貼文、拉長 `comment_debounce_seconds`。 |
| 「今日通知已達上限」 | `max_notifications_per_day` 到了。提高上限或換 LINE 方案。 |
| LINE 401 | token 錯或被撤銷，重新 Issue。 |
| LINE 400「to is invalid」 | 群組 ID 錯，或官方帳號被移出群組。重跑第 4.2 節。 |
| LINE 429 | 訊息額度或速率限制。 |
| 圖片沒顯示只有文字 | `images.publisher` 為 none，或 R2 公開網址錯（用瀏覽器直接開 `S3_PUBLIC_BASE_URL/任一檔名` 測）。 |
| 手機觸發網址顯示 `unauthorized` 或連不上 | 見 `PHONE_TRIGGER.md` 的疑難排解表。 |
| 「另一個 watcher 正在執行」 | 已有實例在跑（排程任務）。要手動跑先 `scripts\uninstall-task.ps1` 或結束 node.exe；確定沒在跑可刪 `data\watcher.lock`。 |
| profile 正被使用 | `npm run login` 的視窗還開著，關掉再跑。 |

---

## 12. 已知限制（明說）

- 只能看到「當次巡邏中已載入、已展開、登入帳號可見」的內容，不保證 100% 擷取所有留言。
- Facebook 依帳號、地區、語言、A/B 測試可能顯示不同結構；預設規則以 zh-TW 介面為主並含英文 fallback，其他語言需覆寫 catalog。
- 沒有 permalink 的貼文（少數情況）以「作者＋時間＋文字前綴」識別；此類貼文被編輯會被視為新貼文而非編輯。
- 沒有 permalink 的留言被編輯，會被視為新留言。
- 「已刪除」不會通知（避免誤報），只在資料庫標記。
- 視覺降級模式無法分辨是哪一則貼文或留言，也可能把廣告輪播當變化。
- 截圖上的個資遮罩（`redact_in_screenshot`）是盡力而為的文字模糊，圖片內的電話無法遮。
- 抽取結果不是 Facebook 官方資料；通知文案中的「完整性」欄位會誠實標示 `PARTIAL_EXPANSION`。

---

## 13. 專案結構

```
tools/fb-line-watcher/
├─ src/
│  ├─ cli.ts                    命令列入口（login/watch/once/probe/…）
│  ├─ app.ts                    組裝設定、DB、logger、publisher、LINE client、瀏覽器
│  ├─ config/                   zod schema 與 YAML／.env 載入、fail-fast 驗證
│  ├─ browser/                  專用 persistent profile、登入流程、登入／驗證頁判定、畫面穩定化
│  ├─ adapters/                 selector catalog（可覆寫）、頁面內 DOM 抽取、展開留言、粉專／社團 adapter
│  ├─ extract/                  文字正規化、entity key／content hash、個資遮罩
│  ├─ detect/                   實體比對（新增／編輯／留言／回覆）、留言合併、視覺降級 dHash
│  ├─ capture/                  元素截圖＋紅框標記、資訊條合成 JPEG／預覽圖
│  ├─ publish/                  圖片發布器：none / local_http / S3(R2)
│  ├─ line/                     Messaging API client（X-Line-Retry-Key 冪等）、通知文案與投遞重試、群組 ID 接收器
│  ├─ storage/                  node:sqlite migration 與 repository
│  └─ worker/                   單實例鎖、每個 target 的巡邏週期、排程迴圈、手機觸發伺服器、健康報告
├─ fixtures/                    假 Facebook 頁面伺服器與假 LINE API（測試用）
├─ tests/unit, tests/integration 單元與 Chromium 端對端測試
├─ scripts/                     Windows PowerShell：setup / login / install-task / uninstall-task / status
├─ config/targets.example.yaml  設定範本
├─ docs/samples/                四種事件的範例截圖
├─ PHONE_TRIGGER.md             用手機通知觸發（降低帳號風險）
├─ SECURITY.md                  安全與隱私
├─ ADAPTER_MAINTENANCE.md       Facebook 改版後怎麼修
└─ ACCEPTANCE_REPORT.md         驗收報告（測試證據、GO/NO-GO）
```
