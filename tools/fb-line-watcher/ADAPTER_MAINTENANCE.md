# Facebook 改版後怎麼修（ADAPTER_MAINTENANCE.md）

Facebook 網頁隨時可能改版。本專案**不依賴任何隨機 class name**，只用下面這些相對穩定的訊號：

1. `role="article"`／`role="feed"`／`role="main"`（貼文容器；留言是巢狀 article）
2. `aria-labelledby`（貼文作者）、`aria-label`（時間全稱、留言標籤）
3. 可見文字（zh-TW 為主，英文 fallback）：查看更多、查看更多留言、N 則回覆、最相關／所有留言
4. permalink URL 樣式：`/posts/`、`/permalink/`、`/groups/<g>/posts/<id>`、`?comment_id=`、`reply_comment_id=`
5. `data-ad-preview="message"` 等內容容器（有就用，沒有就退回 `div[dir=auto]` 葉節點）
6. 相對結構（巢狀深度、縮排）判斷留言／回覆

所有規則集中在 **`src/adapters/catalog.ts`** 的 `DEFAULT_CATALOG`，每一欄都可以在 `config/targets.yaml` 的 `adapter_overrides` 覆寫，不必改程式。

## 症狀 → 對應

| 症狀（`npm run probe` 或 LINE 警報） | 可能原因 | 調整欄位 |
| --- | --- | --- |
| 抽取貼文 0 篇、頁面狀態 READY | 貼文容器不再是 `div[role=article]`，或 feed 選擇器變了 | `articleSelector`、`feedSelectors`、`mainSelectors` |
| 貼文有但 `no-permalink` | permalink URL 樣式改變 | `permalinkHrefPatterns`（正規表達式） |
| `no-author` | 作者不在 `aria-labelledby`／`h2~h5`／`strong` | 先看 probe JSON 的原始 HTML 結構，必要時提 issue 更新 `findAuthor` |
| `no-time` | 時間連結沒有 aria-label，或格式變了 | `timeAriaLabelPatterns`、`timeTextPatterns` |
| 文字空白 | 內容容器屬性改變 | `messageSelectors` |
| 留言 0 則但畫面有 | 留言不再是巢狀 `role=article`；或「查看更多留言」文字變了 | `articleSelector`（留言共用）、`viewMoreCommentsPatterns`、`viewRepliesPatterns` |
| 回覆被當成留言 | 回覆的 aria-label／permalink／縮排訊號都消失 | `replyAriaLabelPatterns`、`replyPermalinkPatterns` |
| 明明登入了卻報 LOGIN_REQUIRED | 登入判定文字誤觸（例如貼文內容含「登入 Facebook」）——判定要求 0 篇貼文才成立，若仍誤判 | `loginTextPatterns`、`loginSelectors` |
| 正常頁面被判 PERMISSION_DENIED | 權限文字誤觸 | `permissionTextPatterns`、`joinGroupButtonPatterns` |
| 留言排序切不到「所有留言」 | 按鈕／選單文字改變 | `commentSortButtonPatterns`、`commentSortMenuItemPatterns` |
| 「查看更多」沒展開 | 文字變了（例如「顯示更多」） | `seeMorePatterns` |
| 通知文字混入按鈕文案 | 新的 UI 文案沒被過濾 | `uiNoisePatterns` |
| 截圖被聊天浮窗遮住 | 浮窗 aria-label 改了 | `hideForCaptureSelectors` |

## 覆寫範例

```yaml
targets:
  - key: group_main
    type: facebook_group
    url: https://www.facebook.com/groups/123
    adapter_overrides:
      seeMorePatterns: ['^查看更多$', '^顯示更多$', '^See more$', '^更多內容$']
      viewMoreCommentsPatterns: ['查看更多留言', '查看其他留言', '載入更多留言', 'View more comments']
      commentSortMenuItemPatterns:
        all: ['所有留言', '全部留言', 'All comments']
```

陣列欄位是整個取代（不是合併），所以請把原本的值也保留下來。未知欄位或型別錯誤會在啟動時 fail fast。

## 診斷流程

1. `npm run probe -- --target <key>`：印出頁面狀態、貼文數、每篇的作者／時間／permalink／缺少欄位、留言數與完整性，並把截圖與 JSON 存到 `captures/diagnostics/`。
2. 打開 `probe_*.json`，看 `extract.posts[].flags`（缺什麼）與 `diagnostics.notes`。
3. 用瀏覽器開發人員工具（F12）在真實頁面檢查對應元素的 role／aria-label／href，把新的樣式加到 `adapter_overrides`。
4. 再跑 probe 確認信心 ≥ 0.85、留言數正確。
5. **修好後一定要跑 `npm run resync`**：把現況重新同步為已知，避免舊貼文被當成新貼文洗版（程式在 adapter 版本變更或從降級模式恢復時也會自動 resync）。

## 程式面更新

若覆寫無法解決（例如作者定位邏輯需要改），修改 `src/adapters/dom-extract.ts`，並：

- 更新 `catalog.ts` 的 `ADAPTER_VERSION`（例 `fb-web-2026.11-v2`）→ watcher 會自動對所有 target 做一次 resync。
- 在 `fixtures/render.ts` 補一個對應新結構的 fixture 變化，並在 `tests/integration` 加測試。
- `npm test` 全綠再部署。

## 為什麼不用 Facebook API

兩個監看對象都拿不到官方 API：

- **粉專**：Graph API 讀粉專貼文需要 Page access token，而產生它的帳號必須擁有該粉專的管理權限。監看**別人的**粉專沒有這個權限。Meta 另有 Page Public Content Access 權限可讀公開粉專，但需要企業驗證加 App 審核，只發給特定商業用途。
- **社團**：Meta 已於 2024 年停止對一般開發者提供社團貼文／留言的 API。

所以兩種來源一律走「授權帳號的畫面自動化」，用同一套機制，代價就是要跟著 Facebook 網頁改版維護。
