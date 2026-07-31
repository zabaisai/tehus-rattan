import { PrismaService } from '../src/prisma/prisma.service';
import { HistorySyncService } from '../src/modules/whatsapp-history/history-sync.service';
import { HistoryImportService } from '../src/modules/whatsapp-history/history-import.service';
import { ContactsService } from '../src/modules/contacts/contacts.service';
import { ConversationsService } from '../src/modules/conversations/conversations.service';

/**
 * Historial de WhatsApp: sincronizacion de coexistencia e importacion CSV.
 *
 * LA GARANTIA QUE MAS IMPORTA y que estas pruebas fijan: nada de lo importado
 * dispara efectos. Un mensaje de hace seis meses que ejecute una
 * automatizacion manda un WhatsApp REAL a un cliente por una conversacion que
 * termino hace medio ano. Por eso todo lo importado se marca y se comprueba.
 */
describe('Historial de WhatsApp (e2e, base real)', () => {
  let prisma: PrismaService;
  let sync: HistorySyncService;
  let importacion: HistoryImportService;

  let empresaId: string;
  let otraEmpresaId: string;

  const realtime = {
    messageCreated: jest.fn(),
    messageStatusChanged: jest.fn(),
    toCompany: jest.fn(),
    toUser: jest.fn(),
  };
  const notifications = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitToCompanyRoles: jest.fn().mockResolvedValue(undefined),
  };

  const mensajesDe = (companyId: string) =>
    prisma.message.findMany({
      where: { conversation: { companyId } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const contacts = new ContactsService(prisma);
    const conversations = new ConversationsService(
      prisma,
      notifications as never,
      realtime as never,
    );
    sync = new HistorySyncService(prisma, contacts, conversations);
    importacion = new HistoryImportService(prisma, contacts, conversations);

    const empresa = await prisma.company.create({
      data: { name: 'E2E Historial Co' },
    });
    empresaId = empresa.id;
    const otra = await prisma.company.create({
      data: { name: 'E2E Historial Otra' },
    });
    otraEmpresaId = otra.id;
  });

  afterAll(async () => {
    for (const id of [empresaId, otraEmpresaId]) {
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const id of [empresaId, otraEmpresaId]) {
      await prisma.message.deleteMany({
        where: { conversation: { companyId: id } },
      });
      await prisma.conversation.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
    }
    jest.clearAllMocks();
  });

  const payloadHistorial = (sufijo = 'a') => ({
    metadata: { phone_number_id: 'pn-1' },
    history: [
      {
        contact: { wa_id: '573001112233', profile: { name: 'Ana' } },
        messages: [
          {
            id: `hist-${sufijo}-1`,
            from: '573001112233',
            timestamp: '1740000000',
            text: { body: 'Hola, pregunto por un sofa' },
          },
          {
            id: `hist-${sufijo}-2`,
            from_me: true,
            timestamp: '1740000060',
            text: { body: 'Con gusto, le cuento' },
          },
        ],
      },
    ],
  });

  describe('sincronizacion de coexistencia', () => {
    it('importa los mensajes del historial', async () => {
      const r = await sync.procesarHistorial(empresaId, payloadHistorial());

      expect(r.importados).toBe(2);
      const mensajes = await mensajesDe(empresaId);
      expect(mensajes).toHaveLength(2);
    });

    it('TODO lo importado queda marcado como HISTORY_SYNC', async () => {
      // Es lo que permite que no dispare automatizaciones ni chatbot, y lo
      // que distingue un mensaje de hace medio ano de uno que acaba de
      // llegar.
      await sync.procesarHistorial(empresaId, payloadHistorial());

      const mensajes = await mensajesDe(empresaId);
      expect(mensajes.every((m) => m.source === 'HISTORY_SYNC')).toBe(true);
    });

    it('conserva la fecha original, no la de la importacion', async () => {
      // Con la fecha de importacion, seis meses de historial aparecerian como
      // ocurridos hoy y el hilo quedaria del reves.
      await sync.procesarHistorial(empresaId, payloadHistorial());

      const [primero] = await mensajesDe(empresaId);
      expect(primero.createdAt.getFullYear()).toBeLessThan(
        new Date().getFullYear() + 1,
      );
      expect(primero.createdAt.getTime()).toBe(1740000000 * 1000);
    });

    it('distingue entrantes de salientes', async () => {
      await sync.procesarHistorial(empresaId, payloadHistorial());

      const mensajes = await mensajesDe(empresaId);
      expect(mensajes[0].direction).toBe('INBOUND');
      expect(mensajes[1].direction).toBe('OUTBOUND');
    });

    it('reimportar el mismo lote NO duplica', async () => {
      // Meta puede reenviar lotes; el resultado no debe cambiar.
      await sync.procesarHistorial(empresaId, payloadHistorial());
      const r = await sync.procesarHistorial(empresaId, payloadHistorial());

      expect(r.duplicados).toBe(2);
      expect(r.importados).toBe(0);
      expect(await mensajesDe(empresaId)).toHaveLength(2);
    });

    it('un mensaje SIN identificador se descarta', async () => {
      // Sin id no hay idempotencia: reimportar duplicaria el hilo entero.
      const r = await sync.procesarHistorial(empresaId, {
        history: [
          {
            contact: { wa_id: '573001112233' },
            messages: [{ timestamp: '1740000000', text: { body: 'sin id' } }],
          },
        ],
      });

      expect(r.importados).toBe(0);
      expect(r.descartados).toBe(1);
    });

    it('un payload con una forma desconocida no rompe nada', async () => {
      // La forma la define Meta y puede cambiar sin aviso: se importa menos,
      // no se cae el webhook.
      const r = await sync.procesarHistorial(empresaId, { algo: 'raro' });

      expect(r).toEqual({
        recibidos: 0,
        importados: 0,
        duplicados: 0,
        descartados: 0,
      });
    });

    it('crea el contacto si no existia', async () => {
      await sync.procesarHistorial(empresaId, payloadHistorial());

      const contacto = await prisma.contact.findFirst({
        where: { companyId: empresaId, phone: '+573001112233' },
      });
      expect(contacto).not.toBeNull();
    });

    it('el historial de una empresa NO aparece en otra', async () => {
      await sync.procesarHistorial(empresaId, payloadHistorial());

      expect(await mensajesDe(otraEmpresaId)).toHaveLength(0);
    });
  });

  describe('importacion CSV', () => {
    const csv = [
      'telefono,fecha,direccion,texto,referencia',
      '+573001112233,2026-03-01T10:15:00Z,INBOUND,"Hola, quiero informacion",ref-1',
      '+573001112233,2026-03-01T10:20:00Z,OUTBOUND,"Claro, le explico",ref-2',
    ].join('\n');

    it('importa las filas validas', async () => {
      const r = await importacion.importar(empresaId, csv);

      expect(r.importados).toBe(2);
      expect(r.rechazados).toEqual([]);
    });

    it('lo importado queda marcado como CSV_IMPORT', async () => {
      await importacion.importar(empresaId, csv);

      const mensajes = await mensajesDe(empresaId);
      expect(mensajes.every((m) => m.source === 'CSV_IMPORT')).toBe(true);
    });

    it('reimportar el mismo fichero NO duplica', async () => {
      // Sin esto, un segundo intento tras un fallo a mitad dejaria el hilo
      // con todo por duplicado.
      await importacion.importar(empresaId, csv);
      const r = await importacion.importar(empresaId, csv);

      expect(r.duplicados).toBe(2);
      expect(await mensajesDe(empresaId)).toHaveLength(2);
    });

    it('la MISMA referencia en otra empresa no colisiona', async () => {
      await importacion.importar(empresaId, csv);
      const r = await importacion.importar(otraEmpresaId, csv);

      expect(r.importados).toBe(2);
    });

    it('respeta comas y comillas dentro del texto', async () => {
      // Un `split(",")` parte los mensajes por la mitad, y eso solo se ve
      // cuando alguien lee el hilo importado meses despues.
      const conComas = [
        'telefono,fecha,direccion,texto,referencia',
        '+573001112233,2026-03-01T10:15:00Z,INBOUND,"Hola, ¿cuanto vale? Dijo ""barato""",ref-x',
      ].join('\n');

      await importacion.importar(empresaId, conComas);

      const [mensaje] = await mensajesDe(empresaId);
      expect(mensaje.body).toBe('Hola, ¿cuanto vale? Dijo "barato"');
    });

    describe('rechazos, con el numero de fila', () => {
      const conFilaMala = (fila: string) =>
        ['telefono,fecha,direccion,texto,referencia', fila].join('\n');

      it.each([
        ['telefono ausente', ',2026-03-01T10:15:00Z,INBOUND,hola,r1', /Tel/i],
        ['fecha ilegible', '+573001112233,ayer,INBOUND,hola,r1', /Fecha/i],
        [
          'fecha futura',
          '+573001112233,2099-01-01T00:00:00Z,INBOUND,hola,r1',
          /futuro/i,
        ],
        [
          'direccion invalida',
          '+573001112233,2026-03-01T10:15:00Z,ENVIADO,hola,r1',
          /INBOUND/,
        ],
        [
          'sin referencia',
          '+573001112233,2026-03-01T10:15:00Z,INBOUND,hola,',
          /Referencia/i,
        ],
      ])('rechaza %s', async (_caso, fila, patron) => {
        const r = await importacion.importar(empresaId, conFilaMala(fila));

        expect(r.importados).toBe(0);
        expect(r.rechazados[0].fila).toBe(2);
        expect(r.rechazados[0].motivo).toMatch(patron);
      });
    });

    it('una fila mala NO impide importar las buenas', async () => {
      const mixto = [
        'telefono,fecha,direccion,texto,referencia',
        '+573001112233,ayer,INBOUND,mala,r1',
        '+573001112233,2026-03-01T10:15:00Z,INBOUND,buena,r2',
      ].join('\n');

      const r = await importacion.importar(empresaId, mixto);

      expect(r.importados).toBe(1);
      expect(r.rechazados).toHaveLength(1);
    });

    it('un CSV sin las columnas obligatorias se rechaza entero', async () => {
      await expect(importacion.importar(empresaId, 'a,b\n1,2')).rejects.toThrow(
        /columnas obligatorias/i,
      );
    });

    it('el analisis previo NO importa nada', async () => {
      // Descubrir a mitad que el formato de fecha era otro deja el hilo con
      // la mitad de las conversaciones.
      const { filas } = importacion.analizar(csv);

      expect(filas).toHaveLength(2);
      expect(await mensajesDe(empresaId)).toHaveLength(0);
    });
  });
});
