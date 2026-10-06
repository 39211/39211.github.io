import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { clearSecretsForTest, createLogger, registerSecret } from '../../src/logger.js';

function collector(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

describe('logger 秘密遮罩', () => {
  it('token、Bearer、LINE ID、cookie 與敏感鍵都不會進日誌', async () => {
    clearSecretsForTest();
    registerSecret('supersecrettoken1234567890');
    const { stream, lines } = collector();
    const log = createLogger({ stream, level: 'info' });
    const lineId = `C${'a'.repeat(32)}`;
    log.info({ authorization: 'Bearer abcdefghijklmnop', destination: lineId, nested: { token: 'x', cookie: 'c_user=123; xs=abc' } }, `sending with supersecrettoken1234567890 to ${lineId} Bearer zzzzzzzzzzzzz cookie c_user=99887766`);
    await new Promise((r) => setTimeout(r, 50));
    const out = lines.join('');
    expect(out).not.toContain('supersecrettoken1234567890');
    expect(out).not.toContain(lineId);
    expect(out).not.toContain('zzzzzzzzzzzzz');
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).not.toContain('99887766');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('[LINE_ID_REDACTED]');
  });
});
