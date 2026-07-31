import { PrismaService } from '../src/prisma/prisma.service';
import { InboxService } from '../src/modules/conversations/inbox.service';

/**
 * Bandeja omnicanal contra base REAL.
 *
 * Los no leidos se derivan de una consulta que correlaciona conversaciones,
 * mensajes y marcas de lectura por usuario. Un doble de Prisma no ejecuta esa
 * correlacion, asi que probarla con mocks solo verificaria que llamo a lo que
 * yo mismo escribi. Requiere `docker-compose up -d postgres` con migraciones.
 */
describe('Bandeja de conversaciones (e2e, base real)', () => {
  let prisma: PrismaService;
  let inbox: InboxService;

  const realtime = { toUser: jest.fn(), toCompany: jest.fn() };
  const notifications = { emit: jest.fn().mockResolvedValue(undefined) };

  let empresaId: string;
  let otraEmpresaId: string;
  let asesorA: string;
  let asesorB: string;
  let contactoId: string;

  const nuevaConversacion = async (opciones: {
    companyId?: string;
    assignedTo?: string | null;
    status?: string;
    contactId?: string;
  } = {}) => {
    const companyId = opciones.companyId ?? empresaId;
    const contactId =
      opciones.contactId ??
      (
        await prisma.contact.create({
          data: {
            companyId,
            phone: `+1888${Math.random().toString().slice(2, 9)}`,
            name: 'Contacto bandeja',
          },
        })
      ).id;

    const c = await prisma.conversation.create({
      data: {
        companyId,
        contactId,
        assignedTo: opciones.assignedTo ?? null,
        status: (opciones.status ?? 'OPEN') as never,
        lastMessageAt: new Date(),
      },
    });
    return c.id;
  };

  const entrante = async (conversationId: string, cuando = new Date()) =>
    prisma.message.create({
      data: {
        conversationId,
        body: 'hola',
        direction: 'INBOUND',
        createdAt: cuando,
      },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    inbox = new InboxService(prisma, realtime as never, notifications as never);

    const empresa = await prisma.company.create({
      data: { name: 'E2E Inbox Co' },
    });
    empresaId = empresa.id;
    const otra = await prisma.company.create({
      data: { name: 'E2E Inbox Otra Co' },
    });
    otraEmpresaId = otra.id;

    const a = await prisma.user.create({
      data: {
        companyId: empresaId,
        email: `inbox-a-${Date.now()}@example.test`,
        password: 'x',
        name: 'Asesor A',
        role: 'AGENT',
      },
    });
    asesorA = a.id;
    const b = await prisma.user.create({
      data: {
        companyId: empresaId,
        email: `inbox-b-${Date.now()}@example.test`,
        password: 'x',
        name: 'Asesor B',
        role: 'AGENT',
      },
    });
    asesorB = b.id;

    const contacto = await prisma.contact.create({
      data: { companyId: empresaId, phone: '+18880000001', name: 'Ana' },
    });
    contactoId = contacto.id;
  });

  afterAll(async () => {
    for (const id of [empresaId, otraEmpresaId]) {
      await prisma.conversationRead.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    realtime.toUser.mockClear();
    realtime.toCompany.mockClear();
    notifications.emit.mockClear();
  });

  describe('aislamiento entre empresas', () => {
    it('la bandeja no muestra conversaciones de otra empresa', async () => {
      const propia = await nuevaConversacion();
      const ajena = await nuevaConversacion({ companyId: otraEmpresaId });

      const r = await inbox.list(empresaId, asesorA, { limit: '100' });
      const ids = r.items.map((c: any) => c.id);

      expect(ids).toContain(propia);
      expect(ids).not.toContain(ajena);
    });

    it('una accion masiva con un id ajeno NO aplica NADA', async () => {
      // A medias seria peor que nada: el usuario no sabria cual se aplico.
      const propia = await nuevaConversacion();
      const ajena = await nuevaConversacion({ companyId: otraEmpresaId });

      await expect(
        inbox.bulk(empresaId, asesorA, [propia, ajena], {
          type: 'status',
          status: 'CLOSED',
        }),
      ).rejects.toThrow();

      const sinTocar = await prisma.conversation.findUniqueOrThrow({
        where: { id: propia },
      });
      expect(sinTocar.status).toBe('OPEN');
    });

    it('no se puede asignar a un asesor de otra empresa', async () => {
      const ajeno = await prisma.user.create({
        data: {
          companyId: otraEmpresaId,
          email: `intruso-${Date.now()}@example.test`,
          password: 'x',
          name: 'Intruso',
          role: 'AGENT',
        },
      });
      const conv = await nuevaConversacion();

      await expect(
        inbox.bulk(empresaId, asesorA, [conv], {
          type: 'assign',
          assignedTo: ajeno.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe('no leidos', () => {
    it('una conversacion nunca abierta con mensaje entrante sale sin leer', async () => {
      const conv = await nuevaConversacion();
      await entrante(conv);

      const r = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });

      expect(r.items.map((c: any) => c.id)).toContain(conv);
    });

    it('tras marcarla leida deja de estar sin leer', async () => {
      const conv = await nuevaConversacion();
      await entrante(conv);

      await inbox.markRead(conv, empresaId, asesorA);
      const r = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });

      expect(r.items.map((c: any) => c.id)).not.toContain(conv);
    });

    it('un mensaje NUEVO tras leerla vuelve a dejarla sin leer', async () => {
      const conv = await nuevaConversacion();
      await entrante(conv, new Date(Date.now() - 60_000));
      await inbox.markRead(conv, empresaId, asesorA);

      await entrante(conv, new Date());
      const r = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });

      expect(r.items.map((c: any) => c.id)).toContain(conv);
    });

    it('los no leidos son POR USUARIO: leerla uno no la marca para el otro', async () => {
      // La bandeja es compartida. Que un supervisor abra un hilo no significa
      // que el asesor asignado ya lo haya visto.
      const conv = await nuevaConversacion();
      await entrante(conv);
      await inbox.markRead(conv, empresaId, asesorA);

      const deA = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });
      const deB = await inbox.list(empresaId, asesorB, {
        unread: true,
        limit: '100',
      });

      expect(deA.items.map((c: any) => c.id)).not.toContain(conv);
      expect(deB.items.map((c: any) => c.id)).toContain(conv);
    });

    it('los mensajes SALIENTES no cuentan como sin leer', async () => {
      const conv = await nuevaConversacion();
      await prisma.message.create({
        data: { conversationId: conv, body: 'respuesta', direction: 'OUTBOUND' },
      });

      const r = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });

      expect(r.items.map((c: any) => c.id)).not.toContain(conv);
    });

    it('la lista trae el contador de no leidos', async () => {
      const conv = await nuevaConversacion();
      await entrante(conv);
      await entrante(conv);

      const r = await inbox.list(empresaId, asesorB, { limit: '100' });
      const fila: any = r.items.find((c: any) => c.id === conv);

      expect(fila.unreadCount).toBe(2);
    });

    it('marcar como no leida solo retrocede hasta el ultimo entrante', async () => {
      // Borrar la marca dejaria sin leer meses de historial ya visto y el
      // contador saltaria a decenas sin motivo.
      const conv = await nuevaConversacion();
      await entrante(conv, new Date(Date.now() - 120_000));
      await entrante(conv, new Date(Date.now() - 60_000));
      await inbox.markRead(conv, empresaId, asesorA);

      await inbox.markUnread(conv, empresaId, asesorA);
      const r = await inbox.list(empresaId, asesorA, { limit: '100' });
      const fila: any = r.items.find((c: any) => c.id === conv);

      expect(fila.unreadCount).toBe(1);
    });

    it('marcar leida es idempotente', async () => {
      const conv = await nuevaConversacion();
      await entrante(conv);

      await inbox.markRead(conv, empresaId, asesorA);
      await inbox.markRead(conv, empresaId, asesorA);

      const filas = await prisma.conversationRead.count({
        where: { conversationId: conv, userId: asesorA },
      });
      expect(filas).toBe(1);
    });
  });

  describe('filtros', () => {
    it('filtra por asignado a mi', async () => {
      const mia = await nuevaConversacion({ assignedTo: asesorA });
      const suya = await nuevaConversacion({ assignedTo: asesorB });

      const r = await inbox.list(empresaId, asesorA, {
        assigned: 'me',
        limit: '100',
      });
      const ids = r.items.map((c: any) => c.id);

      expect(ids).toContain(mia);
      expect(ids).not.toContain(suya);
    });

    it('filtra por sin asignar', async () => {
      const libre = await nuevaConversacion({ assignedTo: null });
      const tomada = await nuevaConversacion({ assignedTo: asesorA });

      const r = await inbox.list(empresaId, asesorA, {
        assigned: 'unassigned',
        limit: '100',
      });
      const ids = r.items.map((c: any) => c.id);

      expect(ids).toContain(libre);
      expect(ids).not.toContain(tomada);
    });

    it('filtra por estado', async () => {
      const cerrada = await nuevaConversacion({ status: 'CLOSED' });

      const r = await inbox.list(empresaId, asesorA, {
        status: 'CLOSED',
        limit: '100',
      });

      expect(r.items.every((c: any) => c.status === 'CLOSED')).toBe(true);
      expect(r.items.map((c: any) => c.id)).toContain(cerrada);
    });

    it('un estado inventado se ignora en vez de romper', async () => {
      const r = await inbox.list(empresaId, asesorA, {
        status: 'INVENTADO',
        limit: '100',
      });

      expect(Array.isArray(r.items)).toBe(true);
    });

    it('busca por nombre y por telefono del contacto', async () => {
      const conv = await nuevaConversacion({ contactId: contactoId });

      const porNombre = await inbox.list(empresaId, asesorA, {
        search: 'Ana',
        limit: '100',
      });
      const porTelefono = await inbox.list(empresaId, asesorA, {
        search: '8880000001',
        limit: '100',
      });

      expect(porNombre.items.map((c: any) => c.id)).toContain(conv);
      expect(porTelefono.items.map((c: any) => c.id)).toContain(conv);
    });

    it('lo mas reciente primero, por ultimo mensaje', async () => {
      // Por `lastMessageAt` y no por `updatedAt`: reasignar o cambiar de
      // estado no debe reordenar la bandeja sin que haya pasado nada nuevo.
      const vieja = await nuevaConversacion();
      await prisma.conversation.update({
        where: { id: vieja },
        data: { lastMessageAt: new Date(Date.now() - 86_400_000) },
      });
      const nueva = await nuevaConversacion();

      const r = await inbox.list(empresaId, asesorA, { limit: '100' });
      const ids = r.items.map((c: any) => c.id);

      expect(ids.indexOf(nueva)).toBeLessThan(ids.indexOf(vieja));
    });
  });

  describe('paginacion', () => {
    it('avisa de que hay mas paginas', async () => {
      await nuevaConversacion();
      await nuevaConversacion();

      const r = await inbox.list(empresaId, asesorA, { limit: '1' });

      expect(r.items).toHaveLength(1);
      expect(r.hasMore).toBe(true);
    });

    it('el limite tiene tope: una bandeja se filtra, no se navega de mil en mil', async () => {
      const r = await inbox.list(empresaId, asesorA, { limit: '99999' });

      expect(r.items.length).toBeLessThanOrEqual(100);
    });
  });

  describe('acciones masivas', () => {
    it('asigna varias a la vez y avisa UNA sola vez', async () => {
      // Veinte notificaciones seguidas no informan, sepultan.
      const a = await nuevaConversacion();
      const b = await nuevaConversacion();

      const r = await inbox.bulk(empresaId, asesorA, [a, b], {
        type: 'assign',
        assignedTo: asesorB,
      });

      expect(r).toEqual({ updated: 2 });
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      const asignadas = await prisma.conversation.findMany({
        where: { id: { in: [a, b] } },
        select: { assignedTo: true },
      });
      expect(asignadas.every((c) => c.assignedTo === asesorB)).toBe(true);
    });

    it('cambia el estado de varias', async () => {
      const a = await nuevaConversacion();
      const b = await nuevaConversacion();

      await inbox.bulk(empresaId, asesorA, [a, b], {
        type: 'status',
        status: 'RESOLVED',
      });

      const filas = await prisma.conversation.findMany({
        where: { id: { in: [a, b] } },
        select: { status: true },
      });
      expect(filas.every((c) => c.status === 'RESOLVED')).toBe(true);
    });

    it('quita la asignacion de varias', async () => {
      const a = await nuevaConversacion({ assignedTo: asesorA });

      await inbox.bulk(empresaId, asesorA, [a], { type: 'unassign' });

      const fila = await prisma.conversation.findUniqueOrThrow({
        where: { id: a },
      });
      expect(fila.assignedTo).toBeNull();
    });

    it('marca varias como leidas', async () => {
      const a = await nuevaConversacion();
      const b = await nuevaConversacion();
      await entrante(a);
      await entrante(b);

      await inbox.bulk(empresaId, asesorA, [a, b], { type: 'read' });

      const r = await inbox.list(empresaId, asesorA, {
        unread: true,
        limit: '100',
      });
      const ids = r.items.map((c: any) => c.id);
      expect(ids).not.toContain(a);
      expect(ids).not.toContain(b);
    });

    it('los ids repetidos se cuentan una vez', async () => {
      const a = await nuevaConversacion();

      const r = await inbox.bulk(empresaId, asesorA, [a, a, a], {
        type: 'status',
        status: 'PENDING',
      });

      expect(r).toEqual({ updated: 1 });
    });

    it('una lista vacia se rechaza', async () => {
      await expect(
        inbox.bulk(empresaId, asesorA, [], { type: 'unassign' }),
      ).rejects.toThrow();
    });

    it('mas del tope se rechaza: eso es una migracion, no una accion', async () => {
      const muchos = Array.from({ length: 101 }, (_, i) => `id-${i}`);

      await expect(
        inbox.bulk(empresaId, asesorA, muchos, { type: 'unassign' }),
      ).rejects.toThrow();
    });

    it('un estado invalido se rechaza', async () => {
      const a = await nuevaConversacion();

      await expect(
        inbox.bulk(empresaId, asesorA, [a], {
          type: 'status',
          status: 'INVENTADO',
        }),
      ).rejects.toThrow();
    });
  });

  describe('contadores', () => {
    it('cuenta total, mias, sin asignar y sin leer', async () => {
      const c = await inbox.counters(empresaId, asesorA);

      expect(typeof c.total).toBe('number');
      expect(typeof c.mine).toBe('number');
      expect(typeof c.unassigned).toBe('number');
      expect(typeof c.unread).toBe('number');
    });

    it('las cerradas y archivadas no cuentan como carga pendiente', async () => {
      const antes = await inbox.counters(empresaId, asesorA);
      const conv = await nuevaConversacion();
      await inbox.bulk(empresaId, asesorA, [conv], {
        type: 'status',
        status: 'ARCHIVED',
      });

      const despues = await inbox.counters(empresaId, asesorA);

      expect(despues.total).toBe(antes.total);
    });
  });
});
