/**
 * 安全解析 HTTP request target（origin-form 或 absolute-form）。
 *
 * Node 會把客戶端送來的 raw target 原樣放進 `req.url`。對 `//[`、`http://[` 這類
 * 畸形字串呼叫 `new URL` 會丟 TypeError；若例外從 request callback 逸出，
 * 整個 watcher 以 exit 1 結束。這裡把例外吃掉，呼叫端回 400。
 */
export function parseRequestTarget(raw: string | undefined): { pathname: string; searchParams: URLSearchParams } | null {
  try {
    const url = new URL(raw && raw.length > 0 ? raw : '/', 'http://local.test');
    return { pathname: url.pathname, searchParams: url.searchParams };
  } catch {
    return null;
  }
}
