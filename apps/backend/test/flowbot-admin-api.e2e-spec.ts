import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { HandoffService } from '../src/modules/conversations/handoff.service';
import { FlowBotQueueService } from '../src/modules/flowbot/engine/flowbot.queue';
import { FlowBotReferenciasService } from '../src/modules/flowbot/graph/flowbot.referencias.service';
import { FlowBotAdminService } from '../src/modules/flowbot/api/flowbot.admin.service';
import { FlowBotTriggersService } from '../src/modules/flowbot/api/flowbot.triggers.service';
import { FlowBotExecutionsService } from '../src/modules/flowbot/api/flowbot.executions.service';
import { FlowBotMetricsService } from '../src/modules/flowbot/api/flowbot.metrics.service';
import { FlowBotSimulatorService } from '../src/modules/flowbot/api/flowbot.simulator.service';
import { redactarVariables } from '../src/modules/flowbot/api/flowbot.executions.service';
import { PLANTILLAS } from '../src/modules/flowbot/api/flowbot.templates';
import { GrafoFlow } from '../src/modules/flowbot/graph/flowbot.graph';

/**
 * API ADMINISTRATIVA — contra la base REAL.
 *
 * Lo que se comprueba aquí no se puede comprobar con mocks: la concurrencia
 * optimista depende de que el `updateMany` sea atómico de verdad, la
 * inmutabilidad de que la versión sea una fila aparte, y el aislamiento de que
 * el `where` filtre en la consulta y no después.
 *
 * Datos con prefijo E2E-API, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-API';

/** Un flujo mínimo que valida y compila sin referencias de empresa. */
const FLUJO: GrafoFlow = {
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes: [
    {
      id: 'inicio',
      type: 'trigger.inbound_message',
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: 'saluda',
      type: 'send.text',
      position: { x: 260, y: 0 },
      config: { text: 'Hola' },
    },
    {
      id: 'fin',
      type: 'control.end',
      position: { x: 520, y: 0 },
      config: {},
    },
  ],
  edges: [
    { id: 'e1', from: 'inicio', fromPort: 'next', to: 'saluda' },
    { id: 'e2', from: 'saluda', fromPort: 'next', to: 'fin' },
  ],
};

