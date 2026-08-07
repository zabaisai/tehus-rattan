import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { FlowBotAdminService } from '../src/modules/flowbot/api/flowbot.admin.service';
import { FlowBotReferenciasService } from '../src/modules/flowbot/graph/flowbot.referencias.service';

/**
 * IMPORTAR Y EXPORTAR PULSOS — contra la base real.
 *
 * Lo que importa aqui es que un bot exportado se pueda volver a abrir, que lo
 * importado nazca SIEMPRE en borrador e inactivo, y que el archivo no lleve
 * dentro ni un secreto ni un identificador de la empresa de origen.
 *
 * Datos con prefijo E2E-INT, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-INT';

describe('Intercambio de Pulsos (e2e, base real)', () => {
  const admin = new FlowBotAdminService(
    prisma as unknown as PrismaService,
    new FlowBotReferenciasService(prisma as unknown as PrismaService),
  );

  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let usuarioB: string;

  function grafoDePrueba(idUsuario: string) {
    return {
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
          id: 'saludo',
          type: 'send.text',
          position: { x: 200, y: 0 },
          config: { text: 'Hola, ¿en qué te ayudo?' },
        },
        {
          id: 'tarea',
          type: 'crm.task_create',
          position: { x: 400, y: 0 },
          // Un identificador de ESTA empresa. No puede salir en el archivo.
          config: { title: 'Llamar', assignedTo: idUsuario },
        },
      ],
      edges: [
        { id: 'e1', from: 'inicio', fromPort: 'next', to: 'saludo' },
        { id: 'e2', from: 'saludo', fromPort: 'next', to: 'tarea' },
      ],
    };
  }

  beforeAll(async () => {
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
        email: `${PREFIJO.toLowerCase()}-a@qa.invalid`,
        name: 'Asesor A',
        password: 'no-se-usa',
        role: 'ADMIN',
      },
    });
    const ub = await prisma.user.create({
      data: {
        companyId: empresaB,
        email: `${PREFIJO.toLowerCase()}-b@qa.invalid`,
        name: 'Asesor B',
        password: 'no-se-usa',
        role: 'ADMIN',
      },
    });
    usuarioA = ua.id;
    usuarioB = ub.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  async function botDeOrigen() {
    return admin.crear(empresaA, usuarioA, {
      nombre: `${PREFIJO} Bienvenida`,
      descripcion: 'Saluda y deja una tarea',
      graph: grafoDePrueba(usuarioA),
    });
  }

  it('el archivo exportado NO lleva el identificador del usuario de origen', async () => {
    const bot = await botDeOrigen();

    const sobre = await admin.exportar(empresaA, bot.id);

    expect(JSON.stringify(sobre)).not.toContain(usuarioA);
    expect(sobre.requisitos).toEqual([
      expect.objectContaining({ campo: 'assignedTo', tipo: 'user' }),
    ]);
  });

  /**
   * IDA Y VUELTA ENTRE EMPRESAS DISTINTAS.
   *
   * Es el caso para el que existe exportar: llevarse un bot de una empresa a
   * otra. Si el archivo arrastrara ids del origen, el bot importado asignaría
   * trabajo a alguien que aquí no existe —o peor, a otra persona.
   */
  it('un bot exportado en A se importa en B y conserva su forma', async () => {
    const bot = await botDeOrigen();
    const sobre = await admin.exportar(empresaA, bot.id);

    const r = await admin.importar(empresaB, usuarioB, JSON.stringify(sobre));

    const importado = await prisma.flowBot.findUnique({
      where: { id: r.bot.id },
    });
    expect(importado!.companyId).toBe(empresaB);

    const grafo = importado!.draftGraph as unknown as {
      nodes: Array<{ type: string; config?: Record<string, unknown> }>;
      edges: unknown[];
    };
    expect(grafo.nodes.map((n) => n.type)).toEqual([
      'trigger.inbound_message',
      'send.text',
      'crm.task_create',
    ]);
    expect(grafo.edges).toHaveLength(2);

    // El texto del bot sí viaja.
    const saludo = grafo.nodes.find((n) => n.type === 'send.text')!;
    expect(saludo.config!.text).toBe('Hola, ¿en qué te ayudo?');

    // El asesor de la otra empresa NO.
    const tarea = grafo.nodes.find((n) => n.type === 'crm.task_create')!;
    expect(tarea.config).not.toHaveProperty('assignedTo');
    expect(r.requisitos).toHaveLength(1);
  });

  /**
   * LO QUE NO PUEDE PASAR NUNCA.
   *
   * Un bot importado que se publicara o activara solo empezaría a contestar a
   * clientes reales con un flujo que nadie de esta empresa ha revisado.
   */
  it('lo importado nace en BORRADOR, sin versión publicada y sin disparadores', async () => {
    const bot = await botDeOrigen();
    const sobre = await admin.exportar(empresaA, bot.id);

    const r = await admin.importar(empresaB, usuarioB, JSON.stringify(sobre));

    const importado = await prisma.flowBot.findUnique({
      where: { id: r.bot.id },
      select: { status: true, publishedVersionId: true },
    });
    expect(importado!.status).toBe('DRAFT');
    expect(importado!.publishedVersionId).toBeNull();

    expect(
      await prisma.flowBotTrigger.count({ where: { flowBotId: r.bot.id } }),
    ).toBe(0);
    expect(
      await prisma.flowBotVersion.count({ where: { flowBotId: r.bot.id } }),
    ).toBe(0);
  });

  it('se puede elegir el nombre al importar', async () => {
    const bot = await botDeOrigen();
    const sobre = await admin.exportar(empresaA, bot.id);

    const r = await admin.importar(
      empresaB,
      usuarioB,
      JSON.stringify(sobre),
      `${PREFIJO} con otro nombre`,
    );

    expect(r.bot.name).toBe(`${PREFIJO} con otro nombre`);
  });

  it('la vista previa NO crea ningún bot', async () => {
    const bot = await botDeOrigen();
    const sobre = await admin.exportar(empresaA, bot.id);
    const antes = await prisma.flowBot.count({
      where: { companyId: empresaB },
    });

    const previa = admin.analizarImportacion(JSON.stringify(sobre));

    expect(previa.sobre.grafo.nodes).toHaveLength(3);
    expect(await prisma.flowBot.count({ where: { companyId: empresaB } })).toBe(
      antes,
    );
  });

  it('NO se puede exportar el bot de otra empresa', async () => {
    const bot = await botDeOrigen();

    await expect(admin.exportar(empresaB, bot.id)).rejects.toThrow();
  });

  it('un archivo que no es un Pulso exportado se rechaza sin crear nada', async () => {
    const antes = await prisma.flowBot.count({
      where: { companyId: empresaB },
    });

    await expect(
      admin.importar(empresaB, usuarioB, JSON.stringify({ cualquier: 'cosa' })),
    ).rejects.toThrow(/no es un Pulso exportado/i);

    expect(await prisma.flowBot.count({ where: { companyId: empresaB } })).toBe(
      antes,
    );
  });

  it('los identificadores de nodo del archivo NO se reutilizan', async () => {
    const bot = await botDeOrigen();
    const sobre = await admin.exportar(empresaA, bot.id);

    const r = await admin.importar(empresaB, usuarioB, JSON.stringify(sobre));

    const importado = await prisma.flowBot.findUnique({
      where: { id: r.bot.id },
    });
    const grafo = importado!.draftGraph as unknown as {
      nodes: Array<{ id: string }>;
    };
    const ids = grafo.nodes.map((n) => n.id);

    expect(ids).not.toContain('inicio');
    expect(ids).not.toContain('saludo');
    expect(ids).not.toContain('tarea');
  });
});
