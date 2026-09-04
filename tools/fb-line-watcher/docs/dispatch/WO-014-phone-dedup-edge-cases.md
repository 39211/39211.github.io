# WO-014 時鐘回撥造成永久去重；指紋的欄位邊界可位移

- 提出：雲端深審席二 ／ 嚴重度：**P1 + P2** ／ 深審席已重現

## 缺陷一（P1）：`age` 為負也算落在去重視窗內

`src/worker/phone-ingest.ts:150-151`

```ts
const age = now.getTime() - Date.parse(recent.received_at);
if (Number.isFinite(age) && age <= cfg.dedup_window_seconds * 1000) {
```

**只有上界、沒有下界。** DB 裡若存在「未來的 `received_at`」，`age` 是負的，負數必然 `<= window`，
於是判定為 duplicate。

深審席重現（同一則通知，`dedup_window_seconds = 600`）：
```
t0            : accepted
t0 + 300s     : duplicate   ← 正確
t0 + 1200s    : accepted    ← 正確
時鐘回撥 2 小時 : duplicate   ← 錯誤，視窗早就過了
時鐘回撥 26 年  : duplicate   ← 錯誤，且直到牆鐘追回來為止都這樣
```

觸發條件是**任何一次向後的時鐘校正**：RTC 漂移後 w32time 修正、休眠喚醒、
雙開機把 RTC 當本地時間、VM 快照還原。幅度幾秒無害；到小時／天就是長時間靜默漏送 ——
回傳 `duplicate`、HTTP 200、**不寫任何日誌**。

**一行 `age >= 0 &&` 就能修**，但要一併決定「偵測到時鐘回撥」時要不要發警報。

（附帶查證：`received_at` 解析失敗時 `Number.isFinite(NaN)` 為 false，會 fail-open 成 `accepted` ——
方向正確，**這一點不是缺陷**，不要順手「修」掉。）

## 缺陷二（P2）：`deriveContentFingerprint` 的 `|` 沒有跳脫

`src/worker/phone-ingest.ts:99-102`

`phone|{pkg}|{title}|{text}` 直接串接，欄位邊界可位移：

| 輸入 | fingerprint 前 20 字元 |
|---|---|
| `title="a\|b"`, `text="c"` | `2f8a8f97ea00f201d58c` |
| `title="a"`, `text="b\|c"` | `2f8a8f97ea00f201d58c` ← **同一把** |

兩則語意不同的通知在去重視窗內會被吃掉一則。標題是發話者名稱、內文是貼文正文，**正文含 `|` 並非罕見**。

次要（預設設定下走不到，`allowed_packages` 需為空）：`clientKey` 分支是 `phone|client|{key}`，
無 clientKey 分支是 `phone|{pkg}|…`；`packageName` 恰為 `client` 時兩者形狀相同，已重現碰撞。

**`clientKey` 佔位風險**：`clientKey` 存在時是 fingerprint 的**唯一**輸入，手機端完全可控。
實務上最可能的不是攻擊，而是 **MacroDroid 變數沒展開、每則都送同一個字面值**，
導致全部通知塌成一把指紋、只有第一則會送出。

## 1. 標的檔案與函式

`src/worker/phone-ingest.ts`：`deriveContentFingerprint`（第 99–112 行）、`ingestNotification` 的去重判定（第 145–155 行）

## 2. 規格（逐條可驗）

1. 去重判定加下界：`age >= 0 && age <= window`。`age < 0` 視為**非重複**（fail-open，寧可多送一則）。
2. 偵測到 `age < 0` 時記一筆 warn 日誌，內容說明可能是時鐘回撥。**不要**發 LINE 警報（會太吵）。
3. 指紋的欄位串接必須**無歧義**。做法自選，但必須讓上表兩組輸入產生不同雜湊。
   建議：每個欄位先做長度前綴（`${s.length}:${s}`），或改用 JSON 陣列序列化後再雜湊。
4. `clientKey` 分支與一般分支要有**明確的 domain separation**（例如 `phone|v2|client|…` 與 `phone|v2|auto|…`）。
5. **改變指紋演算法會讓既有的去重狀態失效**（舊資料的 fingerprint 對不上新演算法）。
   這在升級當下會造成一次性的重複通知。可接受，但必須：
   - 在 `PHONE_INGEST.md` 寫明升級後可能收到一次重複；或
   - 加一個 migration 清掉 `dedup_window_seconds` 以外的舊列。
   實作者擇一並說明。
6. `clientKey` 為空字串或只有空白時，必須**忽略**它走一般分支，不得產生 `phone|client|` 這種空 key。

## 3. 驗收（測試／突變）

1. 時鐘回撥 2 小時後送同一則通知 → **`accepted`**（不是 duplicate），且日誌有 warn。
2. 時鐘正常前進、視窗內 → 仍為 `duplicate`（既有行為不變）。
3. `title="a|b", text="c"` 與 `title="a", text="b|c"` → **兩把不同的 fingerprint**。
4. `clientKey=""`／`clientKey="   "` → 走一般分支。
5. `received_at` 無法解析 → 仍 `accepted`（既有 fail-open 行為不變）。
6. 既有的 `tests/unit/phone-ingest.test.ts` 25 條全過。

**驗收指令**：`npm run typecheck && npm test`
**通過條件**：全綠、項數 ≥ 148 + 新增；不得刪測試或放寬斷言。
**突變**：拿掉 `age >= 0` → 測試 1 必須失敗。

## 4. 可寫路徑白名單

```
src/worker/phone-ingest.ts
src/storage/db.ts          # 僅限第 5 條若選 migration 方案
PHONE_INGEST.md
tests/unit/phone-ingest.test.ts
tests/integration/phone-ingest.test.ts
```

禁止：`src/worker/scheduler.ts`（WO-013 範圍）、`src/util/image.ts`（WO-012 範圍）、`src/detect/**`、`.github/**`。
