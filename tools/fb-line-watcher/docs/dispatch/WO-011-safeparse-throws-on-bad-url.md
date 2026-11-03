# WO-011 `safeParse` 對壞掉的 URL 丟例外，設定打錯字得到堆疊而非中文提示

- 提出：雲端深審席三 ／ 嚴重度：**P2** ／ 深審席已重現

## 問題

`src/config/schema.ts:201` 的 `superRefine` 內 `new URL(t.url)` **沒有 try/catch**。
Zod 4 在巢狀欄位驗證失敗後**仍會執行物件層的 refinement**，所以被 `z.url()` 擋下的字串還是會流到這一行。

深審席重現：`ConfigSchema.safeParse` 對 `url: 'not a url'` 與 `url: ''` 都**丟出**
`TypeError: Invalid URL`，而不是回傳 `{ success: false }`。

後果：`parseConfigObject`（`src/config/load.ts:39-45`）走不到組 `ConfigError` 的那一行，
使用者拿到 `cli.ts:414` 印的原始堆疊，而不是設計好的中文提示。
`safeParse` 不丟例外的契約也被打破。

**這一行是上一輪修 P2-7（facebook 主機名邊界）時加的。** 加的時候只想到主機名比對，
沒想到它會在 URL 本身就不合法時被執行到。

## 1. 標的檔案與函式

`src/config/schema.ts:195-210`（target 的 `superRefine`）

## 2. 規格（逐條可驗）

1. `new URL(t.url)` 包 try/catch。解析失敗時 **`ctx.addIssue`** 回報「網址格式不正確」，**不得** throw。
2. 主機名檢查邏輯本身不變（`host === 'facebook.com' || host.endsWith('.facebook.com')`）。
3. 檢查同一個 `superRefine` 內、以及其他 schema 的 `superRefine` 裡，有沒有別的地方也會對不合法輸入丟例外
   （例如 `new URL(secrets.publicBaseUrl)`、regex 編譯）。找到一併修。
4. `parseConfigObject` 對任何輸入都必須回 `ConfigError`（含欄位路徑的中文訊息），永不逸出原始例外。

## 3. 驗收（測試／突變）

1. `parseConfigObject({ targets: [{ …, url: 'not a url' }] })` → 丟 `ConfigError`，訊息含欄位路徑，**不是** `TypeError`。
2. 同上，`url: ''`、`url: 'http://'`、`url: 'https://'`。
3. `ConfigSchema.safeParse` 對上述輸入一律回 `{ success: false }`，**不丟例外**。
4. `tests/unit/config.test.ts` 既有 8 條全過（含上一輪新增的主機名邊界負例）。

指令：`npm run typecheck && npm test`。不得刪測試或放寬斷言。
突變：拿掉 try/catch → 測試 3 必須失敗。

## 4. 可寫路徑白名單

```
src/config/schema.ts
src/config/load.ts
tests/unit/config.test.ts
```

禁止：其餘全部。
