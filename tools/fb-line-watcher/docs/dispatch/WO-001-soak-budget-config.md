# WO-001 壓測腳本沒有覆寫每日通知預算

- 提出：雲端規劃／深審席
- 日期：2026-09-04
- 嚴重度：P2（只影響壓測，不影響產品行為）
- 來源：Linux 30 分鐘壓測 `soak-linux.json`，gate「零 dead letter」FAIL = 291、「event 與 delivery 一致」FAIL（events=442 / sent=151）
- 相依：**必須先於 WO-002 完成**（兩張都會改 `scripts/soak.ts`，先做這張可讓 WO-002 的 gate 改動在乾淨的基準上驗證）

## 1. 標的檔案與函式

| 檔案 | 位置 |
| --- | --- |
| `scripts/soak.ts` | `main()` 內呼叫 `parseConfigObject({...})` 的設定物件 |

參考（唯讀，不要改）：`src/config/schema.ts:172` `max_notifications_per_day` 預設 150。

## 2. 規格（逐條可驗）

1. `scripts/soak.ts` 傳給 `parseConfigObject` 的設定物件必須明確指定 `max_notifications_per_day`。
2. 值必須足以讓壓測不被預算截斷。實測基準：30 分鐘產生 442 個事件。取 **`max_notifications_per_day: 100000`**，並在該行加註解說明「壓測會在 30 分鐘內模擬數天的量，預設 150 會讓後半段全被抑制，不是產品缺陷」。
3. 不得改動 `src/config/schema.ts` 的預設值 150。產品預設維持不變。
4. 不得改動 `src/line/notifier.ts` 的任何行為。這張工單純粹是壓測設定。

## 3. 驗收（測試／突變）

**驗收指令**

```
npm run soak -- --minutes 2 --json /tmp/wo001.json
```

**通過條件**

1. 九條 gate 全部 PASS。
2. `/tmp/wo001.json` 的 `dead` 為 `0`。
3. `events === deliveries === sent`。
4. `npm test` 維持 148 項全綠。不得刪測試、不得放寬既有斷言。

**突變驗證（證明這條設定真的有作用）**

把 `max_notifications_per_day` 暫時改回 `150` 再跑一次 2 分鐘壓測，必須看到 `dead > 0` 且 gate FAIL；確認後改回 `100000`。這一步只是驗證，不要 commit 突變後的值。

## 4. 可寫路徑白名單

```
scripts/soak.ts
```

以上之外一律唯讀。特別禁止：`src/**`、`tests/**`、`.github/**`。
