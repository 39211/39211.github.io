// node:sqlite 在 Node 22 仍會印出 ExperimentalWarning；這裡只過濾這一種警告，其餘照常顯示。
const originalEmit = process.emitWarning.bind(process);
(process as unknown as { emitWarning: typeof process.emitWarning }).emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning.message;
  const name = typeof warning === 'string' ? (typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type) : warning.name;
  if (/SQLite is an experimental feature/i.test(msg) || (name === 'ExperimentalWarning' && /sqlite/i.test(msg))) return;
  (originalEmit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
export {};
