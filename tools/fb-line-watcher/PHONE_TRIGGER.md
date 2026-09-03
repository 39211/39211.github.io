# 用手機通知當觸發器（大幅降低帳號風險）

## 為什麼要這樣做

固定每 3 分鐘巡邏一次，一天會載入 Facebook 約 480 次，而且時間點極規律——這是最容易被判定成機器人的行為。

改成「手機收到 Facebook 通知，才叫電腦去看一次」之後：

一天實際載入 Facebook 的次數 = **固定的安全網巡邏** + **通過節流的觸發次數**。前者可以精確算出，後者取決於粉專與社團實際有多少動態，**不是固定保證值**：

| 設定 | 安全網巡邏（固定） | 觸發次數（隨動態量變動） | 一天合計 | 相對於每 3 分鐘 |
| --- | --- | --- | --- | --- |
| `interval` + 180 秒 | 480 次 | — | **480 次** | 基準 |
| `triggered` + 900 秒（15 分鐘） | 96 次 | 每天 10～30 則通知 → 10～30 次 | **約 110～130 次** | 降約 75% |
| `triggered` + 1800 秒（30 分鐘） | 48 次 | 同上 | **約 60～80 次** | 降約 85% |

上表的「10～30 次」是假設粉專與社團**合計一天有 10～30 則會產生手機通知的動態**。這個假設要自己驗證：先照 `poll_mode: interval` 跑一兩天，看 `npm run health` 的今日事件數，大致就是你會收到的通知量級。

**觸發次數的上限由 `min_interval_seconds` 決定**，公式是 `86400 ÷ min_interval_seconds`：

| `min_interval_seconds` | 觸發次數理論上限／天 |
| --- | --- |
| 20（預設） | 4320 |
| 60 | 1440 |
| 120 | 720 |
| 300 | 288 |

也就是說，**如果社團非常熱鬧，觸發模式反而可能比固定週期載入更多次**。若你的社團一天有上百則貼文與留言通知，請把 `min_interval_seconds` 調到 120～300，讓觸發次數有明確天花板；此時通知延遲最多就是這個秒數，仍遠快於 3 分鐘。

除了次數變少，時間分布也不一樣：

| | 固定週期 | 手機觸發 |
| --- | --- | --- |
| 時間分布 | 每 3 分鐘一次，極規律 | 安全網間隔較長，加上跟著真人發文時間的不規律觸發 |
| 行為看起來像 | 機器人輪詢 | 偶爾看一下、收到通知就去看的人 |
| 新貼文通知速度 | 最慢 3 分鐘 | 數秒 |
| 新留言通知速度 | 最慢 3 分鐘 | 最慢等於安全網間隔 |

**安全網間隔是速度與風險的取捨**：設 900 秒，留言最慢 15 分鐘到；設 1800 秒，留言最慢 30 分鐘到。先從 900 開始，若帳號常被要求驗證再調到 1800。

**怎麼知道實際載入了幾次**：`npm run health` 會顯示每個 target 的最近抽取紀錄，`data/watcher.sqlite` 的 `extractor_health` 表每成功掃描一次就新增一列，直接數當天的列數就是真實載入次數。跑一兩天後用實測值回頭調整 `poll_interval_seconds` 與 `min_interval_seconds`。

手機端做的事情，Facebook 完全看不到：MacroDroid 只是讀取**你自己手機上的通知**，然後打一個你家區網內的網址。手機上跑的是官方 Facebook App，行為 100% 正常。

## 重要限制：留言不一定會有通知

Facebook 只在下列情況推播通知：

- 你追蹤的粉專發新貼文（需開啟「所有貼文」通知）
- 社團發新貼文（需把社團通知設為「所有貼文」）
- 有人留言在**你自己發的貼文**、或**你留言過的貼文**底下

所以「別人貼文底下的新留言」多半**不會**產生手機通知。這就是為什麼即使用了觸發模式，仍然要保留一個較長的安全網巡邏間隔（建議 `poll_interval_seconds: 900`，也就是 15 分鐘）來補抓留言。

結論：**新貼文幾秒內就到，留言最慢 15 分鐘到。** 這是目前不動用 API 又能兼顧風險的最佳平衡。

---

## 步驟一：電腦端設定

編輯 `config/targets.yaml`：

```yaml
poll_mode: triggered
poll_interval_seconds: 900      # 安全網：補抓不會產生手機通知的留言

trigger:
  enabled: true
  port: 8799
  bind: 0.0.0.0                 # 手機要連得到，所以綁全部介面（僅限家用網路）
  min_interval_seconds: 20      # 一串通知同時進來時，20 秒內只巡邏一次
  delay_seconds: 8              # 收到通知後等 8 秒再看，讓網頁端內容跟上
```

產生密鑰並取得網址：

```powershell
npm run trigger-url
```

