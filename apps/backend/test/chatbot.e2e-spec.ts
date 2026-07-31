import { PrismaService } from '../src/prisma/prisma.service';
import { ChatbotService } from '../src/modules/chatbot/chatbot.service';
import { ChatbotFlowsService } from '../src/modules/chatbot/chatbot-flows.service';
import type { FlujoChatbot } from '../src/modules/chatbot/chatbot.nodes';

/**
 * Chatbot v1 contra base REAL.
 *
 * La sesion unica por conversacion la garantiza un indice parcial de
 * PostgreSQL; con un doble de Prisma la prueba solo comprobaria que el doble
 * hace lo que yo le dije. Requiere `docker-compose up -d postgres`.
 */
describe('Chatbot v1 (e2e, base real)', () => {
  let prisma: PrismaService;
  let chatbot: ChatbotService;
  let flows: ChatbotFlowsService;

  const whatsapp = {
    sendMessage: jest.fn().mockResolvedValue('wamid-1'),
    // El chatbot responde por donde entro la conversacion.
    sendFromConversation: jest.fn().mockResolvedValue('wamid-1'),
  };
  const messages = { create: jest.fn().mockResolvedValue({ id: 'm1' }) };
  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
  };
  const assignment = {
    pickNextAgent: jest.fn().mockResolvedValue(null),
    warnNobodyAvailable: jest.fn().mockResolvedValue(undefined),
  };

  let empresaId: string;
  let flujoId: string;
  let asesorId: string;

  const DEFINICION: FlujoChatbot = {
    start: 'bienvenida',
    nodes: [
      {
        id: 'bienvenida',
        type: 'menu',
        text: 'Hola, ¿qué necesitas?',
        options: [
          { label: 'Precio', next: 'pedirNombre' },
          { label: 'Asesor', next: 'handoff' },
        ],
      },
      {
        id: 'pedirNombre',
        type: 'question',
        text: '¿Cómo te llamas?',
        saveAs: 'nombre',
        next: 'saludo',
      },
      {
        id: 'saludo',
        type: 'message',
        text: 'Gracias {{nombre}}, aquí va el precio.',
        next: 'fin',
      },
      { id: 'fin', type: 'end', text: 'Cuesta 100.' },
      { id: 'handoff', type: 'handoff', text: 'Te paso con una persona.' },
    ],
  };

  const nuevaConversacion = async (opciones: { isPaused?: boolean } = {}) => {
    const contacto = await prisma.contact.create({
      data: {
        companyId: empresaId,
        phone: `+1666${Math.random().toString().slice(2, 9)}`,
        name: 'Contacto bot',
      },
    });
    const conv = await prisma.conversation.create({
      data: {
        companyId: empresaId,
        contactId: contacto.id,
        isPaused: opciones.isPaused ?? false,
      },
    });
    return conv.id;
  };

  const entra = (conversationId: string, text: string) =>
    chatbot.handleInbound({
      companyId: empresaId,
      conversationId,
      contactPhone: '+16660000000',
      text,
    });

  /** Textos que el bot mando en esta interaccion. */
  const enviados = () =>
    // `sendFromConversation(companyId, conversationId, to, texto)`: el texto
    // es el CUARTO argumento. El bot responde por el numero de la
    // conversacion, no siempre desde el principal.
    whatsapp.sendFromConversation.mock.calls.map((c) => String(c[3]));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    flows = new ChatbotFlowsService(prisma);
    chatbot = new ChatbotService(
      prisma,
      whatsapp as never,
      messages as never,
      notifications as never,
      assignment as never,
    );

    const empresa = await prisma.company.create({
      data: { name: 'E2E Chatbot Co' },
    });
    empresaId = empresa.id;

    const asesor = await prisma.user.create({
      data: {
        companyId: empresaId,
        email: `chatbot-${Date.now()}@example.test`,
        password: 'x',
        name: 'Asesor bot',
        role: 'AGENT',
      },
    });
    asesorId = asesor.id;

    const flujo = await flows.create(empresaId, {
      name: 'Flujo de prueba',
      draftNodes: DEFINICION,
    });
    flujoId = flujo.id;
    await flows.publish(flujoId, empresaId);
    await flows.updateDraft(flujoId, empresaId, { isActive: true });
  });

  afterAll(async () => {
    await prisma.chatbotSession.deleteMany({ where: { companyId: empresaId } });
    await prisma.chatbotFlowVersion.deleteMany({
      where: { flow: { companyId: empresaId } },
    });
    await prisma.chatbotFlow.deleteMany({ where: { companyId: empresaId } });
    await prisma.message.deleteMany({
      where: { conversation: { companyId: empresaId } },
    });
    await prisma.conversation.deleteMany({ where: { companyId: empresaId } });
    await prisma.contact.deleteMany({ where: { companyId: empresaId } });
    await prisma.user.deleteMany({ where: { companyId: empresaId } });
    await prisma.company.delete({ where: { id: empresaId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    whatsapp.sendFromConversation.mockClear();
    messages.create.mockClear();
    notifications.emit.mockClear();
    notifications.emitToCompanyRoles.mockClear();
    assignment.pickNextAgent.mockClear();
    assignment.pickNextAgent.mockResolvedValue(null);
  });

  describe('inicio', () => {
    it('el primer mensaje abre sesión y envía el nodo inicial', async () => {
      const conv = await nuevaConversacion();

      const r = await entra(conv, 'hola');

      expect(r.atendido).toBe(true);
      expect(enviados()[0]).toContain('¿qué necesitas?');
      const sesion = await prisma.chatbotSession.findFirst({
        where: { conversationId: conv },
      });
      expect(sesion?.status).toBe('ACTIVE');
    });

    it('el menú se envía NUMERADO: por WhatsApp no hay botones', async () => {
      const conv = await nuevaConversacion();

      await entra(conv, 'hola');

      expect(enviados()[0]).toContain('1. Precio');
      expect(enviados()[0]).toContain('2. Asesor');
    });

    it('el mensaje del bot queda en el hilo como cualquier saliente', async () => {
      const conv = await nuevaConversacion();

      await entra(conv, 'hola');

      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'OUTBOUND', status: 'SENT' }),
      );
    });

    it('una conversación PAUSADA silencia al bot', async () => {
      // Es el interruptor que ya usa el asesor cuando toma el control.
      const conv = await nuevaConversacion({ isPaused: true });

      const r = await entra(conv, 'hola');

      expect(r.atendido).toBe(false);
      expect(whatsapp.sendFromConversation).not.toHaveBeenCalled();
    });

    it('sin flujo activo no atiende y deja pasar el resto del procesamiento', async () => {
      await flows.updateDraft(flujoId, empresaId, { isActive: false });
      const conv = await nuevaConversacion();

      const r = await entra(conv, 'hola');

      expect(r.atendido).toBe(false);
      expect(r.motivo).toBe('sin-flujo');
      await flows.updateDraft(flujoId, empresaId, { isActive: true });
    });
  });

  describe('avance por el flujo', () => {
    it('una opción del menú lleva al nodo correcto', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      whatsapp.sendFromConversation.mockClear();

      await entra(conv, '1');

      expect(enviados()[0]).toContain('¿Cómo te llamas?');
    });

    it('una respuesta que no se entiende REPITE el menú en vez de adivinar', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      whatsapp.sendFromConversation.mockClear();

      await entra(conv, 'no sé qué escribir');

      expect(enviados()[0]).toContain('¿qué necesitas?');
    });

    it('guarda la respuesta y la usa más adelante', async () => {
      // Es lo que permite preguntar el nombre en el paso 1 y usarlo en el 4.
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      await entra(conv, '1');
      whatsapp.sendFromConversation.mockClear();

      await entra(conv, 'Ana');

      expect(enviados().join(' ')).toContain('Gracias Ana');
    });

    it('los mensajes encadenados se envían seguidos, sin pedir "ok" entre medias', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      await entra(conv, '1');
      whatsapp.sendFromConversation.mockClear();

      await entra(conv, 'Ana');

      // "Gracias Ana..." y "Cuesta 100." salen en la misma interacción.
      expect(whatsapp.sendFromConversation).toHaveBeenCalledTimes(2);
    });

    it('al llegar al final la sesión queda COMPLETED', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      await entra(conv, '1');
      await entra(conv, 'Ana');

      const sesion = await prisma.chatbotSession.findFirst({
        where: { conversationId: conv },
      });
      expect(sesion?.status).toBe('COMPLETED');
      expect(sesion?.endedAt).not.toBeNull();
    });
  });

  describe('entrega a una persona', () => {
    it('pausa la conversación para que el bot no vuelva a engancharse', async () => {
      // La entrega tiene que ser definitiva: si no, el siguiente mensaje del
      // cliente reabriría el flujo por encima del asesor.
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');

      const r = await entra(conv, '2');

      expect(r.motivo).toBe('entregado-a-humano');
      const conversacion = await prisma.conversation.findUniqueOrThrow({
        where: { id: conv },
      });
      expect(conversacion.isPaused).toBe(true);
    });

    it('la sesión queda HANDED_OVER, que es terminal', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      await entra(conv, '2');

      const sesion = await prisma.chatbotSession.findFirst({
        where: { conversationId: conv },
      });
      expect(sesion?.status).toBe('HANDED_OVER');
    });

    it('asigna un asesor y le avisa', async () => {
      assignment.pickNextAgent.mockResolvedValue(asesorId);
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');

      await entra(conv, '2');

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CONVERSATION_ASSIGNED',
          recipientUserId: asesorId,
        }),
      );
    });

    it('sin asesor disponible avisa a los administradores', async () => {
      assignment.pickNextAgent.mockResolvedValue(null);
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');

      await entra(conv, '2');

      expect(assignment.warnNobodyAvailable).toHaveBeenCalledWith(empresaId);
    });

    it('tras la entrega, un mensaje nuevo ya NO lo atiende el bot', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      await entra(conv, '2');
      whatsapp.sendFromConversation.mockClear();

      const r = await entra(conv, 'sigo aquí');

      expect(r.atendido).toBe(false);
      expect(whatsapp.sendFromConversation).not.toHaveBeenCalled();
    });
  });

  describe('una sola sesión por conversación', () => {
    it('dos mensajes simultáneos NO duplican el flujo', async () => {
      // Sin el índice parcial el cliente recibiría dos saludos y dos veces la
      // misma pregunta.
      const conv = await nuevaConversacion();

      await Promise.all([entra(conv, 'hola'), entra(conv, 'hola')]);

      const sesiones = await prisma.chatbotSession.count({
        where: { conversationId: conv },
      });
      expect(sesiones).toBe(1);
    });
  });

  describe('versiones', () => {
    it('la sesión se ata a la VERSIÓN publicada, no al flujo', async () => {
      // Cambiarle el flujo bajo los pies a alguien que está respondiendo lo
      // deja en un nodo que ya no existe.
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');

      const sesion = await prisma.chatbotSession.findFirstOrThrow({
        where: { conversationId: conv },
        include: { flowVersion: { select: { version: true } } },
      });
      expect(sesion.flowVersion.version).toBeGreaterThanOrEqual(1);
    });

    it('publicar crea una versión nueva sin tocar las sesiones en curso', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');
      const antes = await prisma.chatbotSession.findFirstOrThrow({
        where: { conversationId: conv },
      });

      await flows.updateDraft(flujoId, empresaId, { draftNodes: DEFINICION });
      await flows.publish(flujoId, empresaId);

      const despues = await prisma.chatbotSession.findFirstOrThrow({
        where: { id: antes.id },
      });
      expect(despues.flowVersionId).toBe(antes.flowVersionId);
    });
  });

  describe('publicación', () => {
    it('un flujo con problemas NO se publica', async () => {
      const roto = await flows.create(empresaId, {
        name: 'Roto',
        draftNodes: {
          start: 'a',
          nodes: [{ id: 'a', type: 'message', text: 'sin salida' }],
        },
      });

      await expect(flows.publish(roto.id, empresaId)).rejects.toThrow();
    });

    it('guardar el borrador NO valida: a media edición está incompleto', async () => {
      const parcial = await flows.create(empresaId, { name: 'Parcial' });

      await expect(
        flows.updateDraft(parcial.id, empresaId, {
          draftNodes: { start: 'x', nodes: [] },
        }),
      ).resolves.toBeDefined();
    });

    it('publicar no activa por sí solo', async () => {
      // Unirlas haría que revisar un flujo lo pusiera a atender clientes.
      const nuevo = await flows.create(empresaId, {
        name: 'Nuevo',
        draftNodes: DEFINICION,
      });

      const publicado = await flows.publish(nuevo.id, empresaId);

      expect(publicado.isActive).toBe(false);
      expect(publicado.publishedVersion).toBe(1);
    });

    it('no se puede borrar un flujo con conversaciones en curso', async () => {
      const conv = await nuevaConversacion();
      await entra(conv, 'hola');

      await expect(flows.remove(flujoId, empresaId)).rejects.toThrow(
        /usando ahora mismo/i,
      );
    });
  });

  describe('aislamiento entre empresas', () => {
    it('no se puede leer el flujo de otra empresa', async () => {
      const otra = await prisma.company.create({
        data: { name: 'E2E Chatbot Otra' },
      });

      await expect(flows.findById(flujoId, otra.id)).rejects.toThrow();

      await prisma.company.delete({ where: { id: otra.id } });
    });
  });
});
