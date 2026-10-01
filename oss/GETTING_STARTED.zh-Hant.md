# 上手說明（免真實金鑰）

這個 repository 是一間社區洗衣店的發布自動化。你可以在沒有 Meta、GA4、LINE
或任何正式憑證的情況下，檢查它的可靠性規則。

## 這個示範證明什麼

三條正式環境正在使用的規則，改用假商家與模擬平台重跑：

1. **未核准不能發布。** 缺少核准、強制核准、店休暫停，或核准後指紋對不上，都不會打到模擬發布器。
2. **重試不能重複發文。** 送出後回應遺失會記成 `uncertain`，不能再重試。
3. **缺少分析資料不是零。** 未設定、讀取失敗或空資料集維持 `unmeasured`，數字欄位保持缺席。

這些規則摘自 `src/approvePost.ts`、`src/postCurrentSlot.ts`、`src/retry.ts`、
`src/postInstagram.ts`、`src/postFacebook.ts` 與 `src/ga4Report.ts`。示範沒有
重寫整條產線。

## 乾淨環境怎麼跑

需要 Node.js 22.5 或更新版本。

```bash
node oss-demo.mjs
```

`node oss-demo.mjs` 會印出三個指定情境與 25 個針對性回歸案例。它不讀 `.env`，
也不開網路連線。

`npm test` 仍會跑完整正式測試。只想看可重用核心時用 `node oss-demo.mjs`。

## 瀏覽器示範

公開站產生或本地開啟後，請看：

- `index.html` in this folder

GitHub Pages 鏡像：

- `https://39211.github.io/oss/`

頁面會在瀏覽器裡對模擬資料跑同一組 25 個案例。

## 失敗怎麼查

| 現象 | 可能原因 | 要看哪裡 |
|---|---|---|
| 情境 1 沒有擋住 | 核准閘門被略過 | `evaluateApproval()` 與案例 `A01` |
| 情境 2 出現兩個遠端 id | 把不確定狀態當成失敗再重試 | `publishDraft()` 與案例 `R01`–`R02` |
| 情境 3 出現 `value: 0` | 把未量測強制寫成零 | `recordAnalytics()` 與案例 `M01`–`M07` |
| `oss-demo` 結束代碼 1 | 有回歸案例失敗 | CLI 輸出的 `[FAIL]` 行 |

不要把示範指到正式的 Page、IG 帳號或 GA4 資源。若指令開始要
`META_ACCESS_TOKEN`，代表你已離開免金鑰路徑。

## 這個示範不包含什麼

- 正式 Facebook / Instagram / YouTube 發布
- 店家照片、準備發到正式帳號的文案，或客人的衣物
- 商業圖片或文案生成

那些仍屬於店主的私有流程。授權切分見 `NOTICE`。

## 接著看

- [English version](GETTING_STARTED.md)
- [如何貢獻](CONTRIBUTING.md)
- [公開證據頁](docs/oss/index.html)
- [維護成果紀錄](CHANGELOG-OSS.md)
