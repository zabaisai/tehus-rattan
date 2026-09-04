import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DeviceVerificationService } from './device-verification.service';
import { digestCode } from './device-code.util';
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_RESEND_COOLDOWN_MS,
  CHALLENGE_TTL_MS,
} from './device-verification.constants';

const SECRETO = 'secreto-de-prueba-de-al-menos-32-caracteres!!';
const USUARIO = {
  id: 'user-1',
  email: 'isabel@empresa.test',
  name: 'Isabel',
  role: 'ADMIN' as const,
  companyId: 'company-1',
};
const CONTEXTO = {
  deviceIdHash: 'hash-dispositivo',
  ipPreview: '181.60.12.0',
  browser: 'Chrome 152',
  operatingSystem: 'Windows',
  deviceType: 'DESKTOP' as const,
};

describe('DeviceVerificationService', () => {
  let prisma: any;
  let mail: any;
  let audit: any;
  let config: any;
  let service: DeviceVerificationService;
  /** Filas en memoria, indexadas por id. */
  let retos: Map<string, any>;
  let siguienteId: number;

  beforeEach(() => {
    retos = new Map();
    siguienteId = 0;

    prisma = {
      deviceVerificationChallenge: {
        create: jest.fn(async ({ data }: any) => {
          const id = `reto-${++siguienteId}`;
          retos.set(id, { id, attempts: 0, ...data });
          return { ...retos.get(id) };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const fila = retos.get(where.id);
          Object.assign(fila, data);
          return { ...fila };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const fila of retos.values()) {
            if (where.id && fila.id !== where.id) continue;
            if (where.userId && fila.userId !== where.userId) continue;
            if (where.consumedAt === null && fila.consumedAt) continue;
            if (where.revokedAt === null && fila.revokedAt) continue;
            if (where.expiresAt?.gt && !(fila.expiresAt > where.expiresAt.gt))
              continue;
            if (
              where.attempts?.lt !== undefined &&
              !(fila.attempts < where.attempts.lt)
            )
              continue;
            if (data.attempts?.increment)
              fila.attempts += data.attempts.increment;
            if (data.consumedAt) fila.consumedAt = data.consumedAt;
            if (data.revokedAt) fila.revokedAt = data.revokedAt;
            count++;
          }
          return { count };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const fila = retos.get(where.id);
          return fila ? { ...fila } : null;
        }),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === USUARIO.id ? { ...USUARIO } : null,
        ),
      },
    };
    mail = {
      sendDeviceVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = { hmacSecret: SECRETO };
    service = new DeviceVerificationService(prisma, mail, audit, config);
  });

  /** Recupera el código en claro tal como se envió por correo. */
  const codigoEnviado = () =>
    mail.sendDeviceVerificationEmail.mock.calls.at(-1)[0].code as string;

  describe('createChallenge', () => {
    it('crea el reto, envía el código y devuelve el destino enmascarado', async () => {
      const vista = await service.createChallenge({
        user: USUARIO,
        context: CONTEXTO,
      });

      expect(vista.challengeId).toBe('reto-1');
      expect(vista.maskedEmail).toBe('is***@empresa.test');
      expect(vista.attemptsRemaining).toBe(CHALLENGE_MAX_ATTEMPTS);
      expect(mail.sendDeviceVerificationEmail).toHaveBeenCalledTimes(1);
      const enviado = mail.sendDeviceVerificationEmail.mock.calls[0][0];
      expect(enviado.to).toBe(USUARIO.email);
      expect(enviado.code).toMatch(/^\d{6}$/);
      expect(enviado.ttlMinutes).toBe(10);
    });

    it('NUNCA guarda el código: en base solo vive su HMAC', async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const code = codigoEnviado();
      const fila = retos.get('reto-1');
      expect(fila.codeDigest).not.toContain(code);
      expect(fila.codeDigest).toBe(digestCode(code, 'reto-1', SECRETO));
      expect(JSON.stringify(fila)).not.toContain(code);
    });

    it('la vista devuelta no lleva el código ni su huella', async () => {
      const vista = await service.createChallenge({
        user: USUARIO,
        context: CONTEXTO,
      });
      const serializada = JSON.stringify(vista);
      expect(serializada).not.toContain(codigoEnviado());
      expect(serializada).not.toContain('codeDigest');
    });

    it('guarda expiración, tope de intentos y espera de reenvío', async () => {
      const antes = Date.now();
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const fila = retos.get('reto-1');
      expect(fila.expiresAt.getTime()).toBeGreaterThanOrEqual(
        antes + CHALLENGE_TTL_MS - 50,
      );
      expect(fila.maxAttempts).toBe(CHALLENGE_MAX_ATTEMPTS);
      expect(fila.resendAvailableAt.getTime()).toBeGreaterThanOrEqual(
        antes + CHALLENGE_RESEND_COOLDOWN_MS - 50,
      );
    });

    it('solo guarda datos sanitizados del dispositivo', async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const fila = retos.get('reto-1');
      expect(fila.deviceIdHash).toBe('hash-dispositivo');
      expect(fila.ipPreview).toBe('181.60.12.0');
      expect(JSON.stringify(fila)).not.toContain(USUARIO.email);
    });

    it('un reto nuevo invalida el anterior de la misma cuenta', async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const primero = codigoEnviado();
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });

      expect(retos.get('reto-1').revokedAt).toBeTruthy();
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code: primero,
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('si el correo falla, revoca el reto y lo dice sin dejar estado ambiguo', async () => {
      mail.sendDeviceVerificationEmail.mockRejectedValueOnce(
        new Error('SMTP caído'),
      );
      await expect(
        service.createChallenge({ user: USUARIO, context: CONTEXTO }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(retos.get('reto-1').revokedAt).toBeTruthy();
    });

    it('sin secreto configurado no crea nada', async () => {
      config.hmacSecret = null;
      await expect(
        service.createChallenge({ user: USUARIO, context: CONTEXTO }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.deviceVerificationChallenge.create).not.toHaveBeenCalled();
    });

    it('audita la creación sin el código ni el correo', async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const registro = audit.record.mock.calls[0][1];
      expect(registro.action).toBe('DEVICE_VERIFICATION_CHALLENGE_CREATED');
      expect(registro.actorUserId).toBe(USUARIO.id);
      const serializado = JSON.stringify(registro);
      expect(serializado).not.toContain(codigoEnviado());
      expect(serializado).not.toContain(USUARIO.email);
    });
  });

  describe('verifyChallenge', () => {
    let code: string;

    beforeEach(async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      code = codigoEnviado();
      audit.record.mockClear();
    });

    it('con el código correcto devuelve la cuenta y consume el reto', async () => {
      const user = await service.verifyChallenge({
        challengeId: 'reto-1',
        code,
        context: CONTEXTO,
      });
      expect(user.id).toBe(USUARIO.id);
      expect(retos.get('reto-1').consumedAt).toBeTruthy();
      expect(audit.record.mock.calls[0][1].action).toBe(
        'DEVICE_VERIFICATION_SUCCEEDED',
      );
    });

    it('el mismo código no sirve dos veces', async () => {
      await service.verifyChallenge({
        challengeId: 'reto-1',
        code,
        context: CONTEXTO,
      });
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dos verificaciones simultáneas del mismo código: solo una abre paso', async () => {
      const resultados = await Promise.allSettled([
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
      ]);
      const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
      expect(cumplidas).toHaveLength(1);
    });

    it('un código incorrecto gasta un intento y responde el mensaje genérico', async () => {
      const malo = code === '000000' ? '111111' : '000000';
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code: malo,
          context: CONTEXTO,
        }),
      ).rejects.toThrow(/no es válido o ya venció/);
      expect(retos.get('reto-1').attempts).toBe(1);
      expect(audit.record.mock.calls[0][1].action).toBe(
        'DEVICE_VERIFICATION_FAILED',
      );
    });

    it('al agotar los intentos el reto muere, incluso con el código correcto', async () => {
      const malo = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i++) {
        await expect(
          service.verifyChallenge({
            challengeId: 'reto-1',
            code: malo,
            context: CONTEXTO,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(retos.get('reto-1').attempts).toBe(CHALLENGE_MAX_ATTEMPTS);
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(retos.get('reto-1').consumedAt).toBeFalsy();
    });

    it('un reto vencido no se puede usar', async () => {
      retos.get('reto-1').expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin secreto configurado responde el mismo error genérico, no uno de configuración', async () => {
      // Un 503 aquí revelaría a cualquiera, sin autenticarse, si la
      // verificación está configurada en este servidor.
      config.hmacSecret = null;
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code,
          context: CONTEXTO,
        }),
      ).rejects.toThrow(/no es válido o ya venció/);
    });

    it('un identificador inexistente responde igual que un código incorrecto', async () => {
      await expect(
        service.verifyChallenge({
          challengeId: 'no-existe',
          code,
          context: CONTEXTO,
        }),
      ).rejects.toThrow(/no es válido o ya venció/);
    });

    it('un código con formato imposible ni siquiera gasta intento', async () => {
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code: 'abc',
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(retos.get('reto-1').attempts).toBe(0);
    });

    it('el código de un reto no vale en otro', async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
      const segundo = codigoEnviado();
      // El primero quedó revocado; se prueba el código nuevo contra el viejo.
      await expect(
        service.verifyChallenge({
          challengeId: 'reto-1',
          code: segundo,
          context: CONTEXTO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resendChallenge', () => {
    beforeEach(async () => {
      await service.createChallenge({ user: USUARIO, context: CONTEXTO });
    });

    it('antes de la espera mínima no reenvía y dice cuánto falta', async () => {
      await expect(
        service.resendChallenge({ challengeId: 'reto-1', context: CONTEXTO }),
      ).rejects.toThrow(/Espera \d+ segundos/);
      expect(mail.sendDeviceVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('pasada la espera envía un código nuevo e invalida el anterior', async () => {
      const anterior = codigoEnviado();
      retos.get('reto-1').resendAvailableAt = new Date(Date.now() - 1000);

      const vista = await service.resendChallenge({
        challengeId: 'reto-1',
        context: CONTEXTO,
      });

      expect(vista.challengeId).toBe('reto-2');
      expect(mail.sendDeviceVerificationEmail).toHaveBeenCalledTimes(2);
      expect(codigoEnviado()).not.toBe(anterior);
      expect(retos.get('reto-1').revokedAt).toBeTruthy();
    });

    it('no reenvía sobre un reto ya consumido', async () => {
      retos.get('reto-1').consumedAt = new Date();
      retos.get('reto-1').resendAvailableAt = new Date(Date.now() - 1000);
      await expect(
        service.resendChallenge({ challengeId: 'reto-1', context: CONTEXTO }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
