# 純手機模式：手機收通知 → 電腦轉發到 LINE

這是三種模式裡**帳號風險最低**的一種：電腦完全不連 Facebook，唯一的 Facebook session 是手機上的官方 App，行為 100% 正常。

```
手機（官方 FB App）→ 收到通知
  → MacroDroid 讀自己的通知、依發話者過濾
  → POST 到家裡電腦（文字 + 可選截圖）
     → 電腦去重、合併、發 LINE
```

## 三種模式怎麼選

| | 抓得到什麼 | 電腦連 Facebook？ | 維護成本 |
| --- | --- | --- | --- |
| `interval` / `triggered`（瀏覽器巡邏） | 貼文全文、圖片、留言、回覆、編輯，有 permalink，可精準截圖 | 會 | Facebook 改版要更新 adapter |
| **`phone_ingest`（純手機）** | **Facebook 通知推播的內容**，文字完整（bigText），可附手機截圖 | **不會** | 幾乎不用維護 |
| 兩者並用 | 兩邊都有，各自去重 | 會 | 同上 |

**純手機模式抓不到的**：Facebook 沒有推播通知的東西就抓不到。最主要是**別人貼文底下的留言**——除非你有參與那則貼文，否則 Facebook 不會通知你。想要完整的留言覆蓋，還是要開瀏覽器巡邏。

## 為什麼是「文字為主、截圖為輔」

Android 的通知本身就帶結構化欄位：標題、內文、以及未截斷的 `bigText`。MacroDroid 的通知觸發器能直接讀到這些，還能用正規表達式過濾。所以：

- **文字是主路徑**，純 HTTP POST，不需要任何特殊權限，一定會動。
- **截圖是可選加值**。手機截圖需要額外權限（見下方），拿不到也不影響其他功能。

---

## 步驟一：電腦端

`config/targets.yaml`：

```yaml
# 純手機模式可以完全不設 target（電腦不開瀏覽器、不連 Facebook）
targets: []

phone_ingest:
  enabled: true
  port: 8800
  bind: 0.0.0.0                 # 手機要連得到；僅限家用網路
  dedup_window_seconds: 600     # 這段時間內同一則通知只處理一次
  debounce_seconds: 45          # 收到後等一下，把連續通知合併成一則 LINE
  max_items_per_message: 10
  notify_authors: []            # 例：['林大明'] 或 ['/^林/'] 只收群主
  ignore_authors: []
  require_text_match: []        # 例：['聚會'] 內文要含關鍵字才通知
  allowed_packages: [com.facebook.katana, com.facebook.lite]
  allow_missing_package: false  # 觸發器沒帶 pkg 時是否放行；預設擋掉（fail-closed）
  max_image_bytes: 8388608      # 單張截圖大小上限
  max_image_pixels: 40000000    # 解碼後像素數上限，擋解壓炸彈
```

> **`pkg` 一定要帶。** `allowed_packages` 非空時，沒有帶 `pkg` 的請求會被擋下（回 `filtered:package_missing`），
> 避免 MacroDroid 變數沒填好或別的程式亂送時繞過 Facebook 限制。真的需要放行才把 `allow_missing_package` 設為 `true`。
>
> **截圖會被真正解碼驗證。** 只有 JPEG／PNG 標頭、內容是垃圾的資料會被拒絕（通知文字仍會送出，只是沒有圖），
> PNG 會保留 `.png` 副檔名與 `image/png`，不會被謊報成 JPEG。

想同時保留瀏覽器巡邏就照常填 `targets`，兩種來源會各自去重、互不干擾。

產生密鑰與網址：

```powershell
npm run phone-url
```

第一次會印出 `PHONE_INGEST_TOKEN=...`，貼進 `.env`，再跑一次就會印出手機要填的完整網址。

防火牆（系統管理員 PowerShell，只開放私人網路）：

```powershell
New-NetFirewallRule -DisplayName "fb-line-watcher phone ingest" -Direction Inbound -LocalPort 8800 -Protocol TCP -Action Allow -Profile Private
```

先用手機瀏覽器開 `http://<電腦IP>:8800/health`，看到一行文字才代表通得了。

---

## 步驟二：手機端（MacroDroid）

手機準備：安裝官方 Facebook App、登入、對粉專和社團都開「所有貼文」通知，Facebook 與 MacroDroid 的電池最佳化都設成「不受限制」。

### 巨集 A：轉發通知文字（必做）

**觸發器**：`通知` → `收到通知`
- 應用程式：勾選 `Facebook`
- 想在手機端就先過濾，可開啟「分開標題與訊息」，在標題欄填發話者（支援正規表達式）

