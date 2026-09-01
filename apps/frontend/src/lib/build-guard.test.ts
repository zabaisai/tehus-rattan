import { describe, expect, it } from 'vitest';
import { verificarCaptcha } from './build-guard';

describe('verificarCaptcha (coherencia antibot en build)', () => {
  it('en desarrollo nunca falla (aunque falte la site key)', () => {
    expect(() => verificarCaptcha(undefined, true, false)).not.toThrow();
  });

  it('producción + requerido + SIN site key ⇒ falla la construcción', () => {
    expect(() => verificarCaptcha(undefined, true, true)).toThrow(
      /NEXT_PUBLIC_TURNSTILE_SITE_KEY/,
    );
    expect(() => verificarCaptcha('   ', true, true)).toThrow();
  });

  it('producción + requerido + CON site key ⇒ ok', () => {
    expect(() =>
      verificarCaptcha('fake-site-key', true, true),
    ).not.toThrow();
  });

  it('producción + NO requerido ⇒ ok aunque falte la site key', () => {
    expect(() => verificarCaptcha(undefined, false, true)).not.toThrow();
  });
});
