import type { Page } from 'playwright';

/**
 * esbuild（tsx）在 keepNames 模式下會把 `const f = () => {}` 編譯成 `__name(() => {}, "f")`。
 * 我們有多個函式會被 Playwright 序列化後送進頁面執行，頁面裡沒有 `__name`，因此先補一個 no-op。
 * 以「表達式字串」形式注入，避免這段程式本身也被改寫。
 */
export const NAME_SHIM = '(typeof globalThis.__name === "function") || (globalThis.__name = function (fn) { return fn; })';

/** 新分頁建立後呼叫一次：之後每次導航都會自動補上 shim */
export async function preparePage(page: Page): Promise<void> {
  await page.addInitScript(NAME_SHIM);
  await page.evaluate(NAME_SHIM).catch(() => undefined);
}

/** 在目前文件上補 shim（導航後、evaluate 前呼叫；成本極低） */
export async function ensureNameShim(page: Page): Promise<void> {
  await page.evaluate(NAME_SHIM).catch(() => undefined);
}