describe('API administrativa de FlowBot (e2e, base real)', () => {
  const servicioPrisma = prisma as unknown as PrismaService;

  let admin: FlowBotAdminService;
  let triggers: FlowBotTriggersService;
  let ejecuciones: FlowBotExecutionsService;
  let metricas: FlowBotMetricsService;
  let simulador: FlowBotSimulatorService;

  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let usuarioB: string;
  let numeroA: string;
  let pipelineA: string;
  let etapaA: string;
  let n = 0;

  beforeAll(async () => {
    process.env.QUEUE_ENABLED = 'false';

    const referencias = new FlowBotReferenciasService(servicioPrisma);
    admin = new FlowBotAdminService(servicioPrisma, referencias);
    triggers = new FlowBotTriggersService(servicioPrisma);
    simulador = new FlowBotSimulatorService(servicioPrisma, referencias);
    metricas = new FlowBotMetricsService(servicioPrisma);
    ejecuciones = new FlowBotExecutionsService(
      servicioPrisma,
      new OutboxService(servicioPrisma),
      new FlowBotQueueService(),
      new HandoffService(servicioPrisma, {
        emit: async () => undefined,
      } as never),
    );

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const ua = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `${PREFIJO.toLowerCase()}-a@ejemplo.test`,
        password: 'x',
        name: 'Admin A',
        role: 'ADMIN',
      },
    });
    const ub = await prisma.user.create({
      data: {
        companyId: empresaB,
        email: `${PREFIJO.toLowerCase()}-b@ejemplo.test`,
        password: 'x',
        name: 'Admin B',
        role: 'ADMIN',
      },
    });
    usuarioA = ua.id;
    usuarioB = ub.id;

    const numero = await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: `${PREFIJO}-phone`,
        status: 'CONNECTED',
        accessTokenEncrypted: 'cifrado',
      },
    });
    numeroA = numero.id;

    const pipe = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO}-pipe`, order: 0 },
    });
    pipelineA = pipe.id;
    const etapa = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipelineA,
        name: 'Entrada',
        order: 0,
        isInitial: true,
      },
    });
    etapaA = etapa.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.conversationHandoff.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotWait.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotExecutionStep.deleteMany({
      where: { execution: { companyId: { in: empresas } } },
    });
    await prisma.flowBotExecution.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotTrigger.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.updateMany({
      where: { companyId: { in: empresas } },
      data: { publishedVersionId: null },
    });
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.outboxEvent.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.whatsAppIntegration.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  /** Crea un bot con el flujo mínimo y devuelve su id. */
  const nuevoBot = async (companyId = empresaA, userId = usuarioA) => {
    n += 1;
    const bot = await admin.crear(companyId, userId, {
      nombre: `${PREFIJO}-bot-${n}`,
      graph: FLUJO,
    });
    return bot.id;
  };

  // ═══ CRUD ════════════════════════════════════════════════════

  describe('CRUD', () => {
    it('1. crea un bot en DRAFT y sin versión publicada', async () => {
      const id = await nuevoBot();
      const d = await admin.detalle(empresaA, id);

      // Un bot que naciera activo empezaría a contestar antes de que nadie lo
      // hubiera mirado.
      expect(d.estado).toBe('DRAFT');
      expect(d.versionPublicada).toBeNull();
      expect(d.draftRevision).toBe(0);
    });

    it('2. duplica el BORRADOR y sin disparadores', async () => {
      const id = await nuevoBot();
      await triggers.crear(empresaA, id, { tipo: 'INBOUND_MESSAGE' });

      const copia = await admin.duplicar(empresaA, usuarioA, id);
      const d = await admin.detalle(empresaA, copia.id);

      // Copiar los disparadores haría que dos bots respondieran al mismo
      // mensaje en cuanto se activara el nuevo.
      expect(d.disparadores).toHaveLength(0);
      expect(d.estado).toBe('DRAFT');
      expect(copia.name).toContain('(copia)');
    });

    it('3. renombrar no toca el grafo', async () => {
      const id = await nuevoBot();
      await admin.renombrar(empresaA, usuarioA, id, 'Nombre nuevo');
      const d = await admin.detalle(empresaA, id);

      expect(d.nombre).toBe('Nombre nuevo');
      expect((d.draftGraph as GrafoFlow).nodes).toHaveLength(3);
    });

    it('4. NO se puede activar sin versión publicada', async () => {
      const id = await nuevoBot();

      // Un bot activo sin versión no puede arrancar nada: el selector solo
      // mira los que la tienen, así que activarlo sería mentir.
      await expect(
        admin.cambiarEstado(empresaA, usuarioA, id, 'ACTIVE'),
      ).rejects.toThrow();
    });

    it('5. borrar exige que nunca se haya publicado', async () => {
      const id = await nuevoBot();
      await admin.publicar(empresaA, usuarioA, id);

      await expect(admin.eliminar(empresaA, id)).rejects.toThrow();
      // Con versiones, borrar destruiría el historial: para eso está archivar.
      const d = await admin.detalle(empresaA, id);
      expect(d.versiones.length).toBeGreaterThan(0);
    });

    it('6. un borrador virgen SÍ se puede borrar', async () => {
      const id = await nuevoBot();
      await expect(admin.eliminar(empresaA, id)).resolves.toEqual({
        eliminado: true,
      });
    });
  });

  // ═══ AISLAMIENTO ═════════════════════════════════════════════

  describe('aislamiento entre empresas', () => {
    it('7. un bot de A no existe para B', async () => {
      const id = await nuevoBot(empresaA, usuarioA);

      await expect(admin.detalle(empresaB, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('8. B no puede renombrar un bot de A', async () => {
      const id = await nuevoBot();

      await expect(
        admin.renombrar(empresaB, usuarioB, id, 'secuestrado'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const d = await admin.detalle(empresaA, id);
      expect(d.nombre).not.toBe('secuestrado');
    });

    it('9. B no puede guardar el borrador de A', async () => {
      const id = await nuevoBot();

      await expect(
        admin.guardarBorrador(empresaB, usuarioB, id, FLUJO, 0),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('10. el listado de B no incluye bots de A', async () => {
      await nuevoBot(empresaA, usuarioA);
      const deB = await admin.listar(empresaB);
      expect(deB.every((b) => !b.nombre.startsWith(PREFIJO))).toBe(true);
    });

    it('11. un disparador con un número de OTRA empresa se rechaza', async () => {
      const idB = await nuevoBot(empresaB, usuarioB);

      // El número es de A. La clave ajena apunta a la tabla, no a la empresa,
      // así que la base no lo impediría sola.
      await expect(
        triggers.crear(empresaB, idB, {
          tipo: 'INBOUND_MESSAGE',
          whatsappIntegrationId: numeroA,
        }),
      ).rejects.toThrow();
    });

    it('12. un filtro con una etapa de OTRA empresa se rechaza', async () => {
      const idB = await nuevoBot(empresaB, usuarioB);

      await expect(
        triggers.crear(empresaB, idB, {
          tipo: 'INBOUND_MESSAGE',
          filtros: { stageId: etapaA },
        }),
      ).rejects.toThrow();
    });
  });

  // ═══ BORRADORES Y CONCURRENCIA ═══════════════════════════════

  describe('concurrencia optimista', () => {
    it('13. guardar sube la revisión', async () => {
      const id = await nuevoBot();
      const r = await admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, 0);
      expect(r.revision).toBe(1);
    });

    it('14. DOS ADMINISTRADORES a la vez: uno gana, el otro recibe 409', async () => {
      const id = await nuevoBot();
      const borrador = await admin.obtenerBorrador(empresaA, id);

      // Los dos leyeron la MISMA revisión y guardan a la vez. Es exactamente
      // la carrera que el control optimista existe para cerrar.
      const resultados = await Promise.allSettled([
        admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, borrador.revision),
        admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, borrador.revision),
      ]);

      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const conflictos = resultados.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(conflictos).toHaveLength(1);
      expect(conflictos[0].reason).toBeInstanceOf(ConflictException);
    });

    it('15. el 409 devuelve el grafo ACTUAL para poder comparar', async () => {
      const id = await nuevoBot();
      await admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, 0);

      try {
        // Revisión vieja: alguien guardó en medio.
        await admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, 0);
        throw new Error('debería haber lanzado');
      } catch (e) {
        const cuerpo = (e as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
        // Sin el grafo actual, la interfaz solo puede decir «alguien te pisó»
        // y obligar a recargar perdiendo el trabajo.
        expect(cuerpo.codigo).toBe('borrador.conflicto');
        expect(cuerpo.revisionActual).toBe(1);
        expect(cuerpo.revisionEnviada).toBe(0);
        expect(cuerpo.graphActual).toBeDefined();
      }
    });

    it('16. tras el conflicto, guardar con la revisión buena funciona', async () => {
      const id = await nuevoBot();
      await admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, 0);

      const actual = await admin.obtenerBorrador(empresaA, id);
      const r = await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        FLUJO,
        actual.revision,
      );
      expect(r.revision).toBe(2);
    });
  });

  // ═══ VALIDACIÓN Y PUBLICACIÓN ════════════════════════════════

  describe('validación y publicación', () => {
    it('17. un grafo válido se puede publicar', async () => {
      const r = await admin.validar(empresaA, FLUJO);
      expect(r.sePuedePublicar).toBe(true);
      expect(r.compiledHash).toBeTruthy();
    });

    it('18. los problemas llevan código estable y nodeId', async () => {
      const roto: GrafoFlow = {
        ...FLUJO,
        edges: [{ id: 'x', from: 'inicio', fromPort: 'next', to: 'fantasma' }],
      };
      const r = await admin.validar(empresaA, roto);

      // El frontend NUNCA lee el mensaje para decidir: el código es estable.
      expect(r.sePuedePublicar).toBe(false);
      expect(r.problemas.every((p) => p.codigo.length > 0)).toBe(true);
      expect(r.problemas.some((p) => p.solucion)).toBe(true);
    });

    it('19. publicar crea una versión y NO activa el bot', async () => {
      const id = await nuevoBot();
      const r = await admin.publicar(empresaA, usuarioA, id, 'primera');

      const d = await admin.detalle(empresaA, id);
      expect(r.version).toBe(1);
      // Publicar y activar son decisiones distintas: se puede tener la versión
      // lista y encenderla el lunes.
      expect(d.estado).toBe('DRAFT');
      expect(d.versionPublicada).toBe(1);
    });

    it('20. NO se publica un grafo inválido', async () => {
      const id = await nuevoBot();
      await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        { ...FLUJO, edges: [] },
        0,
      );

      await expect(admin.publicar(empresaA, usuarioA, id)).rejects.toThrow();
    });

    it('21. LA VERSIÓN PUBLICADA ES INMUTABLE', async () => {
      const id = await nuevoBot();
      const publicada = await admin.publicar(empresaA, usuarioA, id);
      const antes = await admin.obtenerVersion(
        empresaA,
        id,
        publicada.versionId,
      );

      // Se edita el borrador con algo distinto.
      const b = await admin.obtenerBorrador(empresaA, id);
      await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        {
          ...FLUJO,
          nodes: FLUJO.nodes.map((x) =>
            x.id === 'saluda' ? { ...x, config: { text: 'CAMBIADO' } } : x,
          ),
        },
        b.revision,
      );

      const despues = await admin.obtenerVersion(
        empresaA,
        id,
        publicada.versionId,
      );
      // El grafo congelado NO cambia. Guardar una referencia al borrador haría
      // que editarlo cambiara la versión que está corriendo.
      expect(JSON.stringify(despues.graph)).toBe(JSON.stringify(antes.graph));
      expect(JSON.stringify(despues.graph)).not.toContain('CAMBIADO');
    });

    it('22. publicar dos veces crea DOS versiones', async () => {
      const id = await nuevoBot();
      await admin.publicar(empresaA, usuarioA, id);
      const b = await admin.obtenerBorrador(empresaA, id);
      await admin.guardarBorrador(empresaA, usuarioA, id, FLUJO, b.revision);
      const segunda = await admin.publicar(empresaA, usuarioA, id);

      const versiones = await admin.listarVersiones(empresaA, id);
      expect(segunda.version).toBe(2);
      expect(versiones).toHaveLength(2);
      expect(versiones.filter((v) => v.esActual)).toHaveLength(1);
    });

    it('23. comparar versiones señala el nodo que cambió', async () => {
      const id = await nuevoBot();
      const v1 = await admin.publicar(empresaA, usuarioA, id);

      const b = await admin.obtenerBorrador(empresaA, id);
      await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        {
          ...FLUJO,
          nodes: FLUJO.nodes.map((x) =>
            x.id === 'saluda' ? { ...x, config: { text: 'otro' } } : x,
          ),
        },
        b.revision,
      );
      const v2 = await admin.publicar(empresaA, usuarioA, id);

      const diff = await admin.compararVersiones(
        empresaA,
        id,
        v1.versionId,
        v2.versionId,
      );
      expect(diff.identicos).toBe(false);
      expect(diff.nodos.modificados).toEqual([
        { id: 'saluda', campos: ['config'] },
      ]);
    });

    it('24. mover un nodo NO cuenta como cambio', async () => {
      const id = await nuevoBot();
      const v1 = await admin.publicar(empresaA, usuarioA, id);

      const b = await admin.obtenerBorrador(empresaA, id);
      await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        {
          ...FLUJO,
          nodes: FLUJO.nodes.map((x) => ({
            ...x,
            position: { x: x.position.x + 999, y: 42 },
          })),
        },
        b.revision,
      );
      const v2 = await admin.publicar(empresaA, usuarioA, id);

      // Marcarlo llenaría el diff de ruido que esconde lo que sí cambió.
      const diff = await admin.compararVersiones(
        empresaA,
        id,
        v1.versionId,
        v2.versionId,
      );
      expect(diff.identicos).toBe(true);
    });

    it('25. restaurar crea un BORRADOR, no toca la versión', async () => {
      const id = await nuevoBot();
      const v1 = await admin.publicar(empresaA, usuarioA, id);

      const b = await admin.obtenerBorrador(empresaA, id);
      await admin.guardarBorrador(
        empresaA,
        usuarioA,
        id,
        { ...FLUJO, nodes: [...FLUJO.nodes] },
        b.revision,
      );

      const r = await admin.restaurarVersion(
        empresaA,
        usuarioA,
        id,
        v1.versionId,
      );
      const d = await admin.detalle(empresaA, id);

      expect(r.restaurada).toBe(1);
      // La versión publicada SIGUE siendo la 1: restaurar no republica.
      expect(d.versionPublicada).toBe(1);
      expect(d.versiones).toHaveLength(1);
    });
  });

  // ═══ DISPARADORES ════════════════════════════════════════════

  describe('disparadores', () => {
    it('26. se crean, listan y ordenan por prioridad', async () => {
      const id = await nuevoBot();
      const t1 = await triggers.crear(empresaA, id, {
        tipo: 'INBOUND_MESSAGE',
        prioridad: 10,
      });
      const t2 = await triggers.crear(empresaA, id, {
        tipo: 'KEYWORD',
        prioridad: 50,
      });

      const lista = await triggers.listar(empresaA, id);
      // El mismo orden que usa el selector: ver la lista en otro orden que el
      // que decide quién responde confundiría a quien la configura.
      expect(lista[0].id).toBe(t2.id);
      expect(lista[1].id).toBe(t1.id);
    });

    it('27. reordenar aplica todas las prioridades', async () => {
      const id = await nuevoBot();
      const t1 = await triggers.crear(empresaA, id, {
        tipo: 'INBOUND_MESSAGE',
        prioridad: 1,
      });
      const t2 = await triggers.crear(empresaA, id, {
        tipo: 'KEYWORD',
        prioridad: 2,
      });

      const lista = await triggers.ordenar(empresaA, id, [
        { triggerId: t1.id, prioridad: 100 },
        { triggerId: t2.id, prioridad: 5 },
      ]);
      expect(lista[0].id).toBe(t1.id);
    });

    it('28. la exclusividad se puede cambiar', async () => {
      const id = await nuevoBot();
      const t = await triggers.crear(empresaA, id, {
        tipo: 'INBOUND_MESSAGE',
      });
      expect(t.exclusivo).toBe(true);

      const cambiado = await triggers.actualizar(empresaA, id, t.id, {
        exclusivo: false,
      });
      expect(cambiado.exclusivo).toBe(false);
    });

    it('29. un horario imposible se rechaza AL GUARDAR', async () => {
      const id = await nuevoBot();

      // Guardado en silencio, dejaría el bot mudo y nadie sabría por qué.
      await expect(
        triggers.crear(empresaA, id, {
          tipo: 'INBOUND_MESSAGE',
          filtros: { businessHours: { fromHour: 99, toHour: 3 } },
        }),
      ).rejects.toThrow();
    });

    it('30. un número de la propia empresa SÍ se acepta', async () => {
      const id = await nuevoBot();
      const t = await triggers.crear(empresaA, id, {
        tipo: 'INBOUND_MESSAGE',
        whatsappIntegrationId: numeroA,
      });
      expect(t.whatsappIntegrationId).toBe(numeroA);
    });
  });

  // ═══ SIMULADOR ═══════════════════════════════════════════════

  describe('simulador', () => {
    it('31. recorre el flujo y devuelve la ruta', async () => {
      const r = await simulador.simular(empresaA, {
        graph: FLUJO,
        mensajeInicial: 'hola',
      });

      expect(r.ok).toBe(true);
      expect(r.ruta).toEqual(['inicio', 'saluda', 'fin']);
      expect(r.estadoFinal).toBe('COMPLETED');
    });

    it('32. NO escribe NADA en las tablas operativas', async () => {
      const antes = await Promise.all([
        prisma.flowBotExecution.count({ where: { companyId: empresaA } }),
        prisma.contact.count({ where: { companyId: empresaA } }),
        prisma.lead.count({ where: { companyId: empresaA } }),
        prisma.task.count({ where: { companyId: empresaA } }),
        prisma.message.count({
          where: { conversation: { companyId: empresaA } },
        }),
        prisma.conversationHandoff.count({ where: { companyId: empresaA } }),
      ]);

      await simulador.simular(empresaA, {
        graph: FLUJO,
        mensajeInicial: 'hola',
      });

      const despues = await Promise.all([
        prisma.flowBotExecution.count({ where: { companyId: empresaA } }),
        prisma.contact.count({ where: { companyId: empresaA } }),
        prisma.lead.count({ where: { companyId: empresaA } }),
        prisma.task.count({ where: { companyId: empresaA } }),
        prisma.message.count({
          where: { conversation: { companyId: empresaA } },
        }),
        prisma.conversationHandoff.count({ where: { companyId: empresaA } }),
      ]);

      // Ni una fila. El intérprete solo conoce los puertos y aquí recibe
      // falsos: no existe ruta de código por la que pueda escribir.
      expect(despues).toEqual(antes);
    });

    it('33. los efectos se REGISTRAN pero no ocurren', async () => {
      const r = await simulador.simular(empresaA, {
        graph: FLUJO,
        mensajeInicial: 'hola',
      });

      // Dice lo que HABRÍA hecho, que es el valor entero de simular.
      expect(r.mensajes).toEqual([{ tipo: 'enviarTexto', texto: 'Hola' }]);
      expect(r.efectos.length).toBeGreaterThan(0);
    });

    it('34. explica cada decisión', async () => {
      const r = await simulador.simular(empresaA, {
        graph: FLUJO,
        mensajeInicial: 'hola',
      });
      expect(r.decisiones.every((d) => d.explicacion.length > 0)).toBe(true);
    });

    it('35. responde a una espera y sigue', async () => {
      const conPregunta: GrafoFlow = {
        schemaVersion: 1,
        startNodeId: 'inicio',
        nodes: [
          ...FLUJO.nodes.filter((x) => x.id !== 'saluda'),
          {
            id: 'pide',
            type: 'ask.question',
            position: { x: 260, y: 0 },
            config: { text: '¿Nombre?', saveAs: 'nombre', timeoutSeconds: 60 },
          },
        ],
        edges: [
          { id: 'a', from: 'inicio', fromPort: 'next', to: 'pide' },
          { id: 'b', from: 'pide', fromPort: 'next', to: 'fin' },
        ],
      };

      const r = await simulador.simular(empresaA, {
        graph: conPregunta,
        mensajeInicial: 'hola',
        respuestas: ['Ana'],
      });

      expect(r.estadoFinal).toBe('COMPLETED');
      expect((r.variablesDespues.flow as Record<string, unknown>)?.nombre).toBe(
        'Ana',
      );
      expect(r.turnos).toBeGreaterThan(0);
    });

    it('36. un fallo de WhatsApp saca por la rama de error', async () => {
      const conError: GrafoFlow = {
        ...FLUJO,
        edges: [
          ...FLUJO.edges,
          { id: 'e3', from: 'saluda', fromPort: 'error', to: 'fin' },
        ],
      };
      const r = await simulador.simular(empresaA, {
        graph: conError,
        mensajeInicial: 'hola',
        fallos: { whatsapp: true },
      });

      expect(r.mensajes).toHaveLength(0);
      expect(r.ruta).toContain('saluda');
    });

    it('37. un grafo que no compila devuelve los errores, no revienta', async () => {
      const r = await simulador.simular(empresaA, {
        graph: { ...FLUJO, edges: [] },
      });
      expect(r.ok).toBe(false);
      expect(r.errores.length).toBeGreaterThan(0);
    });
  });

  // ═══ EJECUCIONES ═════════════════════════════════════════════

  describe('ejecuciones', () => {
    /** Crea una ejecución real para poder consultarla y operarla. */
    const nuevaEjecucion = async (estado: 'RUNNING' | 'FAILED' = 'RUNNING') => {
      const botId = await nuevoBot();
      const v = await admin.publicar(empresaA, usuarioA, botId);
      n += 1;

      const contacto = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: `+5730011122${String(n).padStart(2, '0')}`,
          name: 'Cliente',
        },
      });
      const conv = await prisma.conversation.create({
        data: { companyId: empresaA, contactId: contacto.id },
      });

      const e = await prisma.flowBotExecution.create({
        data: {
          companyId: empresaA,
          flowBotId: botId,
          versionId: v.versionId,
          conversationId: conv.id,
          contactId: contacto.id,
          idempotencyKey: `${PREFIJO}-exec-${n}-${Date.now()}`,
          correlationId: `corr-${n}`,
          status: estado,
          steps: 2,
        },
      });
      return { executionId: e.id, botId, conversationId: conv.id };
    };

    it('38. el listado pagina por CURSOR', async () => {
      for (let i = 0; i < 3; i += 1) await nuevaEjecucion();

      const p1 = await ejecuciones.listar(empresaA, {}, { limite: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p1.siguienteCursor).toBeTruthy();

      const p2 = await ejecuciones.listar(
        empresaA,
        {},
        { limite: 2, cursor: p1.siguienteCursor! },
      );
      // Ninguna se repite entre páginas: es lo que `skip` no garantiza cuando
      // entran filas nuevas mientras alguien pagina.
      const ids1 = p1.items.map((x) => x.id);
      expect(p2.items.every((x) => !ids1.includes(x.id))).toBe(true);
    });

    it('39. un cursor corrupto devuelve la primera página, no un error', async () => {
      const r = await ejecuciones.listar(
        empresaA,
        {},
        { cursor: 'basura!!!', limite: 1 },
      );
      // Es lo que el usuario espera cuando pega una URL vieja.
      expect(r.items.length).toBeGreaterThanOrEqual(0);
    });

    it('40. el listado de B no ve ejecuciones de A', async () => {
      await nuevaEjecucion();
      const r = await ejecuciones.listar(empresaB, {});
      expect(r.items).toHaveLength(0);
    });

    it('41. el teléfono sale ENMASCARADO', async () => {
      const { executionId } = await nuevaEjecucion();
      const d = await ejecuciones.detalle(empresaA, executionId);

      // Esta pantalla la abre soporte y se comparte en capturas.
      expect(d.contacto).toBe('Cliente');
      expect(JSON.stringify(d)).not.toContain('+57300111');
    });

    it('42. cancelar es atómico y consume las esperas', async () => {
      const { executionId } = await nuevaEjecucion();
      await prisma.flowBotWait.create({
        data: {
          companyId: empresaA,
          executionId,
          kind: 'INPUT',
          resumeNodeId: 'pide',
        },
      });

      await ejecuciones.cancelar(empresaA, usuarioA, executionId, 'prueba');

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      const abiertas = await prisma.flowBotWait.count({
        where: { executionId, consumedAt: null },
      });
      expect(e?.status).toBe('CANCELLED');
      expect(e?.leaseOwner).toBeNull();
      // Sin consumirlas, un job antiguo intentaría despertarla.
      expect(abiertas).toBe(0);
    });

    it('43. cancelar deja rastro de quién y por qué', async () => {
      const { executionId } = await nuevaEjecucion();
      await ejecuciones.cancelar(empresaA, usuarioA, executionId, 'duplicada');

      const paso = await prisma.flowBotExecutionStep.findFirst({
        where: { executionId, nodeType: 'system.cancel' },
      });
      // Sin él, una cancelación es indistinguible de un fallo.
      expect(paso).not.toBeNull();
    });

    it('44. no se cancela lo que ya terminó', async () => {
      const { executionId } = await nuevaEjecucion();
      await prisma.flowBotExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED' },
      });

      const r = await ejecuciones.cancelar(
        empresaA,
        usuarioA,
        executionId,
        'x',
      );
      // Reescribir un final que ya ocurrió falsearía las métricas.
      expect(r.cancelada).toBe(false);
    });

    it('45. pausar y reanudar', async () => {
      const { executionId } = await nuevaEjecucion();
      await ejecuciones.pausar(empresaA, usuarioA, executionId);

      let e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(e?.status).toBe('PAUSED');

      await ejecuciones.reanudar(empresaA, usuarioA, executionId);
      e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      expect(e?.status).toBe('RUNNING');
    });

    it('46. reanudar escribe un evento de OUTBOX, no encola a pelo', async () => {
      const { executionId } = await nuevaEjecucion();
      await ejecuciones.pausar(empresaA, usuarioA, executionId);
      await ejecuciones.reanudar(empresaA, usuarioA, executionId);

      const evento = await prisma.outboxEvent.findFirst({
        where: {
          companyId: empresaA,
          idempotencyKey: { contains: `${executionId}:reanudar` },
        },
      });
      // Si el proceso muere entre el commit y el encolado, el despachador lo
      // publica igual.
      expect(evento).not.toBeNull();
    });

    it('47. NO se reanuda desde un estado que no lo permite', async () => {
      const { executionId } = await nuevaEjecucion();
      await expect(
        ejecuciones.reanudar(empresaA, usuarioA, executionId),
      ).rejects.toThrow();
    });

    it('48. REINTENTAR con efecto incierto pasa a NEEDS_ATTENTION', async () => {
      const { executionId } = await nuevaEjecucion('FAILED');
      // El último paso quedó OK: el efecto YA ocurrió y no hay forma de
      // probar lo contrario.
      await prisma.flowBotExecutionStep.create({
        data: {
          executionId,
          nodeId: 'saluda',
          nodeType: 'send.text',
          status: 'OK',
          idempotencyKey: `${executionId}:saluda:1`,
        },
      });

      const r = await ejecuciones.reintentar(empresaA, usuarioA, executionId);

      expect(r.reintentada).toBe(false);
      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // Reintentar mandaría el mismo WhatsApp dos veces.
      expect(e?.status).toBe('NEEDS_ATTENTION');
    });

    it('49. REINTENTAR con el último paso fallido SÍ reintenta', async () => {
      const { executionId } = await nuevaEjecucion('FAILED');
      await prisma.flowBotExecutionStep.create({
        data: {
          executionId,
          nodeId: 'saluda',
          nodeType: 'send.text',
          status: 'FAILED',
          errorCode: 'red',
          idempotencyKey: `${executionId}:saluda:1`,
        },
      });

      const r = await ejecuciones.reintentar(empresaA, usuarioA, executionId);
      expect(r.reintentada).toBe(true);
    });

    it('50. forzar handoff deja la ejecución en HANDED_OFF', async () => {
      const { executionId } = await nuevaEjecucion();
      await ejecuciones.forzarHandoff(empresaA, usuarioA, executionId, {
        motivo: 'lo pidió el cliente',
      });

      const e = await prisma.flowBotExecution.findUnique({
        where: { id: executionId },
      });
      // `tomarLease` no acepta ese estado: un job antiguo no puede seguir
      // avanzándola por encima de la persona.
      expect(e?.status).toBe('HANDED_OFF');
    });
  });

  // ═══ REDACCIÓN Y MÉTRICAS ════════════════════════════════════

  describe('redacción y métricas', () => {
    it.each([
      'token',
      'accessToken',
      'api_key',
      'API-KEY',
      'authorization',
      'clientSecret',
      'password',
    ])('51. oculta la variable %s', (clave) => {
      const r = redactarVariables({ [clave]: 'valor-secreto' });
      expect(r[clave]).toBe('[oculto]');
    });

    it('52. oculta también dentro de objetos anidados', () => {
      const r = redactarVariables({
        credenciales: { apiKey: 'secreto', nombre: 'visible' },
      });
      const anidado = r.credenciales as Record<string, unknown>;
      expect(anidado.apiKey).toBe('[oculto]');
      expect(anidado.nombre).toBe('visible');
    });

    it('53. recorta textos larguísimos', () => {
      // Suelen ser el cuerpo de una respuesta o el mensaje entero del cliente.
      const r = redactarVariables({ nota: 'x'.repeat(1000) });
      expect(String(r.nota).length).toBeLessThan(400);
    });

    it('54. las métricas son agregadas y sin PII', async () => {
      const m = await metricas.resumen(empresaA);

      expect(typeof m.totales.iniciadas).toBe('number');
      // Ni un identificador de contacto, ni un teléfono, ni un texto: una
      // pantalla de métricas se proyecta en reuniones.
      const texto = JSON.stringify(m);
      expect(texto).not.toContain('+5730');
      expect(texto).not.toContain('Cliente');
    });

    it('55. las métricas de B no cuentan lo de A', async () => {
      const m = await metricas.resumen(empresaB);
      expect(m.totales.iniciadas).toBe(0);
    });
  });

  // ═══ PLANTILLAS ══════════════════════════════════════════════

  describe('plantillas', () => {
    it('56. crear desde plantilla nace DRAFT y declara lo que falta', async () => {
      const plantilla = PLANTILLAS.find(
        (p) => p.camposPorCompletar.length > 0,
      )!;
      const bot = await admin.crearDesdePlantilla(
        empresaA,
        usuarioA,
        plantilla.clave,
      );

      expect(bot.status).toBe('DRAFT');
      expect(bot.templateKey).toBe(plantilla.clave);
      // La interfaz puede pedirlos de entrada en vez de dejar que el usuario
      // los descubra error a error al publicar.
      expect(bot.camposPorCompletar).toEqual(plantilla.camposPorCompletar);
    });

    it('57. una plantilla SIN campos pendientes se publica tal cual', async () => {
      const plantilla = PLANTILLAS.find(
        (p) => p.camposPorCompletar.length === 0,
      )!;
      const bot = await admin.crearDesdePlantilla(
        empresaA,
        usuarioA,
        plantilla.clave,
      );

      const r = await admin.publicar(empresaA, usuarioA, bot.id);
      expect(r.version).toBe(1);
    });

    it('58. una plantilla que no existe da 404', async () => {
      await expect(
        admin.crearDesdePlantilla(empresaA, usuarioA, 'inventada'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
