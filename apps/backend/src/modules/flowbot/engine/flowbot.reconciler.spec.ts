import {
  ABANDONO_MS,
  ATASCO_MS,
  FlowBotReconcilerService,
  LOTE,
  MAX_RECUPERACIONES,
} from './flowbot.reconciler';
import { LEASE_MS } from './flowbot.runner';

/**
 * El reconciliador es la red de seguridad del motor: lo que hace que una cola
 * vacía o un worker muerto se traduzcan en "tarda un minuto más" y no en "esa
 * conversación se quedó sin respuesta para siempre".
 *
 * Lo que se fija aquí no es que detecte —eso es una consulta— sino las tres
 * propiedades sin las cuales haría más daño que bien: que no repita, que no
 * invente, y que no se pise con otra instancia.
 */
describe('FlowBotReconcilerService', () => {
  let prisma: any;
  let cola: any;
  let outbox: any;
  let rec: FlowBotReconcilerService;

  const vacio = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({}),
  });

  beforeEach(() => {
    prisma = {
      flowBotExecution: vacio(),
      flowBotWait: vacio(),
      flowBotExecutionStep: vacio(),
      outboxEvent: vacio(),
    };
    cola = {
      encolarAvance: jest.fn().mockResolvedValue(true),
      encolarDespertar: jest.fn().mockResolvedValue(true),
      cancelarDespertar: jest.fn().mockResolvedValue(undefined),
    };
    outbox = { record: jest.fn(), markCompletedByKey: jest.fn() };

    rec = new FlowBotReconcilerService(prisma, cola, outbox);
  });

  describe('acotado y resistente', () => {
    it('nunca mira más de LOTE filas por condición', async () => {
      await rec.reconciliar();

      // Un incidente con diez mil ejecuciones colgadas no puede convertirse en
      // la consulta que tumba la base mientras intenta arreglarlo.
      for (const llamada of prisma.flowBotExecution.findMany.mock.calls) {
        expect(llamada[0].take).toBe(LOTE);
      }
      for (const llamada of prisma.flowBotWait.findMany.mock.calls) {
        expect(llamada[0].take).toBe(LOTE);
      }
    });

    it('una condición que falla no impide revisar las demás', async () => {
      prisma.flowBotWait.findMany.mockRejectedValue(new Error('timeout'));

      const informe = await rec.reconciliar();

      // Las de ejecuciones se consultaron igual.
      expect(prisma.flowBotExecution.findMany).toHaveBeenCalled();
      expect(informe.detectado['esperas-vencidas:error']).toBe(1);
    });

    it('un pase con todo sano no repara nada ni degrada', async () => {
      const informe = await rec.reconciliar();

      expect(informe.reparado).toEqual({});
      expect(informe.degradado).toBe(false);
      expect(cola.encolarAvance).not.toHaveBeenCalled();
    });

    it('dos pases seguidos no se solapan', async () => {
      let soltar: () => void = () => undefined;
      let llamadas = 0;
      prisma.flowBotWait.findMany.mockImplementation(() => {
        llamadas += 1;
        if (llamadas > 1) return Promise.resolve([]);
        return new Promise((r) => (soltar = () => r([])));
      });

      const primero = rec.pasar();
      await rec.pasar(); // debe salir de inmediato

      // Solaparse duplicaría cada reparación: dos avances encolados por
      // ejecución atascada, dos marcas de revisión.
      expect(llamadas).toBe(1);

      soltar();
      await primero;
    });
  });

  describe('esperas vencidas: el fallo más dañino', () => {
    const wakeAt = new Date('2026-01-01T09:00:00.000Z');
    const ahora = new Date('2026-01-01T10:00:00.000Z');

    beforeEach(() => {
      prisma.flowBotWait.findMany.mockImplementation((args: any) =>
        args.where?.wakeAt
          ? Promise.resolve([
              {
                id: 'wait-1',
                wakeAt,
                companyId: 'emp-1',
                execution: { id: 'exec-1', correlationId: 'corr-1' },
              },
            ])
          : Promise.resolve([]),
      );
    });

    it('reencola el despertar que nunca llegó', async () => {
      const informe = await rec.reconciliar(ahora);

      expect(cola.encolarDespertar).toHaveBeenCalledWith(
        {
          tipo: 'despertar',
          companyId: 'emp-1',
          executionId: 'exec-1',
          waitId: 'wait-1',
          correlationId: 'corr-1',
        },
        wakeAt,
      );
      expect(informe.reparado['esperas-vencidas']).toBe(1);
    });

    it('NO avanza la ejecución aquí: solo la devuelve a la cola', async () => {
      await rec.reconciliar(ahora);

      // Quien avanza es el consumidor, con su lease. Avanzar desde aquí sería
      // un segundo camino de ejecución sin exclusión mutua.
      expect(prisma.flowBotExecution.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ steps: expect.anything() }),
        }),
      );
    });

    it('si la cola no acepta, no lo cuenta como reparado', async () => {
      cola.encolarDespertar.mockResolvedValue(false);

      const informe = await rec.reconciliar(ahora);

      expect(informe.detectado['esperas-vencidas']).toBe(1);
      expect(informe.reparado['esperas-vencidas']).toBeUndefined();
    });
  });

  describe('ejecuciones atascadas', () => {
    const ahora = new Date('2026-01-01T10:00:00.000Z');
    const atascada = {
      id: 'exec-1',
      companyId: 'emp-1',
      correlationId: 'corr-1',
      steps: 7,
      recoveries: 0,
    };

    const soloAtascadas = (args: any) =>
      args.where?.status === 'RUNNING' && args.where?.lastStepAt
        ? Promise.resolve([atascada])
        : Promise.resolve([]);

    it('reencola con el paso actual, que es lo que hace el jobId idempotente', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloAtascadas);

      await rec.reconciliar(ahora);

      // Si el trabajo original siguiera en la cola, este se descartaría por
      // duplicado. Esa garantía es la que hace seguro pasar cada minuto.
      expect(cola.encolarAvance).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: 'exec-1' }),
        7,
      );
    });

    it('no toca ejecuciones con lease vivo', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloAtascadas);

      await rec.reconciliar(ahora);

      const where = prisma.flowBotExecution.findMany.mock.calls.find(
        (c: any[]) =>
          c[0].where?.status === 'RUNNING' && c[0].where?.lastStepAt,
      )[0].where;

      // Con lease activo hay alguien trabajando: meterse crearía la
      // duplicación que el lease existe para evitar.
      expect(where.OR).toEqual([
        { leaseUntil: null },
        { leaseUntil: { lt: ahora } },
      ]);
      expect(where.lastStepAt.lt.getTime()).toBe(ahora.getTime() - ATASCO_MS);
    });

    it('sube el contador de recuperaciones con el valor esperado en el where', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloAtascadas);

      await rec.reconciliar(ahora);

      // Si otra instancia ya lo subió, esta no lo vuelve a subir y el número
      // sigue significando algo.
      expect(prisma.flowBotExecution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1', recoveries: 0 },
          data: expect.objectContaining({ recoveries: 1 }),
        }),
      );
    });

    it('deja de reencolar las que ya agotaron sus recuperaciones', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloAtascadas);

      await rec.reconciliar(ahora);

      const where = prisma.flowBotExecution.findMany.mock.calls.find(
        (c: any[]) =>
          c[0].where?.status === 'RUNNING' && c[0].where?.lastStepAt,
      )[0].where;
      expect(where.recoveries).toEqual({ lt: MAX_RECUPERACIONES });
    });
  });

  describe('leases vencidos: no repetir un efecto que no se puede probar', () => {
    const ahora = new Date('2026-01-01T10:00:00.000Z');
    const leaseUntil = new Date(ahora.getTime() - 5 * 60_000);
    const conLease = {
      id: 'exec-1',
      companyId: 'emp-1',
      correlationId: 'corr-1',
      steps: 3,
      recoveries: 0,
      leaseUntil,
      currentNodeId: 'nodo-3',
    };

    const soloLeases = (args: any) =>
      args.where?.leaseOwner
        ? Promise.resolve([conLease])
        : Promise.resolve([]);

    it('SIN paso registrado tras el lease, marca NEEDS_ATTENTION y no reencola', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue(null);
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      // El worker pudo morir DESPUÉS de mandar el WhatsApp y antes de
      // persistir el paso. Reintentar se lo mandaría dos veces.
      expect(cola.encolarAvance).not.toHaveBeenCalled();
      expect(prisma.flowBotExecution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'NEEDS_ATTENTION',
            attentionReason: 'lease-vencido-sin-paso-registrado',
          }),
        }),
      );
    });

    it('CON paso registrado, libera el lease y reencola', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue({ id: 'step-1' });
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      // El efecto está probado y su clave de idempotencia lo protege.
      expect(cola.encolarAvance).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: 'exec-1' }),
        3,
      );
    });

    it('busca el paso desde que se TOMÓ el lease, no desde que venció', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue({ id: 's' });
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      const desde =
        prisma.flowBotExecutionStep.findFirst.mock.calls[0][0].where.createdAt
          .gte;
      expect(desde.getTime()).toBe(leaseUntil.getTime() - LEASE_MS);
    });

    it('si otra instancia ya liberó el lease, esta se retira', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue({ id: 's' });
      // El `where` incluye el leaseUntil leído: si cambió, no actualiza.
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 0 });

      await rec.reconciliar(ahora);

      expect(cola.encolarAvance).not.toHaveBeenCalled();
    });

    it('marcar para revisión suelta el lease', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue(null);
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      // Dejarlo puesto obligaría a una reanudación manual a esperar a que
      // venciera.
      const data = prisma.flowBotExecution.updateMany.mock.calls[0][0].data;
      expect(data.leaseOwner).toBeNull();
      expect(data.leaseUntil).toBeNull();
    });

    it('deja rastro en la línea de tiempo, con clave que impide duplicarlo', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue(null);
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      expect(prisma.flowBotExecutionStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nodeType: 'system.reconcile',
            idempotencyKey:
              'reconcile:exec-1:lease-vencido-sin-paso-registrado',
          }),
        }),
      );
    });

    it('no cuenta dos veces lo que ya había marcado otra instancia', async () => {
      prisma.flowBotExecution.findMany.mockImplementation(soloLeases);
      prisma.flowBotExecutionStep.findFirst.mockResolvedValue(null);
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 0 });

      await rec.reconciliar(ahora);

      expect(prisma.flowBotExecutionStep.create).not.toHaveBeenCalled();
    });
  });

  describe('limpieza de esperas', () => {
    it('consume las de ejecuciones que ya terminaron y retira su trabajo', async () => {
      prisma.flowBotWait.findMany.mockImplementation((args: any) =>
        args.where?.execution?.status?.in?.includes('COMPLETED')
          ? Promise.resolve([{ id: 'wait-9' }])
          : Promise.resolve([]),
      );
      prisma.flowBotWait.updateMany.mockResolvedValue({ count: 1 });

      const informe = await rec.reconciliar();

      expect(informe.reparado['esperas-huerfanas']).toBe(1);
      // Sin retirar el trabajo, al vencer intentaría despertar algo terminado.
      expect(cola.cancelarDespertar).toHaveBeenCalledWith('wait-9');
    });

    it('consume también las de canceladas y las que esperan revisión', async () => {
      prisma.flowBotWait.findMany.mockImplementation((args: any) =>
        args.where?.execution?.status?.in?.includes('CANCELLED')
          ? Promise.resolve([{ id: 'wait-c' }])
          : Promise.resolve([]),
      );
      prisma.flowBotWait.updateMany.mockResolvedValue({ count: 1 });

      const informe = await rec.reconciliar();

      expect(informe.reparado['esperas-de-canceladas']).toBe(1);
    });
  });

  describe('cierres que sí sabemos hacer', () => {
    it('cancela las ejecuciones de un bot archivado', async () => {
      prisma.flowBotExecution.findMany.mockImplementation((args: any) =>
        args.where?.flowBot?.status === 'ARCHIVED'
          ? Promise.resolve([{ id: 'exec-arch' }])
          : Promise.resolve([]),
      );
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      const informe = await rec.reconciliar();

      // Seguir ejecutándolo sería contestarle a un cliente con un flujo que su
      // dueño retiró a propósito.
      expect(informe.reparado['version-desaparecida']).toBe(1);
      expect(prisma.flowBotExecution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ endedReason: 'bot-archivado' }),
        }),
      );
    });

    it('cierra las abandonadas con un motivo propio', async () => {
      const ahora = new Date('2026-02-01T00:00:00.000Z');
      prisma.flowBotExecution.findMany.mockImplementation((args: any) =>
        args.where?.startedAt
          ? Promise.resolve([{ id: 'exec-vieja' }])
          : Promise.resolve([]),
      );
      prisma.flowBotExecution.updateMany.mockResolvedValue({ count: 1 });

      await rec.reconciliar(ahora);

      const llamada = prisma.flowBotExecution.findMany.mock.calls.find(
        (c: any[]) => c[0].where?.startedAt,
      )[0];
      expect(llamada.where.startedAt.lt.getTime()).toBe(
        ahora.getTime() - ABANDONO_MS,
      );
      // Motivo propio para que no se confunda con una cancelación humana en
      // las métricas.
      expect(prisma.flowBotExecution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            endedReason: 'abandonada-por-inactividad',
          }),
        }),
      );
    });
  });

  describe('degradado, no enfermo', () => {
    it('degrada si hay ejecuciones esperando revisión', async () => {
      prisma.flowBotExecution.count.mockResolvedValue(2);

      const informe = await rec.reconciliar();

      expect(informe.necesitanAtencion).toBe(2);
      expect(informe.degradado).toBe(true);
    });

    it('degrada si hay eventos de outbox agotados', async () => {
      prisma.outboxEvent.count.mockImplementation((args: any) =>
        args.where?.status === 'FAILED'
          ? Promise.resolve(3)
          : Promise.resolve(0),
      );

      const informe = await rec.reconciliar();

      // Cada uno es un avance o un despertar que nunca llegó a la cola.
      expect(informe.detectado['outbox-fallido']).toBe(3);
      expect(informe.degradado).toBe(true);
    });

    it('un outbox atrasado se cuenta pero NO se repara aquí', async () => {
      prisma.outboxEvent.count.mockImplementation((args: any) =>
        args.where?.status === 'PENDING'
          ? Promise.resolve(9)
          : Promise.resolve(0),
      );

      const informe = await rec.reconciliar();

      // El despachador es quien publica; duplicar ese camino podría publicar
      // dos veces el mismo evento.
      expect(informe.detectado['outbox-atrasado']).toBe(9);
      expect(informe.reparado['outbox-atrasado']).toBeUndefined();
    });

    it('el estado que publica no lleva datos de clientes', async () => {
      await rec.reconciliar();

      const estado = rec.estado();
      expect(Object.keys(estado)).toEqual([
        'pases',
        'ultimoPaseEn',
        'degradado',
        'ultimoInforme',
      ]);
      expect(estado.pases).toBe(1);
    });
  });
});
