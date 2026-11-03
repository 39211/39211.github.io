# WO-009 手機截圖直接當 LINE 預覽圖，超過 LINE 的 1MB 上限

- 提出：雲端深審席三 ／ 嚴重度：**P1** ／ 依據程式碼路徑，**未經真實 LINE 驗證**

## 問題

`src/worker/scheduler.ts:109-110` 把同一個檔案同時當成 `screenshotPath` 與 `previewPath`，
`src/line/notifier.ts:190` 就把它同時填進 `originalContentUrl` 與 `previewImageUrl`，
中間**沒有任何縮圖或大小檢查**。

專案自己知道這個限制：`src/capture/compose.ts:65` 註明「原圖 ≤10MB、預覽 ≤1MB」，
瀏覽器路徑用 `max_preview_bytes`（950,000）壓到符合（`compose.ts:84-90`）。
**手機路徑完全繞過 `composeEvidence`**，唯一上限是 `max_image_bytes`，預設 **8MB**（`schema.ts:108`）。

Android 手機截圖典型是 1080×2400 PNG、1～3MB，遠超 1MB 預覽上限 →
LINE 端預覽圖不顯示／訊息被拒。**這是預設設定下的常態，不是邊角案例。**

## 1. 標的檔案與函式

`src/worker/scheduler.ts:95-115`（`flushPhoneNotifications` 組事件）、
`src/line/notifier.ts:185-200`（`buildMessages`）、`src/util/image.ts`（可能需要縮圖能力）

## 2. 規格（逐條可驗）

1. 手機路徑必須為截圖產生**獨立的預覽圖**，位元組數 ≤ `images.max_preview_bytes`（預設 950,000）。
2. 原圖同樣要受 `images.max_original_bytes` 約束；超過就縮，不要直接送。
3. 縮圖不得引入新的原生相依（Windows 上不能有編譯步驟）。可用的既有手段：
   `pngjs`（已是相依）做降採樣，或沿用 `composeEvidence` 走 Chromium —— 但**純手機模式不會開瀏覽器**，
   所以走 Chromium 的方案必須在瀏覽器不可用時有純 JS 退路。
4. 縮圖失敗時的行為：**送出文字訊息、略過圖片**，不得因此丟掉整則通知。
5. `buildMessages` 加一道防呆：`previewImageUrl` 對應的檔案若超過 1MB，寧可不附圖也不要送出會被 LINE 拒絕的訊息。

## 3. 驗收（測試／突變）

1. 餵一張 1080×2400 的真 PNG（用 `fixtures/images.ts` 的 `tinyPng` 放大產生）→
   事件的 preview 檔 ≤ 950,000 bytes，且仍是合法可解碼的圖。
2. 餵一張小圖 → 不做多餘處理，行為不變。
3. 縮圖故意失敗 → 仍送出文字訊息，`messages` 長度為 1。
4. **真實 LINE 驗證（真機 B 段）**：手機截圖經此路徑送出後，LINE 上原圖與預覽圖都要看得到。
   這條不能只靠假 LINE，必須列進真機驗收清單。

指令：`npm run typecheck && npm test`。不得刪測試或放寬斷言。

## 4. 可寫路徑白名單

```
src/worker/scheduler.ts
src/line/notifier.ts
src/util/image.ts
fixtures/images.ts
tests/unit/image.test.ts
tests/integration/phone-ingest.test.ts
```

禁止：`src/capture/**`、`src/detect/**`、`src/publish/**`、`.github/**`。