**動作**：`網路` → `HTTP 請求`
- 方法：`POST`
- URL：貼上 `npm run phone-url` 印出的那一行，形如

```
http://192.168.1.23:8800/phone/notify?token=xxxx&title=[not_title]&text=[notification]&pkg=[not_app_package]
```

`[not_title]`、`[notification]`、`[not_app_package]` 是 MacroDroid 的魔術文字，長按 URL 欄位可以插入。

**限制條件**（建議）：`連線` → `Wi-Fi 已連線`，離開家時不會白打。

這樣就會動了。收到通知幾秒內 LINE 就有訊息。

### 巨集 B：加上截圖（可選）

在巨集 A 的 HTTP 動作前面插入一個「截圖」動作，把檔案存到固定路徑，然後把 HTTP 請求的 body 設成「檔案內容」指向那個檔案。

> MacroDroid 不支援 multipart/form-data 上傳，所以圖片是以**原始位元組當 body** 送出，接收端已經配合這個做法：body 開頭是 JPEG 或 PNG magic bytes 就當截圖，否則忽略。

**截圖權限**是這一段唯一的門檻：

- **Android 13 或更早**：MediaProjection 的同意對話框通常可以記住選擇，比較容易做到無人值守。
- **Android 14 以後**：規定每次擷取都要重新同意，無 root 幾乎無法自動化。**所以要做截圖請用 Android 13 或更早的手機。**
- 另一條路是用 ADB 授權 MacroDroid Helper（`adb shell pm grant com.arlosoft.macrodroid.helper android.permission.WRITE_SECURE_SETTINGS`），一次性設定，重開機後仍有效。需要接電腦跑一次。

拿不到截圖權限也沒關係，巨集 A 單獨就能運作。

---

## 疑難排解

| 現象 | 處理 |
| --- | --- |
| 手機開 `/health` 連不上 | 不同 Wi-Fi、電腦 IP 變了、或防火牆擋住。建議在路由器把電腦設成固定 IP。 |
| 回應 `unauthorized` | `.env` 的 token 與網址上的不符，重跑 `npm run phone-url`。 |
| 回應 `filtered:author_not_in_allowlist` | 正常，`notify_authors` 把這位發話者擋掉了。 |
| 回應 `filtered:package_not_allowed:...` | 觸發器沒限定 Facebook，或該 App 不在 `allowed_packages`。 |
| 回應 `filtered:package_missing` | 請求沒有帶 `pkg` 參數。在 MacroDroid 的網址加上 `&pkg=[not_app_package]`。 |
| 回應 `duplicate` | 正常，去重視窗內的同一則通知。 |
| 回應 `413` | 截圖超過 `max_image_bytes`，調高上限或在手機端先壓縮。 |
| LINE 收到文字但沒有圖 | 截圖動作沒成功，或 `images.publisher` 是 `none`。LINE 只能顯示公開 HTTPS 圖片，見 README 第 5 節。 |
| 完全沒收到通知 | Facebook App 的粉專／社團通知沒設「所有貼文」，或 MacroDroid 沒拿到通知存取權，或被電池最佳化擋掉。 |
| 留言收不到 | 預期行為。Facebook 不會為別人貼文底下的留言推播通知，要完整覆蓋請併用瀏覽器巡邏。 |

## 安全性

- 接收埠只開在家用區網，用固定長度比較的隨機 token 驗證，超量 body 直接回 413 並中斷連線。
- **不要把這個 port 轉發到網際網路。** 跨網路請改用 Tailscale 之類的私有網路，把 `bind` 指到該介面。
- token 至少 16 字元，啟動時檢查，日誌一律遮罩。
- 手機端沒有任何東西從外部連進來：MacroDroid 只是讀自己手機的通知，然後主動往外送。

## 尚未在真機驗證

以下在開發環境用模擬手機測過（24 項自動測試），但**沒有真的 Android 裝置可測**：

1. MacroDroid 的魔術文字在真實 Facebook 通知上實際會帶出什麼內容（尤其社團留言的標題格式）。
2. MacroDroid 以「檔案內容」當 body 送出圖片的實際行為。
3. Android 13 的截圖權限能否真的記住選擇。
4. Facebook 對粉專貼文與社團貼文各自送出的通知樣式。

請先只做巨集 A（純文字），確認能通之後再加截圖。第一次收到通知後，`npm run health` 或直接看 `data/watcher.sqlite` 的 `phone_notifications` 表，就能知道實際收到的 `title` 與 `body_text` 長什麼樣，再據以設定 `notify_authors`。
