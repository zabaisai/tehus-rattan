import { DeviceVerificationConfig } from './device-verification.config';

function crear(valores: Record<string, string | undefined>) {
  const config = {
    get: (clave: string) => valores[clave],
  } as never;
  return new DeviceVerificationConfig(config);
}

const SECRETO = 'x'.repeat(48);

describe('DeviceVerificationConfig', () => {
  it('está apagada por defecto: sin la variable no se verifica nada', () => {
    const c = crear({});
    expect(c.featureEnabled).toBe(false);
    expect(c.appliesTo('quien@sea.test')).toBe(false);
  });

  it('solo el texto exacto "true" la enciende', () => {
    expect(
      crear({
        AUTH_DEVICE_VERIFICATION_ENABLED: 'TRUE',
        AUTH_CHALLENGE_HMAC_SECRET: SECRETO,
      }).appliesTo('a@b.test'),
    ).toBe(false);
    expect(
      crear({
        AUTH_DEVICE_VERIFICATION_ENABLED: '1',
        AUTH_CHALLENGE_HMAC_SECRET: SECRETO,
      }).appliesTo('a@b.test'),
    ).toBe(false);
    expect(
      crear({
        AUTH_DEVICE_VERIFICATION_ENABLED: 'true',
        AUTH_CHALLENGE_HMAC_SECRET: SECRETO,
      }).appliesTo('a@b.test'),
    ).toBe(true);
  });

  it('encendida pero sin secreto NO se aplica: preferimos el login de siempre', () => {
    const c = crear({ AUTH_DEVICE_VERIFICATION_ENABLED: 'true' });
    const error = jest
      .spyOn(
        (c as unknown as { logger: { error: (m: string) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    expect(c.appliesTo('a@b.test')).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    // El aviso se registra una sola vez, no en cada intento de acceso.
    c.appliesTo('a@b.test');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  describe('despliegue controlado por allowlist', () => {
    const base = {
      AUTH_DEVICE_VERIFICATION_ENABLED: 'true',
      AUTH_CHALLENGE_HMAC_SECRET: SECRETO,
    };

    it('lista vacía: se aplica a todas las cuentas', () => {
      expect(crear(base).appliesTo('cualquiera@empresa.test')).toBe(true);
    });

    it('con lista: solo esas cuentas verifican', () => {
      const c = crear({
        ...base,
        AUTH_DEVICE_VERIFICATION_ALLOWLIST: 'qa@takto.test, otra@takto.test',
      });
      expect(c.appliesTo('qa@takto.test')).toBe(true);
      expect(c.appliesTo('otra@takto.test')).toBe(true);
      expect(c.appliesTo('ajena@takto.test')).toBe(false);
    });

    it('compara sin distinguir mayúsculas ni espacios sobrantes', () => {
      const c = crear({
        ...base,
        AUTH_DEVICE_VERIFICATION_ALLOWLIST: '  QA@Takto.Test ',
      });
      expect(c.appliesTo('qa@takto.test')).toBe(true);
      expect(c.appliesTo(' QA@TAKTO.TEST ')).toBe(true);
    });
  });
});
