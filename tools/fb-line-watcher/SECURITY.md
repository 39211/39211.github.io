# 安全與隱私（SECURITY.md）

## 授權範圍

- 本程式只監看**使用者明確授權、且登入帳號本來就看得到**的 Facebook 粉絲專頁與社團畫面。
- 不嘗試取得未授權的私人內容；帳號看不到的，程式也看不到。
- 不自動發文、不自動回覆、不刪改任何 Facebook 內容。
- **不做**：CAPTCHA 破解、繞過登入／雙重驗證、帳號冒用、瀏覽器指紋偽裝、反偵測外掛、代理輪換。遇到平台限制只會停止並通知人工。

## 憑證與祕密

| 項目 | 存放位置 | 說明 |
| --- | --- | --- |
| Facebook 密碼 | **不存放** | 由使用者在瀏覽器視窗中親自輸入 |
| Facebook 登入狀態（cookie 等） | `data/browser-profile/`（瀏覽器自己的加密儲存） | 程式只檢查 `c_user` cookie 是否存在，不讀取值、不寫入日誌 |
| LINE Channel access token / secret、目的地 ID | `.env`（僅本機） | 啟動時載入到記憶體；日誌中自動替換為 `[REDACTED]` |
| S3／R2 金鑰 | `.env` | 同上 |

- `.env`、`data/`、`captures/`、`config/targets.yaml`、`*.sqlite`、`*.log` 全部列於 `.gitignore`，不會進 Git。
- `scripts/setup.ps1` 會以 `icacls` 把 `data/` 與 `captures/` 限制為目前 Windows 使用者與 SYSTEM 可存取。
- 日誌遮罩（`src/logger.ts`）：已註冊的祕密字串、`Bearer …`、`c_user=`/`xs=` 等 cookie、LINE 的 `C/U/R` 開頭 33 字元 ID、以及 `authorization`/`cookie`/`token`/`secret`/`password` 等鍵名一律遮罩。有單元測試保證。

## 截圖與個資

- 截圖是**授權帳號畫面上本來就看得到的內容**；只截取事件所在的貼文容器，不會截到瀏覽器其他分頁、密碼管理器或桌面通知（元素截圖）。
- LINE 文字摘要預設遮蔽台灣手機／市話與 Email（`privacy.redact_phone/redact_email`）。
- 截圖內的文字個資遮罩（`privacy.redact_in_screenshot`）是盡力而為的模糊處理；圖片內的文字無法遮蔽。遮罩失敗會發系統警報，不會靜默。
- 公開圖片：檔名為 128-bit 亂數，網址不可猜測；預設 72 小時後自動刪除（`images.retention_hours`）。R2 建議只開 r2.dev 公開讀取、不要開列目錄。
- 本機證據截圖預設保留 30 天（`retention.local_capture_days`），日誌 14 天。
- `probe` 產生的診斷 JSON 含畫面可見文字；分享給他人前請自行確認內容。

## 網路面

- 對外連線只有：Facebook（瀏覽器）、`api.line.me`（LINE Messaging API）、你設定的圖片主機。
- `local_http` 圖片伺服器預設只綁 `127.0.0.1`，僅回應符合 `^[a-f0-9]{32}(_p)?\.jpg$` 的檔名，不列目錄、不跟隨路徑。
- `get-line-ids` webhook 接收器只在你手動執行時存在，會驗證 LINE 簽章（`LINE_CHANNEL_SECRET`）。
- 手機觸發伺服器（`trigger.enabled`）綁在家用區網，以固定長度比較的隨機 token 驗證，且有最小間隔節流。它唯一能做的事情是「要求 watcher 立即巡邏一次」——無法讀取資料、無法改設定、無法取得截圖。token 不足 16 字元時啟動即失敗，日誌中一律遮罩。**不要把這個 port 轉發到網際網路**；跨網路請改用 Tailscale 之類的私有網路。

## 帳號風險與建議

- Facebook 使用條款限制自動化存取，帳號可能被要求驗證或暫時限制。降低風險依序為：改用手機通知觸發模式（`PHONE_TRIGGER.md`，載入次數約可降 75～85%，視安全網間隔而定）、拉長 `poll_interval_seconds`、減少 `scan_latest_posts`、在可行時使用專用帳號（私密社團必須用已是成員的帳號）。
- 程式不會替你通過任何驗證。收到「要求重新登入／安全檢查」警報時，請人工在 `npm run login` 的視窗處理。

## 回報安全問題

若發現祕密洩漏到日誌、截圖或公開網址，請立即：撤銷 LINE token（Developers Console → Issue 新 token 並刪除舊的）、輪替 R2 金鑰、在 Facebook 安全設定登出所有裝置，然後回報維護者。
