# WO-012 圖片驗證本身的兩個洞：68 bytes 就能打死 watcher，16 bytes 垃圾照樣存成 .jpg

- 提出：雲端深審席二 ／ 嚴重度：**P0 + P1** ／ 深審席已走真實 HTTP endpoint 重現，規劃席已逐行確認
- 背景：`src/util/image.ts` 是**上一輪為了修「只看 magic bytes」而新增的檔案**。它本身有這兩個洞。

## 缺陷一（P0）：PNG 的像素上限在 pngjs 解碼**之後**才檢查

`src/util/image.ts:41`（`PNG.sync.read(buf)`）→ `:45`（`checkSize`）

```ts
png = PNG.sync.read(buf);          // ← 先整份解碼，依 IHDR 宣告配置 w × h × 4 bytes
...
checkSize(png.width, png.height, o);  // ← 才檢查 maxPixels / maxWidth / maxHeight
```

配置發生在任何檢查之前，所以那三個上限對 PNG **完全是裝飾品**。

深審席實測（真伺服器 + `fetch` POST，body 就是原始位元組，`max_image_bytes` 預設 8MB 擋不住 68 bytes）：

| POST body | IHDR 宣告 | 結果 |
|---|---|---|
| 68 bytes | 20000×20000 | event loop **卡死 25.6 秒**，RSS **4694 MB**，然後才回 `200 accepted` |
| 68 bytes | 30000×30000 | RSS **10391 MB**，卡 44 秒 |
| 68 bytes | 40000×40000 | **OOM killer SIGKILL，exit 137** —— 無例外、無日誌，watcher 直接消失 |

`--max-old-space-size` 擋不住（pngjs 配的是 off-heap Buffer）。
20000×20000 剛好等於 `maxWidth`／`maxHeight` 預設值，所以**光把 `checkSize` 挪到解碼前還不夠**，
必須連 `maxPixels` 一起在解碼前檢查。

需要 ingest token，但這條的意義不只在惡意攻擊：**手機端傳來一張 IHDR 被截斷或損毀的 PNG 就足以觸發**，
而這正是這份程式碼自己宣稱要防的「畸形輸入」。

## 缺陷二（P1）：JPEG 只要看到第一個 SOF 就回傳成功

`src/util/image.ts:89-93`

**(a)** 第 90 行 `if (offset + 7 > buf.length)` 的邊界用**整個 buffer**，沒有檢查 `length >= 8`。
一個宣告 `length = 2`（空段落）的 SOF0，寬高會從**段落外面**的位元組讀出來。

**(b)** 第 93 行在第一個 SOF 就 `return`，全程不要求 DHT、不要求 SOS、不要求任何 entropy data。
`sawEntropyData`（第 67／78／97 行）是**死碼**：唯一賦值在第 97 行，第 98 行緊接著無條件 throw，
所以第 78 行的條件恆為真、第 79 行永遠到不了。

深審席端到端重現（`ingestNotification`，非只測 `validateImage`）：

```
FF D8  FF C0  00 02  DE  00 64  00 64  AD BE EF BA AD      ← 16 bytes
       SOF0   len=2      ↑height ↑width  ——— 都在段落外
```
→ `{"status":"accepted","hasImage":true}` → 落地成 `.jpg` → `image_path` 進 DB
→ 後續當截圖附進 LINE 訊息、以 `Content-Type: image/jpeg` 發佈。任何解碼器都開不起來。

另一變體：21 bytes「只有標頭的 JPEG」（合法 SOF0 宣告 1024×1024，之後直接 EOF）同樣 accepted。

**現有 fixture 給的是假的安全感**：`FAKE_JPEG`（`FF D8 FF E0` + 200×`0x41`）被擋只是因為
`0x4141` 當長度時越界；改成合法 APP0 再接一個 `len=2` 的 SOF 就穿過去了。

## 1. 標的檔案與函式

`src/util/image.ts`（`validateImage` 的 PNG 分支、`parseJpeg`、`checkSize`）、
`fixtures/images.ts`（需要新的對抗性樣本）

## 2. 規格（逐條可驗）

1. **PNG 必須在解碼前**從 IHDR 直接讀出 `width`／`height`（PNG 標頭固定：8 bytes 簽章 + 4 長度 + 4 型別 `IHDR` + 4 寬 + 4 高），
   先跑完整的 `checkSize`（含 `maxPixels`、`maxWidth`、`maxHeight`），通過才呼叫 `PNG.sync.read`。
2. IHDR 不完整、型別不是 `IHDR`、寬或高為 0 → `InvalidImageError`，不得進入解碼。
3. 解碼後再比對一次「解出來的尺寸 == IHDR 宣告的尺寸」，不符則 `InvalidImageError`（防宣告與實際不一致）。
4. **JPEG 的 SOF 段落長度必須自洽**：SOF 至少 8 bytes（`length` 欄位本身 2 + precision 1 + height 2 + width 2 + components 1），
   `length < 8` 一律 `InvalidImageError`；讀 height／width 前的邊界要用 `offset + length`，不是 `buf.length`。
5. **JPEG 不得在第一個 SOF 就回傳。** 必須繼續走到 **SOS（`0xDA`）** 並確認其後存在 entropy-coded 資料，才算有效。
   `sawEntropyData` 的死碼要一併修好或刪除 —— 不得留著一段永遠不會執行的邏輯。
6. 第 5 條會改變「SOF 之前出現 SOS」的既有 throw 行為，請確認 `docs/samples/*.jpg` 四張真實截圖仍然通過。
7. 不得放寬任何既有上限的預設值。

## 3. 驗收（測試／突變）

**新增 fixture**（`fixtures/images.ts`）：`PNG_BOMB_HEADER`（68 bytes，IHDR 宣告 20000×20000）、
`JPEG_EMPTY_SOF`（上面那 16 bytes）、`JPEG_HEADER_ONLY`（21 bytes）。

**新增回歸測試**（`tests/unit/image.test.ts`），至少：

1. `PNG_BOMB_HEADER` → 丟 `InvalidImageError`，且**整個呼叫在 100ms 內完成**（用計時斷言，證明沒有進解碼）。
2. 同上，走 `ingestNotification` → `hasImage: false`，磁碟上沒有檔案。
3. `JPEG_EMPTY_SOF` 與 `JPEG_HEADER_ONLY` → 丟 `InvalidImageError`。
4. `docs/samples/` 四張真實 JPEG 與 `TINY_JPEG`、`tinyPng()` **仍然全部通過**。
5. IHDR 宣告與實際解碼尺寸不符的 PNG → 丟 `InvalidImageError`。

**驗收指令**：`npm run typecheck && npm test`
**通過條件**：全綠、項數 ≥ 148 + 新增；不得刪測試或放寬斷言。
**突變**：把 `checkSize` 移回 `PNG.sync.read` 之後 → 測試 1 的計時斷言必須失敗。

⚠️ 寫測試時**不要**用 40000×40000 那組（會把跑測試的機器 OOM 掉）。20000×20000 已足以證明。

## 4. 可寫路徑白名單

```
src/util/image.ts
fixtures/images.ts
tests/unit/image.test.ts
```

禁止：`src/worker/**`、`src/publish/**`、`src/detect/**`、`.github/**`、
**`tests/unit/phone-ingest.test.ts`（WO-005 獨佔）**。

> 第 2 條要求的「走 `ingestNotification` 驗證假圖不落地」請寫在 `tests/unit/image.test.ts` 裡，
> 直接 `import { ingestNotification } from '../../src/worker/phone-ingest.js'`。
> 不要去改 `tests/unit/phone-ingest.test.ts` —— 那個檔案在 WO-005 手上。
