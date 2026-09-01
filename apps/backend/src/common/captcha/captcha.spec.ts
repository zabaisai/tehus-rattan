import { ForbiddenException } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { CaptchaGuard } from './captcha.guard';
import {
  FakeCaptchaProvider,
  FAKE_CAPTCHA_PASS_TOKEN,
  FAKE_CAPTCHA_FAIL_TOKEN,
} from './fake-captcha.provider';
import { TurnstileCaptchaProvider } from './turnstile-captcha.provider';

function configCon(values: Record<string, string | undefined>) {
  return { get: jest.fn((k: string) => values[k]) } as any;
}

function contextCon(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('FakeCaptchaProvider', () => {
  const p = new FakeCaptchaProvider();

  it('acepta el token de paso y rechaza cualquier otro', async () => {
    expect((await p.verify({ token: FAKE_CAPTCHA_PASS_TOKEN })).success).toBe(
      true,
    );
    expect((await p.verify({ token: FAKE_CAPTCHA_FAIL_TOKEN })).success).toBe(
      false,
    );
    expect((await p.verify({ token: 'otro' })).success).toBe(false);
  });
});

describe('CaptchaService', () => {
  it('isEnabled solo es true con CAPTCHA_ENABLED="true"', () => {
    expect(
      new CaptchaService(
        configCon({ CAPTCHA_ENABLED: 'true' }),
        new FakeCaptchaProvider(),
      ).isEnabled(),
    ).toBe(true);
    expect(
      new CaptchaService(
        configCon({ CAPTCHA_ENABLED: 'false' }),
        new FakeCaptchaProvider(),
      ).isEnabled(),
    ).toBe(false);
    expect(
      new CaptchaService(configCon({}), new FakeCaptchaProvider()).isEnabled(),
    ).toBe(false);
  });

  it('verify delega en el proveedor', async () => {
    const s = new CaptchaService(configCon({}), new FakeCaptchaProvider());
    expect(await s.verify({ token: FAKE_CAPTCHA_PASS_TOKEN })).toBe(true);
    expect(await s.verify({ token: 'x' })).toBe(false);
  });
});

describe('CaptchaGuard', () => {
  const provider = new FakeCaptchaProvider();

  it('es no-op cuando el control está desactivado', async () => {
    const service = new CaptchaService(
      configCon({ CAPTCHA_ENABLED: 'false' }),
      provider,
    );
    const guard = new CaptchaGuard(service);
    // Sin token, pero desactivado ⇒ pasa.
    expect(await guard.canActivate(contextCon({ headers: {}, body: {} }))).toBe(
      true,
    );
  });

  it('fail-closed: activado y sin token ⇒ 403', async () => {
    const service = new CaptchaService(
      configCon({ CAPTCHA_ENABLED: 'true' }),
      provider,
    );
    const guard = new CaptchaGuard(service);
    await expect(
      guard.canActivate(contextCon({ headers: {}, body: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activado con token válido (cabecera) ⇒ pasa', async () => {
    const service = new CaptchaService(
      configCon({ CAPTCHA_ENABLED: 'true' }),
      provider,
    );
    const guard = new CaptchaGuard(service);
    const req = {
      headers: { 'x-captcha-token': FAKE_CAPTCHA_PASS_TOKEN },
      body: {},
    };
    expect(await guard.canActivate(contextCon(req))).toBe(true);
  });

  it('activado con token inválido (body) ⇒ 403', async () => {
    const service = new CaptchaService(
      configCon({ CAPTCHA_ENABLED: 'true' }),
      provider,
    );
    const guard = new CaptchaGuard(service);
    const req = {
      headers: {},
      body: { captchaToken: FAKE_CAPTCHA_FAIL_TOKEN },
    };
    await expect(guard.canActivate(contextCon(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('TurnstileCaptchaProvider (fail-closed sin red)', () => {
  it('sin secret configurado ⇒ success:false (fail-closed)', async () => {
    const p = new TurnstileCaptchaProvider(configCon({}));
    expect(await p.verify({ token: 'algo' })).toEqual({
      success: false,
      reason: 'NO_SECRET',
    });
  });

  it('con secret pero sin token ⇒ success:false', async () => {
    const p = new TurnstileCaptchaProvider(
      configCon({ TURNSTILE_SECRET_KEY: 'secret-de-prueba' }),
    );
    expect((await p.verify({ token: '' })).success).toBe(false);
  });
});