第一次會印出一行 `TRIGGER_TOKEN=...`，把它貼進 `.env`，再執行一次，就會印出完整網址，像這樣：

```
  http://192.168.1.23:8799/trigger?token=xxxxxxxx&source=macrodroid
```

把這個網址複製下來。

**固定電腦的區網 IP**：路由器重開後 IP 可能會變，網址就失效了。請到路由器管理頁面找「DHCP 保留」或「靜態 IP 綁定」，把這台電腦綁成固定 IP。

**Windows 防火牆**：第一次啟動 `npm run watch` 時會跳出詢問，請勾選「私人網路」並允許。若沒跳出，用系統管理員 PowerShell 執行：

```powershell
New-NetFirewallRule -DisplayName "fb-line-watcher trigger" -Direction Inbound -LocalPort 8799 -Protocol TCP -Action Allow -Profile Private
```

---

## 步驟二：手機端設定

準備一支可以一直插著電、連著家裡 Wi-Fi 的 Android 手機。

### 1. Facebook App

1. 安裝 Facebook App，登入**與電腦端 watcher 相同的那個帳號**。
2. 開啟粉專頁面 → 「追蹤中」→ 通知 → 選「所有貼文」。
3. 開啟社團頁面 → 右上角通知鈴鐺 → 選「所有貼文」。
4. 手機設定 → 應用程式 → Facebook → 通知 → 全部開啟。
5. 手機設定 → 應用程式 → Facebook → 電池 → 選「不受限制」（否則背景通知會被系統延遲或擋掉）。

### 2. MacroDroid

從 Google Play 安裝 [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid)（免費版可建立 5 個巨集，夠用）。

建立一個巨集：

**觸發器（Trigger）**
- 類別：`通知` → `收到通知`
- 應用程式：勾選 `Facebook`
- 其他欄位留空（不要填關鍵字，否則會漏掉）

**動作（Action）**
- 類別：`網路` → `HTTP 請求`
- 方法：`GET`
- URL：貼上 `npm run trigger-url` 印出的網址

想在日誌裡看到是哪一則通知觸發的，可以在網址後面加上 MacroDroid 的變數：

```
...&source=macrodroid&text=[notification_title]
```

（在 URL 欄位長按可以插入 `notification_title` 這類魔術變數。）

**限制條件（Constraint，可選）**
- `連線` → `Wi-Fi 已連線`：只在家裡的 Wi-Fi 才觸發，離開家時不會白打。

**權限**
- MacroDroid 會要求「通知存取權」，必須允許，否則讀不到通知。
- 手機設定 → 應用程式 → MacroDroid → 電池 → 「不受限制」。

### 3. 測試

1. 電腦執行 `npm run watch`，畫面上會印出觸發伺服器已啟動。
2. 手機瀏覽器直接開那個觸發網址，應該顯示 `accepted`，電腦端日誌出現「收到手機觸發，立即巡邏」。
3. 請人在粉專發一篇測試貼文 → 手機跳出 Facebook 通知 → 十幾秒內 LINE 群組就該收到截圖通知。

---

## 疑難排解

| 現象 | 處理 |
| --- | --- |
| 手機開網址顯示 `unauthorized` | `.env` 的 `TRIGGER_TOKEN` 與網址上的 token 不一致。重新執行 `npm run trigger-url`。 |
| 手機開網址連不上 | 手機不在同一個 Wi-Fi、電腦 IP 變了、或防火牆擋住。先用電腦自己開 `http://127.0.0.1:8799/trigger?token=...` 確認伺服器活著，再檢查 IP 與防火牆。 |
| 顯示 `throttled` | 正常。表示 20 秒內已經巡邏過，這次不重複。 |
| 手機有通知但沒觸發 | MacroDroid 沒有通知存取權，或被電池最佳化殺掉。兩者都要設成「不受限制」。 |
| 一直沒有手機通知 | Facebook App 的粉專／社團通知沒設成「所有貼文」，或系統通知被關閉。 |
| 留言沒有即時通知 | 這是預期行為（見上方「重要限制」）。留言靠 `poll_interval_seconds` 的安全網巡邏補抓。 |
| 想暫時改回固定週期 | `targets.yaml` 把 `poll_mode` 改回 `interval`、`poll_interval_seconds` 改成 180 即可，不需要動手機。 |

## 安全性

- 觸發網址是家用區網內的 **HTTP**，token 是唯一的保護。任何連得上你家 Wi-Fi 的裝置只要知道 token 就能觸發一次巡邏（也僅止於此——無法讀取資料、無法改設定）。
- **絕對不要把 8799 這個 port 轉發到網際網路。**
- token 至少 16 個字元，程式會在啟動時檢查；日誌中一律遮罩。
- 想跨網路使用（例如電腦放在別的地方），請用 [Tailscale](https://tailscale.com/) 之類的私有網路，把 `bind` 設成 Tailscale 介面的 IP，不要開公網。
