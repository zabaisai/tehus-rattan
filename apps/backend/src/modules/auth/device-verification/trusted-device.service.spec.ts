import { TrustedDeviceService } from './trusted-device.service';
import { hashToken } from '../../sessions/utils/token.util';
import { TRUSTED_DEVICE_TTL_MS } from './device-verification.constants';

const CONTEXTO = {
  deviceIdHash: 'hash-dispositivo',
  ipPreview: '181.60.12.0',
  browser: 'Chrome 152',
  operatingSystem: 'Windows',
  deviceType: 'DESKTOP' as const,
};
const USUARIO = {
  id: 'user-1',
  role: 'ADMIN' as const,
  companyId: 'company-1',
};

describe('TrustedDeviceService', () => {
  let prisma: any;
  let audit: any;
  let service: TrustedDeviceService;
  let filas: any[];

  beforeEach(() => {
    filas = [];
    prisma = {
      trustedDevice: {
        create: jest.fn(async ({ data }: any) => {
          const fila = { id: `td-${filas.length + 1}`, ...data };
          filas.push(fila);
          return { id: fila.id };
        }),
        findFirst: jest.fn(
          async ({ where }: any) =>
            filas.find(
              (f) =>
                f.tokenHash === where.tokenHash &&
                f.userId === where.userId &&
                (where.revokedAt !== null || f.revokedAt == null) &&
                (!where.expiresAt?.gt || f.expiresAt > where.expiresAt.gt),
            ) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const fila = filas.find((f) => f.id === where.id);
          Object.assign(fila, data);
          return fila;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const f of filas) {
            if (where.userId && f.userId !== where.userId) continue;
            if (where.tokenHash && f.tokenHash !== where.tokenHash) continue;
            if (where.revokedAt === null && f.revokedAt) continue;
            Object.assign(f, data);
            count++;
          }
          return { count };
        }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new TrustedDeviceService(prisma, audit);
  });

  describe('trustDevice', () => {
    it('devuelve un token opaco y guarda SOLO su hash', async () => {
      const token = await service.trustDevice({
        user: USUARIO,
        context: CONTEXTO,
      });

      expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes en hexadecimal
      expect(filas[0].tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(filas[0])).not.toContain(token);
    });

    it('dos dispositivos nunca comparten token', async () => {
      const a = await service.trustDevice({ user: USUARIO, context: CONTEXTO });
      const b = await service.trustDevice({ user: USUARIO, context: CONTEXTO });
      expect(a).not.toBe(b);
    });

    it('caduca a los 30 días', async () => {
      const antes = Date.now();
      await service.trustDevice({ user: USUARIO, context: CONTEXTO });
      const diferencia = filas[0].expiresAt.getTime() - antes;
      expect(diferencia).toBeGreaterThan(TRUSTED_DEVICE_TTL_MS - 5000);
      expect(diferencia).toBeLessThanOrEqual(TRUSTED_DEVICE_TTL_MS + 5000);
    });

    it('audita la creación sin el token', async () => {
      const token = await service.trustDevice({
        user: USUARIO,
        context: CONTEXTO,
      });
      const registro = audit.record.mock.calls[0][1];
      expect(registro.action).toBe('TRUSTED_DEVICE_CREATED');
      expect(JSON.stringify(registro)).not.toContain(token);
    });
  });

  describe('isTrusted', () => {
    let token: string;

    beforeEach(async () => {
      token = await service.trustDevice({ user: USUARIO, context: CONTEXTO });
    });

    it('reconoce el dispositivo de su propio dueño', async () => {
      await expect(service.isTrusted(USUARIO.id, token)).resolves.toBe(true);
    });

    it('el token de una cuenta NO sirve para otra', async () => {
      await expect(service.isTrusted('otro-usuario', token)).resolves.toBe(
        false,
      );
    });

    it('sin token no hay confianza', async () => {
      await expect(service.isTrusted(USUARIO.id, null)).resolves.toBe(false);
      await expect(service.isTrusted(USUARIO.id, '')).resolves.toBe(false);
    });

    it('un token inventado no cuela', async () => {
      await expect(service.isTrusted(USUARIO.id, 'a'.repeat(64))).resolves.toBe(
        false,
      );
    });

    it('un dispositivo vencido deja de valer', async () => {
      filas[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.isTrusted(USUARIO.id, token)).resolves.toBe(false);
    });

    it('un dispositivo revocado deja de valer', async () => {
      filas[0].revokedAt = new Date();
      await expect(service.isTrusted(USUARIO.id, token)).resolves.toBe(false);
    });

    it('renueva el último uso sin alargar la vigencia', async () => {
      const vence = filas[0].expiresAt;
      await service.isTrusted(USUARIO.id, token);
      expect(prisma.trustedDevice.update).toHaveBeenCalled();
      expect(filas[0].expiresAt).toBe(vence);
    });
  });

  describe('revocación', () => {
    it('revokeAllForUser retira todos los dispositivos vigentes de la cuenta', async () => {
      const a = await service.trustDevice({ user: USUARIO, context: CONTEXTO });
      const b = await service.trustDevice({ user: USUARIO, context: CONTEXTO });

      const revocados = await service.revokeAllForUser(USUARIO.id);

      expect(revocados).toBe(2);
      await expect(service.isTrusted(USUARIO.id, a)).resolves.toBe(false);
      await expect(service.isTrusted(USUARIO.id, b)).resolves.toBe(false);
    });

    it('acepta el cliente de una transacción para escribirlo junto al resto', async () => {
      const tx = {
        trustedDevice: {
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
      };
      await expect(
        service.revokeAllForUser('user-1', tx as never),
      ).resolves.toBe(3);
      expect(prisma.trustedDevice.updateMany).not.toHaveBeenCalled();
    });

    it('la revocación pedida por la persona queda auditada, sin el token', async () => {
      const token = await service.trustDevice({
        user: USUARIO,
        context: CONTEXTO,
      });
      audit.record.mockClear();

      const revocados = await service.revokeAllForUserAudited(USUARIO);

      expect(revocados).toBe(1);
      const registro = audit.record.mock.calls[0][1];
      expect(registro.action).toBe('TRUSTED_DEVICE_REVOKED');
      expect(registro.metadata).toEqual({ revoked: 1, scope: 'self' });
      expect(JSON.stringify(registro)).not.toContain(token);
    });

    it('sin dispositivos que revocar no escribe auditoría', async () => {
      audit.record.mockClear();
      await expect(service.revokeAllForUserAudited(USUARIO)).resolves.toBe(0);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('revokeByToken retira solo ese dispositivo', async () => {
      const a = await service.trustDevice({ user: USUARIO, context: CONTEXTO });
      const b = await service.trustDevice({ user: USUARIO, context: CONTEXTO });

      await service.revokeByToken(USUARIO.id, a);

      await expect(service.isTrusted(USUARIO.id, a)).resolves.toBe(false);
      await expect(service.isTrusted(USUARIO.id, b)).resolves.toBe(true);
    });
  });
});
