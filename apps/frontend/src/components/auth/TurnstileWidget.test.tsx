import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { TurnstileWidget } from './TurnstileWidget';

const SITE_KEY = 'NEXT_PUBLIC_TURNSTILE_SITE_KEY';

describe('TurnstileWidget', () => {
  const original = process.env[SITE_KEY];

  afterEach(() => {
    cleanup();
    if (original === undefined) delete process.env[SITE_KEY];
    else process.env[SITE_KEY] = original;
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  beforeEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it('no renderiza nada sin site key (antibot no configurado)', () => {
    delete process.env[SITE_KEY];
    const { queryByTestId } = render(<TurnstileWidget onVerify={() => {}} />);
    expect(queryByTestId('turnstile-widget')).toBeNull();
  });

  it('con site key renderiza el contenedor accesible y llama a render', async () => {
    process.env[SITE_KEY] = 'fake-test-site-key';
    const onVerify = vi.fn();
    // Turnstile ya cargado: render invoca el callback con un token de prueba.
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
        opts.callback('token-de-prueba');
        return 'widget-1';
      },
      reset: () => {},
      remove: () => {},
    };

    const { getByTestId } = render(<TurnstileWidget onVerify={onVerify} />);
    const el = getByTestId('turnstile-widget');
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toMatch(/antibot/i);

    await waitFor(() => expect(onVerify).toHaveBeenCalledWith('token-de-prueba'));
  });

  it('propaga expiración y error para limpiar el token', async () => {
    process.env[SITE_KEY] = 'fake-test-site-key';
    const onExpire = vi.fn();
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (
        _el: HTMLElement,
        opts: { 'expired-callback'?: () => void },
      ) => {
        opts['expired-callback']?.();
        return 'widget-1';
      },
      reset: () => {},
      remove: () => {},
    };

    render(<TurnstileWidget onVerify={() => {}} onExpire={onExpire} />);
    await waitFor(() => expect(onExpire).toHaveBeenCalled());
  });
});
