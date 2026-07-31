import {
  COMPONENTE_WORKER,
  HeartbeatService,
  INTERVALO_LATIDO_MS,
} from './heartbeat.service';
import { MARGEN_LATIDO_MS } from './system-health.service';

describe('HeartbeatService', () => {
  let prisma: any;
  let service: HeartbeatService;
  const entornoOriginal = process.env.WORKER_ROLE;

  beforeEach(() => {
    prisma = { systemHeartbeat: { upsert: jest.fn().mockResolvedValue({}) } };
    service = new HeartbeatService(prisma);
  });

  afterEach(() => {
    if (entornoOriginal === undefined) delete process.env.WORKER_ROLE;
    else process.env.WORKER_ROLE = entornoOriginal;
  });

  describe('quién late', () => {
    it('el worker late', async () => {
      process.env.WORKER_ROLE = 'queue';

      await service.latir();

      expect(prisma.systemHeartbeat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { component: COMPONENTE_WORKER } }),
      );
    });

    it('el backend NO late: ya se observa por HTTP', async () => {
      // Un latido suyo seria ruido, y ademas mentiria sobre el worker si
      // alguien lo confundiera.
      delete process.env.WORKER_ROLE;

      await service.latir();

      expect(prisma.systemHeartbeat.upsert).not.toHaveBeenCalled();
    });
  });

  describe('qué se guarda', () => {
    it('solo release y pid: nada sensible', async () => {
      await service.registrar(COMPONENTE_WORKER);

      const { create } = prisma.systemHeartbeat.upsert.mock.calls[0][0];
      expect(Object.keys(create.detail).sort()).toEqual(['pid', 'release']);
    });

    it('escribe detail tambien al actualizar, para que la marca avance', async () => {
      // `seenAt` es @updatedAt: si el update no cambiara ningun campo, Prisma
      // podria no tocar la fila y el latido se quedaria congelado mientras el
      // worker sigue vivo.
      await service.registrar(COMPONENTE_WORKER);

      const { update } = prisma.systemHeartbeat.upsert.mock.calls[0][0];
      expect(update.detail).toBeDefined();
    });
  });

  describe('tolerancia a fallos', () => {
    it('un fallo al latir no tumba el worker', async () => {
      prisma.systemHeartbeat.upsert.mockRejectedValue(new Error('base caida'));

      await expect(service.registrar('x')).resolves.toBeUndefined();
    });

    it('no repite el aviso si la base sigue caida', async () => {
      // Llenar el log durante una caida larga entierra el resto de pistas.
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      prisma.systemHeartbeat.upsert.mockRejectedValue(new Error('caida'));

      await service.registrar('x');
      await service.registrar('x');
      await service.registrar('x');

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('el aviso no incluye el mensaje del error', async () => {
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      prisma.systemHeartbeat.upsert.mockRejectedValue(
        new Error('password=s3cr3t host=10.0.0.5'),
      );

      await service.registrar('x');

      expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cr3t');
      warn.mockRestore();
    });
  });

  describe('márgenes', () => {
    it('el margen de vencimiento da holgura a tres latidos', async () => {
      // Con un solo latido de margen, una pausa del recolector de basura
      // bastaria para declarar muerto un worker sano.
      expect(MARGEN_LATIDO_MS).toBe(INTERVALO_LATIDO_MS * 3);
    });
  });
});
