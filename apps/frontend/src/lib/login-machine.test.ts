import { describe, expect, it } from 'vitest';
import {
  actionFromLoginResult,
  challengeFromResult,
  formatCountdown,
  initialLoginState,
  isLocked,
  loginReducer,
  secondsUntil,
  type DeviceChallenge,
  type LoginState,
} from './login-machine';

const RETO: DeviceChallenge = {
  challengeId: 'ret-1',
  maskedEmail: 'a***@empresa.com',
  expiresAt: '2026-09-04T12:05:00.000Z',
  resendAvailableAt: '2026-09-04T12:00:30.000Z',
  attemptsRemaining: 5,
};

const AHORA = Date.parse('2026-09-04T12:00:00.000Z');

function estado(parcial: Partial<LoginState>): LoginState {
  return { ...initialLoginState, ...parcial };
}

describe('loginReducer', () => {
  it('arranca en credenciales, sin error, sin reto y sin bloqueo', () => {
    expect(initialLoginState).toEqual({
      step: 'credentials',
      error: '',
      errorSeq: 0,
      notice: '',
      challenge: null,
      lockedUntil: null,
    });
  });

  it('«submit» pasa a submitting y borra el error anterior', () => {
    const siguiente = loginReducer(
      estado({ error: 'Credenciales inválidas', notice: 'algo' }),
      { type: 'submit' },
    );
    expect(siguiente.step).toBe('submitting');
    expect(siguiente.error).toBe('');
    expect(siguiente.notice).toBe('');
  });

  it('«challenge» guarda el reto y pasa a verification', () => {
    const siguiente = loginReducer(estado({ step: 'submitting' }), {
      type: 'challenge',
      challenge: RETO,
    });
    expect(siguiente.step).toBe('verification');
    expect(siguiente.challenge).toEqual(RETO);
  });

  it('un error durante el envío devuelve a credenciales', () => {
    const siguiente = loginReducer(estado({ step: 'submitting' }), {
      type: 'error',
      message: 'Credenciales inválidas',
    });
    expect(siguiente.step).toBe('credentials');
    expect(siguiente.error).toBe('Credenciales inválidas');
  });

  it('un error durante la verificación devuelve a verification, no a credenciales', () => {
    const siguiente = loginReducer(
      estado({ step: 'verifying', challenge: RETO }),
      { type: 'error', message: 'El código no es válido o ya venció. Solicita uno nuevo.' },
    );
    expect(siguiente.step).toBe('verification');
    expect(siguiente.challenge).toEqual(RETO);
  });

  it('cada error avanza errorSeq aunque el texto se repita', () => {
    const uno = loginReducer(estado({ step: 'verifying' }), {
      type: 'error',
      message: 'mismo',
    });
    const dos = loginReducer({ ...uno, step: 'verifying' }, {
      type: 'error',
      message: 'mismo',
    });
    expect(dos.errorSeq).toBe(uno.errorSeq + 1);
  });

  it('«locked» fija hasta cuándo no se acepta otro intento', () => {
    const hasta = new Date(AHORA + 45_000).toISOString();
    const siguiente = loginReducer(estado({ step: 'submitting' }), {
      type: 'locked',
      message: 'Demasiados intentos.',
      until: hasta,
    });
    expect(siguiente.lockedUntil).toBe(hasta);
    expect(isLocked(siguiente, AHORA)).toBe(true);
    expect(isLocked(siguiente, AHORA + 46_000)).toBe(false);
  });

  it('«resend» y «resent» conservan el reto y dejan una confirmación', () => {
    const enVuelo = loginReducer(estado({ step: 'verification', challenge: RETO }), {
      type: 'resend',
    });
    expect(enVuelo.step).toBe('resending');

    const nuevo = { ...RETO, attemptsRemaining: 4 };
    const listo = loginReducer(enVuelo, {
      type: 'resent',
      challenge: nuevo,
      notice: 'Te enviamos otro código.',
    });
    expect(listo.step).toBe('verification');
    expect(listo.challenge).toEqual(nuevo);
    expect(listo.notice).toBe('Te enviamos otro código.');
  });

  it('«back» descarta el reto pero mantiene el bloqueo vigente', () => {
    const hasta = new Date(AHORA + 60_000).toISOString();
    const siguiente = loginReducer(
      estado({ step: 'verification', challenge: RETO, lockedUntil: hasta, error: 'x' }),
      { type: 'back' },
    );
    expect(siguiente.step).toBe('credentials');
    expect(siguiente.challenge).toBeNull();
    expect(siguiente.error).toBe('');
    expect(siguiente.lockedUntil).toBe(hasta);
  });

  it('«granted» y «opening» son pasos distintos', () => {
    const concedido = loginReducer(estado({ step: 'submitting' }), { type: 'granted' });
    expect(concedido.step).toBe('granted');
    expect(loginReducer(concedido, { type: 'opening' }).step).toBe('opening');
  });

  it('«reset» vuelve al inicio', () => {
    const siguiente = loginReducer(
      estado({ step: 'opening', challenge: RETO, error: 'x' }),
      { type: 'reset' },
    );
    expect(siguiente.step).toBe('credentials');
    expect(siguiente.challenge).toBeNull();
  });
});

describe('secondsUntil', () => {
  it('devuelve 0 sin fecha, con fecha inválida o ya pasada', () => {
    expect(secondsUntil(null, AHORA)).toBe(0);
    expect(secondsUntil('no es una fecha', AHORA)).toBe(0);
    expect(secondsUntil(new Date(AHORA - 5000).toISOString(), AHORA)).toBe(0);
  });

  it('redondea hacia arriba los segundos que faltan', () => {
    expect(secondsUntil(new Date(AHORA + 30_000).toISOString(), AHORA)).toBe(30);
    expect(secondsUntil(new Date(AHORA + 30_400).toISOString(), AHORA)).toBe(31);
  });
});

describe('formatCountdown', () => {
  it('escribe m:ss con el segundo siempre a dos cifras', () => {
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('lectura de la respuesta del servidor', () => {
  it('challengeFromResult copia los cinco campos del reto', () => {
    expect(
      challengeFromResult({ status: 'verification_required', ...RETO }),
    ).toEqual(RETO);
  });

  it('actionFromLoginResult distingue sesión de reto', () => {
    expect(
      actionFromLoginResult({
        status: 'authenticated',
        token: 't',
        user: {
          id: '1',
          email: 'a@b.co',
          name: 'Ana',
          role: 'ADMIN',
          companyId: 'c1',
        },
      }),
    ).toEqual({ type: 'granted' });

    expect(
      actionFromLoginResult({ status: 'verification_required', ...RETO }),
    ).toEqual({ type: 'challenge', challenge: RETO });
  });
});
