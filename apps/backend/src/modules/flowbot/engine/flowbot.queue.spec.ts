import { FlowBotQueueService } from './flowbot.queue';

/**
 * Los `jobId` son la única defensa contra los trabajos duplicados, y también
 * son lo más fácil de romper sin enterarse: un doble de la cola guarda
 * cualquier cadena tan contento.
 *
 * Estas pruebas fijan las dos propiedades que BullMQ exige de verdad.
 */
describe('FlowBotQueueService — construcción de jobId', () => {
  const ids = [
    FlowBotQueueService.jobIdAvance('exec-1', 3, 2),
    FlowBotQueueService.jobIdDespertar('wait-1'),
    FlowBotQueueService.jobIdMensaje('exec-1', 'msg-1'),
  ];

  it('NINGUNO lleva dos puntos', () => {
    // BullMQ los rechaza —usa `:` como separador de sus claves de Redis— y el
    // rechazo llega como un `Error` genérico indistinguible de un Redis
    // caído: la ejecución se queda quieta para siempre y el log solo dice "no
    // se pudo encolar". Lo detectó la demostración autónoma, no la suite.
    for (const id of ids) {
      expect(id).not.toContain(':');
    }
  });

  it('ninguno es un número entero', () => {
    // La otra regla de BullMQ: un id que parsea a entero se rechaza porque
    // choca con los ids que él mismo genera.
    for (const id of ids) {
      expect(String(parseInt(id, 10))).not.toBe(id);
    }
  });

  it('el avance distingue paso e intento', () => {
    // Sin el paso, el segundo avance de la misma ejecución se descartaría como
    // duplicado del primero y la ejecución se quedaría parada para siempre.
    expect(FlowBotQueueService.jobIdAvance('e', 0)).not.toBe(
      FlowBotQueueService.jobIdAvance('e', 1),
    );
    expect(FlowBotQueueService.jobIdAvance('e', 0, 1)).not.toBe(
      FlowBotQueueService.jobIdAvance('e', 0, 2),
    );
  });

  it('el despertar depende SOLO de la espera', () => {
    // Una espera se consume una vez: así dos reconciliadores no encolan dos
    // despertares para la misma.
    expect(FlowBotQueueService.jobIdDespertar('w')).toBe(
      FlowBotQueueService.jobIdDespertar('w'),
    );
  });

  it('la reanudación por mensaje distingue mensajes del mismo paso', () => {
    // Dos mensajes seguidos del cliente están en el mismo paso; si el id
    // llevara el paso, el segundo se perdería.
    expect(FlowBotQueueService.jobIdMensaje('e', 'm1')).not.toBe(
      FlowBotQueueService.jobIdMensaje('e', 'm2'),
    );
  });

  it('es determinista: mismos datos, mismo id', () => {
    expect(FlowBotQueueService.jobIdAvance('e', 4, 1)).toBe(
      FlowBotQueueService.jobIdAvance('e', 4, 1),
    );
  });

  describe('encolado', () => {
    let servicio: FlowBotQueueService;
    let envAnterior: string | undefined;

    beforeEach(() => {
      envAnterior = process.env.QUEUE_ENABLED;
      delete process.env.QUEUE_ENABLED;
      servicio = new FlowBotQueueService();
    });

    afterEach(() => {
      process.env.QUEUE_ENABLED = envAnterior;
      if (envAnterior === undefined) delete process.env.QUEUE_ENABLED;
    });

    it('con la cola deshabilitada no encola y lo dice', async () => {
      process.env.QUEUE_ENABLED = 'false';

      await expect(
        servicio.encolarAvance(
          {
            tipo: 'avanzar',
            companyId: 'c',
            executionId: 'e',
            correlationId: 'k',
          },
          0,
        ),
      ).resolves.toBe(false);
    });

    it('un despertar sin espera no se encola', async () => {
      await expect(
        servicio.encolarDespertar(
          {
            tipo: 'despertar',
            companyId: 'c',
            executionId: 'e',
            correlationId: 'k',
          },
          new Date(),
        ),
      ).resolves.toBe(false);
    });

    it('una reanudación sin mensaje no se encola', async () => {
      await expect(
        servicio.encolarMensaje({
          tipo: 'avanzar',
          companyId: 'c',
          executionId: 'e',
          correlationId: 'k',
        }),
      ).resolves.toBe(false);
    });
  });
});
