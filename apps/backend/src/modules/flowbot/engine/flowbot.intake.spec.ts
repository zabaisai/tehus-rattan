import { dobleModoDemo } from '../../../common/demo/modo-demo.doble';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlowBotIntakeService } from './flowbot.intake';
import { FlowBotQueueService } from './flowbot.queue';
import { FlowBotRunnerService } from './flowbot.runner';
import { FlowBotSelectorService } from './flowbot.selector';
import { HandoffService } from '../../conversations/handoff.service';

/**
 * La puerta de entrada de FlowBot decide tres cosas por cada mensaje: si calla,
 * si reanuda o si arranca. Equivocarse en cualquiera de las tres se nota
 * enseguida en el móvil del cliente —dos bots contestando, o ninguno— así que
 * lo que se fija aquí es el ORDEN y las condiciones de cada rama.
 */
describe('FlowBotIntakeService', () => {
  let prisma: {
    conversation: { findFirst: jest.Mock };
    flowBotWait: { findFirst: jest.Mock };
    flowBotExecution: { findFirst: jest.Mock };
  };
  let outbox: { record: jest.Mock; markCompletedByKey: jest.Mock };
  let cola: { encolarMensaje: jest.Mock };
  let selector: { seleccionar: jest.Mock };
  let runner: { arrancar: jest.Mock };
  let handoff: { hayHandoffActivo: jest.Mock };
  let intake: FlowBotIntakeService;

  const mensaje = {
    companyId: 'emp-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    texto: 'hola',
  };

  beforeEach(() => {
    prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conv-1',
          isPaused: false,
          contactId: 'cont-1',
          contact: { archivedAt: null },
        }),
      },
      flowBotWait: { findFirst: jest.fn().mockResolvedValue(null) },
      flowBotExecution: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    outbox = {
      record: jest.fn().mockResolvedValue(true),
      markCompletedByKey: jest.fn().mockResolvedValue(undefined),
    };
    cola = { encolarMensaje: jest.fn().mockResolvedValue(true) };
    selector = {
      seleccionar: jest
        .fn()
        .mockResolvedValue({ elegidos: [], descartados: [] }),
    };
    // Por defecto NO hay nadie atendiendo: la mayoría de estas pruebas cubren
    // el camino con el bot al mando.
    handoff = { hayHandoffActivo: jest.fn().mockResolvedValue(false) };
    runner = {
      arrancar: jest
        .fn()
        .mockResolvedValue({ executionId: 'exec-nueva', creada: true }),
    };

    intake = new FlowBotIntakeService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
      cola as unknown as FlowBotQueueService,
      selector as unknown as FlowBotSelectorService,
      runner as unknown as FlowBotRunnerService,
      handoff as unknown as HandoffService,
      dobleModoDemo(),
    );
  });

  describe('conversación pausada', () => {
    it('calla si un asesor tomó el control', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        isPaused: true,
        contactId: 'cont-1',
        contact: { archivedAt: null },
      });

      const r = await intake.atenderMensaje(mensaje);

      // Que dos motores distintos respeten la misma señal es lo que hace que
      // «pausar» signifique algo para quien lo pulsa.
      expect(r).toEqual({ atendido: false, motivo: 'conversacion-pausada' });
      expect(runner.arrancar).not.toHaveBeenCalled();
      expect(cola.encolarMensaje).not.toHaveBeenCalled();
    });

    it('calla si la conversación no es de esta empresa', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      const r = await intake.atenderMensaje(mensaje);

      expect(r.atendido).toBe(false);
      expect(selector.seleccionar).not.toHaveBeenCalled();
    });
  });

  describe('reanudación por mensaje', () => {
    const esperaAbierta = {
      id: 'wait-1',
      wakeAt: null,
      execution: { id: 'exec-1', steps: 4, correlationId: 'corr-1' },
    };

    it('reanuda antes de plantearse arrancar nada', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      const r = await intake.atenderMensaje(mensaje);

      expect(r).toEqual({
        atendido: true,
        motivo: 'reanudada',
        executionId: 'exec-1',
      });
      // Al revés, el cliente que contesta a un bot arrancaría un segundo bot.
      expect(selector.seleccionar).not.toHaveBeenCalled();
      expect(runner.arrancar).not.toHaveBeenCalled();
    });

    it('persiste el evento ANTES de encolar', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);
      const orden: string[] = [];
      outbox.record.mockImplementation(async () => {
        orden.push('outbox');
        return true;
      });
      cola.encolarMensaje.mockImplementation(async () => {
        orden.push('cola');
        return true;
      });

      await intake.atenderMensaje(mensaje);

      // Al revés, morir entre encolar y persistir dejaría un trabajo apuntando
      // a algo que nadie registró.
      expect(orden).toEqual(['outbox', 'cola']);
    });

    it('el evento lleva identificadores y NUNCA el texto', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      await intake.atenderMensaje({ ...mensaje, texto: 'mi cédula es 123456' });

      const payload = outbox.record.mock.calls[0][1].payload;
      expect(payload).toEqual({
        executionId: 'exec-1',
        companyId: 'emp-1',
        waitId: 'wait-1',
        messageId: 'msg-1',
        correlationId: 'corr-1',
        paso: 4,
      });
      expect(JSON.stringify(payload)).not.toContain('cédula');
      expect(JSON.stringify(payload)).not.toContain('123456');
    });

    it('la clave de idempotencia identifica el mensaje, no el intento', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      await intake.atenderMensaje(mensaje);

      // Dos entregas del mismo webhook no pueden generar dos eventos.
      expect(outbox.record.mock.calls[0][1].idempotencyKey).toBe(
        'flowbot.advance:exec-1:msg:msg-1',
      );
    });

    it('el trabajo tampoco lleva el texto', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      await intake.atenderMensaje({ ...mensaje, texto: 'secreto' });

      const job = cola.encolarMensaje.mock.calls[0][0];
      expect(job).toEqual({
        tipo: 'avanzar',
        companyId: 'emp-1',
        executionId: 'exec-1',
        waitId: 'wait-1',
        messageId: 'msg-1',
        correlationId: 'corr-1',
      });
    });

    it('si encoló, completa el evento para ahorrarle trabajo al despachador', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      await intake.atenderMensaje(mensaje);

      expect(outbox.markCompletedByKey).toHaveBeenCalledWith(
        'flowbot.advance:exec-1:msg:msg-1',
      );
    });

    it('si Redis está caído sigue atendido: el despachador lo publicará', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);
      cola.encolarMensaje.mockResolvedValue(false);

      const r = await intake.atenderMensaje(mensaje);

      // El evento ya está persistido: no se pierde, solo tarda más.
      expect(r.atendido).toBe(true);
      expect(outbox.markCompletedByKey).not.toHaveBeenCalled();
    });

    it('NO consume la espera aquí: la consume el runner al avanzar', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue(esperaAbierta);

      await intake.atenderMensaje(mensaje);

      // Consumirla aquí y morir antes de escribir el evento dejaría la
      // ejecución despierta sin nada que la despertara.
      expect(
        (prisma.flowBotWait as unknown as { updateMany?: unknown }).updateMany,
      ).toBeUndefined();
    });

    it('busca solo esperas de entrada sin consumir de esta empresa', async () => {
      await intake.atenderMensaje(mensaje);

      expect(prisma.flowBotWait.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'emp-1',
            kind: 'INPUT',
            consumedAt: null,
            execution: {
              conversationId: 'conv-1',
              status: 'WAITING_INPUT',
            },
          },
        }),
      );
    });

    it('un mensaje que llega tras vencer el plazo NO reanuda', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue({
        ...esperaAbierta,
        wakeAt: new Date(Date.now() - 60_000),
      });

      const r = await intake.atenderMensaje(mensaje);

      // La ejecución tiene que salir por su puerto de tiempo agotado. Si las
      // dos salidas compitieran por la misma espera, cuál gana dependería del
      // orden en que se procesaran los trabajos.
      expect(r).toEqual({ atendido: false, motivo: 'espera-vencida' });
      expect(outbox.record).not.toHaveBeenCalled();
    });

    it('un plazo aún vigente sí reanuda', async () => {
      prisma.flowBotWait.findFirst.mockResolvedValue({
        ...esperaAbierta,
        wakeAt: new Date(Date.now() + 60_000),
      });

      const r = await intake.atenderMensaje(mensaje);

      expect(r.atendido).toBe(true);
    });
  });

  describe('arranque', () => {
    const candidato = {
      flowBotId: 'bot-1',
      triggerId: 'trg-1',
      versionId: 'ver-1',
      prioridad: 10,
      exclusivo: true,
      nombre: 'Bienvenida',
    };

    it('arranca el bot elegido con el mensaje como llave del hecho', async () => {
      selector.seleccionar.mockResolvedValue({
        elegidos: [candidato],
        descartados: [],
      });

      const r = await intake.atenderMensaje(mensaje);

      expect(r).toEqual({
        atendido: true,
        motivo: 'arrancada',
        executionId: 'exec-nueva',
      });
      expect(runner.arrancar).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'emp-1',
          flowBotId: 'bot-1',
          versionId: 'ver-1',
          eventKey: 'msg-1',
          triggerMessageId: 'msg-1',
          conversationId: 'conv-1',
          contactId: 'cont-1',
        }),
      );
    });

    it('solo arranca el primero aunque el selector devuelva varios', async () => {
      selector.seleccionar.mockResolvedValue({
        elegidos: [candidato, { ...candidato, flowBotId: 'bot-2' }],
        descartados: [],
      });

      await intake.atenderMensaje(mensaje);

      // Arrancar varios sobre la misma conversación es justo lo que la
      // exclusividad existe para evitar.
      expect(runner.arrancar).toHaveBeenCalledTimes(1);
    });

    it('no arranca si ya hay una ejecución viva en la conversación', async () => {
      prisma.flowBotExecution.findFirst.mockResolvedValue({ id: 'exec-viva' });
      selector.seleccionar.mockResolvedValue({
        elegidos: [candidato],
        descartados: [],
      });

      const r = await intake.atenderMensaje(mensaje);

      // Un cliente impaciente que escribe tres veces no puede acabar con tres
      // bots contestándole.
      expect(r.motivo).toBe('ya-hay-ejecucion');
      expect(runner.arrancar).not.toHaveBeenCalled();
      expect(selector.seleccionar).not.toHaveBeenCalled();
    });

    it('considera vivas RUNNING, WAITING_INPUT y WAITING_TIME', async () => {
      await intake.atenderMensaje(mensaje);

      expect(prisma.flowBotExecution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_TIME'] },
          }),
        }),
      );
    });

    it('sin bots aplicables no atiende y deja pasar el resto del flujo', async () => {
      const r = await intake.atenderMensaje(mensaje);

      expect(r).toEqual({ atendido: false, motivo: 'sin-bot' });
    });

    it('un arranque repetido no es un fallo', async () => {
      // Reintento del webhook: la clave de idempotencia devolvió la existente.
      selector.seleccionar.mockResolvedValue({
        elegidos: [candidato],
        descartados: [],
      });
      runner.arrancar.mockResolvedValue({
        executionId: 'exec-1',
        creada: false,
      });

      const r = await intake.atenderMensaje(mensaje);

      expect(r).toEqual({
        atendido: true,
        motivo: 'arrancada',
        executionId: 'exec-1',
      });
    });

    it('pasa el texto al selector para los disparadores por palabra clave', async () => {
      await intake.atenderMensaje({ ...mensaje, texto: 'quiero cotizar' });

      expect(selector.seleccionar).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo: 'INBOUND_MESSAGE',
          texto: 'quiero cotizar',
        }),
      );
    });
  });

  describe('resistencia', () => {
    it('un fallo de FlowBot NO impide que el mensaje se procese', async () => {
      prisma.conversation.findFirst.mockRejectedValue(new Error('base caída'));

      const r = await intake.atenderMensaje(mensaje);

      // Preferimos una conversación sin respuesta automática a un mensaje
      // perdido: devolver "no atendido" deja seguir a automatizaciones y aviso.
      expect(r).toEqual({ atendido: false, motivo: 'error' });
    });

    it('un fallo al arrancar tampoco propaga', async () => {
      selector.seleccionar.mockResolvedValue({
        elegidos: [
          {
            flowBotId: 'b',
            triggerId: 't',
            versionId: 'v',
            prioridad: 1,
            exclusivo: false,
            nombre: 'X',
          },
        ],
        descartados: [],
      });
      runner.arrancar.mockRejectedValue(new Error('choque'));

      await expect(intake.atenderMensaje(mensaje)).resolves.toEqual({
        atendido: false,
        motivo: 'error',
      });
    });
  });
});
