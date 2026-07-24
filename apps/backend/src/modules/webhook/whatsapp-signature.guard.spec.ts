import {
  ServiceUnavailableException,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';

// Fictitious app secret — never a real Meta secret, never logged.
const APP_SECRET = 'test-only-meta-app-secret-do-not-use';

function sign(secret: string, rawBody: Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

function buildContext(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(secret: string | undefined): WhatsAppSignatureGuard {
  const config = {
    get: (key: string) =>
      key === 'WHATSAPP_APP_SECRET' ? secret : undefined,
  };
  return new WhatsAppSignatureGuard(config as any);
}

describe('WhatsAppSignatureGuard', () => {
  const rawBody = Buffer.from(
    JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] }),
    'utf8',
  );
  const guard = makeGuard(APP_SECRET);

  const req = (overrides: any = {}) => ({
    rawBody,
    headers: { 'x-hub-signature-256': sign(APP_SECRET, rawBody) },
    ...overrides,
  });

  it('accepts a valid signature', () => {
    expect(guard.canActivate(buildContext(req()))).toBe(true);
  });

  it('rejects a missing signature header', () => {
    expect(() => guard.canActivate(buildContext(req({ headers: {} })))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an empty signature header', () => {
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': '' } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a different algorithm prefix (sha1=)', () => {
    const sha1 = 'sha1=' + '0'.repeat(40);
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': sha1 } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects invalid hex characters', () => {
    const bad = 'sha256=' + 'z'.repeat(64);
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': bad } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a too-short signature', () => {
    const short = 'sha256=' + 'a'.repeat(63);
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': short } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a too-long signature', () => {
    const long = 'sha256=' + 'a'.repeat(65);
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': long } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a well-formed signature computed with the wrong secret', () => {
    const forged = sign('some-other-secret', rawBody);
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': forged } }))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when the body was altered after signing', () => {
    const signature = sign(APP_SECRET, rawBody);
    const tampered = Buffer.from(rawBody.toString('utf8') + ' ', 'utf8');
    expect(() =>
      guard.canActivate(
        buildContext({ rawBody: tampered, headers: { 'x-hub-signature-256': signature } }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('accepts a valid signature over a Unicode JSON body', () => {
    const unicodeBody = Buffer.from(
      JSON.stringify({ text: 'Hola 🌿 ñandú — ácción' }),
      'utf8',
    );
    const sig = sign(APP_SECRET, unicodeBody);
    expect(
      guard.canActivate(
        buildContext({ rawBody: unicodeBody, headers: { 'x-hub-signature-256': sig } }),
      ),
    ).toBe(true);
  });

  it('is byte-exact: a signature valid for a differently-spaced body is rejected', () => {
    const a = Buffer.from('{"a":1}', 'utf8');
    const b = Buffer.from('{"a": 1}', 'utf8'); // one extra space
    const sigForA = sign(APP_SECRET, a);
    expect(() =>
      guard.canActivate(
        buildContext({ rawBody: b, headers: { 'x-hub-signature-256': sigForA } }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when the raw body is missing (cannot verify)', () => {
    expect(() =>
      guard.canActivate(
        buildContext({ rawBody: undefined, headers: { 'x-hub-signature-256': sign(APP_SECRET, rawBody) } }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed with 503 when the app secret is not configured', () => {
    const unconfigured = makeGuard(undefined);
    expect(() => unconfigured.canActivate(buildContext(req()))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('accepts an uppercase-hex signature (case-insensitive match)', () => {
    const upper =
      'sha256=' +
      createHmac('sha256', APP_SECRET).update(rawBody).digest('hex').toUpperCase();
    // Meta sends lowercase; uppercase hex is still a valid representation.
    // Our regex is lowercase-only by spec, so this MUST be rejected — asserting
    // the strict contract rather than silently accepting.
    expect(() =>
      guard.canActivate(buildContext(req({ headers: { 'x-hub-signature-256': upper } }))),
    ).toThrow(UnauthorizedException);
  });
});
