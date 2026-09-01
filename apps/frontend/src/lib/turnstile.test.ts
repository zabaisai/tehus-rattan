import { describe, expect, it, afterEach } from 'vitest';
import { getTurnstileSiteKey, isCaptchaConfigured } from './turnstile';

const KEY = 'NEXT_PUBLIC_TURNSTILE_SITE_KEY';

describe('turnstile config', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('sin variable, no está configurado', () => {
    delete process.env[KEY];
    expect(getTurnstileSiteKey()).toBeNull();
    expect(isCaptchaConfigured()).toBe(false);
  });

  it('con variable no vacía, devuelve la site key (trim)', () => {
    process.env[KEY] = '  fake-site-key  ';
    expect(getTurnstileSiteKey()).toBe('fake-site-key');
    expect(isCaptchaConfigured()).toBe(true);
  });

  it('variable en blanco cuenta como no configurado', () => {
    process.env[KEY] = '   ';
    expect(isCaptchaConfigured()).toBe(false);
  });
});
