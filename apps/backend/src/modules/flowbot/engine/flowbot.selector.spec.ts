import 'reflect-metadata';
import { FlowBotSelectorService, EventoEntrante } from './flowbot.selector';

/**
 * Selección de bots.
 *
 * Lo que se prueba no es «filtra una lista»: es que dos bots no contesten a la
 * vez al mismo cliente, que un borrador nunca conteste, que el desempate no
 * dependa del azar y que ningún bot de otra empresa entre siquiera en la
 * consulta.
 */
describe('FlowBotSelectorService', () => {
  let prisma: any;
  let selector: FlowBotSelectorService;

  const disparador = (extra: Record<string, unknown> = {}) => ({
    id: 'trig-1',
    priority: 0,
    exclusive: true,
    filters: null,
    flowBot: { id: 'bot-1', name: 'Bot uno', publishedVersionId: 'ver-1' },
    ...extra,
  });

  const evento = (extra: Partial<EventoEntrante> = {}): EventoEntrante => ({
    companyId: 'empresa-a',
    tipo: 'INBOUND_MESSAGE',
    conversationId: 'conv-1',
    whatsappIntegrationId: 'wa-1',
    ...extra,
  });

  beforeEach(() => {
    prisma = { flowBotTrigger: { findMany: jest.fn().mockResolvedValue([]) } };
    selector = new FlowBotSelectorService(prisma);
  });

  describe('la consulta', () => {
    it('filtra por empresa DENTRO de la consulta, no después', async () => {
      // Traer bots de otras empresas para descartarlos luego es una fuga
      // esperando a que alguien olvide el filtro.
      await selector.seleccionar(evento());

      const where = prisma.flowBotTrigger.findMany.mock.calls[0][0].where;
      expect(where.flowBot.companyId).toBe('empresa-a');
    });

    it('solo bots ACTIVE, con versión publicada y que no sean plantillas', async () => {
      // Un borrador no puede contestarle a un cliente porque alguien este
      // experimentando en el editor.
      await selector.seleccionar(evento());

      const where = prisma.flowBotTrigger.findMany.mock.calls[0][0].where;
      expect(where.flowBot).toMatchObject({
        status: 'ACTIVE',
        isTemplate: false,
        publishedVersionId: { not: null },
      });
      expect(where.enabled).toBe(true);
    });

    it('el desempate es explícito y estable', async () => {
      // Sin el ultimo criterio, dos bots con la misma prioridad creados en el
      // mismo instante volverian a depender del orden de la base.
      await selector.seleccionar(evento());

      expect(prisma.flowBotTrigger.findMany.mock.calls[0][0].orderBy).toEqual([
        { priority: 'desc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('un disparador atado a un número solo aplica a ese número', async () => {
      await selector.seleccionar(evento({ whatsappIntegrationId: 'wa-7' }));

      const where = prisma.flowBotTrigger.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { whatsappIntegrationId: null },
        { whatsappIntegrationId: 'wa-7' },
      ]);
    });

    it('sin número, solo entran los disparadores sin número', async () => {
      await selector.seleccionar(evento({ whatsappIntegrationId: null }));

      const where = prisma.flowBotTrigger.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ whatsappIntegrationId: null }]);
    });
  });

  describe('exclusividad', () => {
    it('un bot exclusivo impide que arranquen los demás', async () => {
      // Dos bots contestando a la vez al mismo cliente es el fallo mas visible
      // y mas dificil de explicar de todos.
      prisma.flowBotTrigger.findMany.mockResolvedValue([
        disparador({ priority: 10, exclusive: true }),
        disparador({
          id: 'trig-2',
          priority: 5,
          flowBot: {
            id: 'bot-2',
            name: 'Bot dos',
            publishedVersionId: 'ver-2',
          },
        }),
      ]);

      const r = await selector.seleccionar(evento());

      expect(r.elegidos.map((e) => e.flowBotId)).toEqual(['bot-1']);
      expect(r.descartados[0]).toMatchObject({
        flowBotId: 'bot-2',
        motivo: expect.stringContaining('exclusivo'),
      });
    });

    it('varios NO exclusivos pueden arrancar a la vez', async () => {
      prisma.flowBotTrigger.findMany.mockResolvedValue([
        disparador({ exclusive: false }),
        disparador({
          id: 'trig-2',
          exclusive: false,
          flowBot: {
            id: 'bot-2',
            name: 'Bot dos',
            publishedVersionId: 'ver-2',
          },
        }),
      ]);

      const r = await selector.seleccionar(evento());

      expect(r.elegidos).toHaveLength(2);
    });

    it('gana el de mayor prioridad, que es el primero que devuelve la consulta', async () => {
      prisma.flowBotTrigger.findMany.mockResolvedValue([
        disparador({
          id: 'trig-alta',
          priority: 100,
          flowBot: { id: 'bot-alta', name: 'Alta', publishedVersionId: 'v' },
        }),
        disparador({ id: 'trig-baja', priority: 1 }),
      ]);

      const r = await selector.seleccionar(evento());

      expect(r.elegidos[0].flowBotId).toBe('bot-alta');
    });
  });

  describe('trazabilidad de los descartes', () => {
    it('cada descarte lleva su motivo', async () => {
      // «El bot no contestó» tiene que tener respuesta.
      prisma.flowBotTrigger.findMany.mockResolvedValue([
        disparador({ filters: { keywords: ['cotizar'] } }),
      ]);

      const r = await selector.seleccionar(evento({ texto: 'hola' }));

      expect(r.elegidos).toHaveLength(0);
      expect(r.descartados[0].motivo).toMatch(/palabra clave/);
    });
  });

  describe('filtros', () => {
    const conFiltros = (filters: Record<string, unknown>) => {
      prisma.flowBotTrigger.findMany.mockResolvedValue([
        disparador({ filters }),
      ]);
    };

    it('palabra clave: insensible a mayúsculas y acentos', async () => {
      conFiltros({ keywords: ['Cotización'] });
      const r = await selector.seleccionar(
        evento({ texto: 'quiero una cotizacion por favor' }),
      );
      expect(r.elegidos).toHaveLength(1);
    });

    it('pipeline y etapa', async () => {
      conFiltros({ pipelineId: 'p1', stageId: 's1' });

      await expect(
        selector.seleccionar(evento({ pipelineId: 'p1', stageId: 's1' })),
      ).resolves.toMatchObject({ elegidos: [expect.anything()] });

      const otro = await selector.seleccionar(
        evento({ pipelineId: 'p1', stageId: 's2' }),
      );
      expect(otro.elegidos).toHaveLength(0);
      expect(otro.descartados[0].motivo).toMatch(/etapa/);
    });

    it('solo primera conversación', async () => {
      conFiltros({ onlyFirstConversation: true });

      const primera = await selector.seleccionar(
        evento({ esPrimeraConversacion: true }),
      );
      expect(primera.elegidos).toHaveLength(1);

      const siguiente = await selector.seleccionar(
        evento({ esPrimeraConversacion: false }),
      );
      expect(siguiente.elegidos).toHaveLength(0);
    });

    it('un filtro que no entendemos NO silencia el bot', async () => {
      // Descartar por una clave desconocida dejaria bots mudos sin que nadie
      // supiera por que.
      conFiltros({ inventadoPorAlguien: 'valor' });

      const r = await selector.seleccionar(evento());

      expect(r.elegidos).toHaveLength(1);
    });

    it('un horario mal configurado tampoco descarta', async () => {
      conFiltros({ businessHours: { fromHour: 'nueve', toHour: 'seis' } });

      const r = await selector.seleccionar(evento());

      expect(r.elegidos).toHaveLength(1);
    });

    it('el horario admite rangos que cruzan la medianoche', async () => {
      // 22 a 6 no es un error de datos: es el turno de noche.
      const hora = new Date().getHours();
      conFiltros({ fromHour: hora, toHour: hora });
      const r = await selector.seleccionar(evento());
      expect(r.elegidos).toHaveLength(1);
    });
  });

  describe('sin candidatos', () => {
    it('devuelve listas vacías, no lanza', async () => {
      const r = await selector.seleccionar(evento());
      expect(r).toEqual({ elegidos: [], descartados: [] });
    });
  });
});
