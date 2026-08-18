// Slug propio ANTES de importar el modulo: la constante se resuelve al
// cargarlo, asi que fijarlo despues no serviria de nada.
process.env.DEMO_SLUG = `demo-socio-e2e-${process.pid.toString(36)}`;

import { PrismaClient } from '@prisma/client';
import {
  SLUG_DEMO,
  PREFIJO,
  validarCuentas,
  asegurarEmpresaYCuentas,
  empresaDemo,
  borrarDatosOperativos,
} from '../scripts/demo-socio';
import { sembrarBaseline } from '../scripts/demo-socio-baseline';

/**
 * LA EMPRESA DEMO, CONTRA LA BASE REAL.
 *
 * Con dobles no se ve lo que importa: que aprovisionar dos veces no duplica,
 * que restaurar devuelve EXACTAMENTE el baseline, y —sobre todo— que ni el
 * aprovisionamiento ni la restauración tocan una sola fila de otra empresa.
 * Eso último solo lo demuestra una base con más de una empresa dentro.
 *
 * Esta suite crea su propia empresa vecina `E2E-DEMO-VECINA` y la usa como
 * testigo: se cuenta antes y después de cada operación.
 */
const prisma = new PrismaClient();
const corrida = process.pid.toString(36);
const CUENTAS = {
  DEMO_ADMIN_PASSWORD: 'clave-demo-admin-e2e',
  DEMO_AGENT_PASSWORD: 'clave-demo-agente-e2e',
  DEMO_ADMIN_EMAIL: `admin.demo.${corrida}@example.invalid`,
  DEMO_AGENT_EMAIL: `asesor.demo.${corrida}@example.invalid`,
};

async function aprovisionar() {
  const cuentas = validarCuentas(CUENTAS);
  const empresaId = await asegurarEmpresaYCuentas(prisma, cuentas);
  const admin = await prisma.user.findUnique({
    where: { email: cuentas.adminEmail },
    select: { id: true },
  });
  const asesor = await prisma.user.findUnique({
    where: { email: cuentas.agentEmail },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await borrarDatosOperativos(tx, empresaId);
    await sembrarBaseline(tx, empresaId, admin!.id, asesor!.id);
  });
  return empresaId;
}

async function foto(companyId: string) {
  const [
    contactos,
    conversaciones,
    mensajes,
    leads,
    tareas,
    productos,
    quotes,
    autos,
    runs,
    usuarios,
  ] = await Promise.all([
    prisma.contact.count({ where: { companyId } }),
    prisma.conversation.count({ where: { companyId } }),
    prisma.message.count({ where: { conversation: { companyId } } }),
    prisma.lead.count({ where: { companyId } }),
    prisma.task.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.quote.count({ where: { companyId } }),
    prisma.automation.count({ where: { companyId } }),
    prisma.automationRun.count({ where: { automation: { companyId } } }),
    prisma.user.count({ where: { companyId } }),
  ]);
  return {
    contactos,
    conversaciones,
    mensajes,
    leads,
    tareas,
    productos,
    quotes,
    autos,
    runs,
    usuarios,
  };
}

describe('Empresa demo para un socio (e2e, base real)', () => {
  let vecinaId: string;
  let vecinaFoto: Awaited<ReturnType<typeof foto>>;

  beforeAll(async () => {
    const vecina = await prisma.company.create({
      data: { name: `E2E-DEMO-VECINA-${corrida}`, status: 'ACTIVE' },
      select: { id: true },
    });
    vecinaId = vecina.id;
    await prisma.contact.create({
      data: {
        companyId: vecinaId,
        phone: `+5730009${corrida.slice(-4).padStart(4, '0')}`,
        name: 'E2E-DEMO-VECINA Contacto',
      },
    });
    vecinaFoto = await foto(vecinaId);
  });

  afterAll(async () => {
    // EL CANDADO QUE FALTABA. La primera version resolvia la empresa por el
    // slug vigente y la borraba. Si por el orden de carga de modulos ese slug
    // acababa siendo el REAL —`demo-socio`—, esta limpieza se llevaba por
    // delante la demo de la maquina. Paso de verdad, y por eso ahora la suite
    // se niega a borrar nada cuyo slug no sea EXACTAMENTE el suyo.
    if (!SLUG_DEMO.startsWith('demo-socio-e2e-')) {
      throw new Error(
        `La suite iba a limpiar el slug "${SLUG_DEMO}", que no es el suyo. ` +
          `No se borra nada.`,
      );
    }

    const empresa = await empresaDemo(prisma);
    if (empresa) {
      await prisma.$transaction(async (tx) => {
        await borrarDatosOperativos(tx, empresa.id);
      });
      await prisma.user.deleteMany({ where: { companyId: empresa.id } });
      await prisma.company.deleteMany({ where: { id: empresa.id } });
    }
    await prisma.contact.deleteMany({ where: { companyId: vecinaId } });
    await prisma.company.deleteMany({ where: { id: vecinaId } });
    await prisma.$disconnect();
  });

  it('aprovisiona la empresa con su marca de demo y sus dos cuentas', async () => {
    const id = await aprovisionar();

    const empresa = await prisma.company.findUnique({
      where: { id },
      select: { slug: true, isDemo: true, name: true },
    });
    expect(empresa?.slug).toBe(SLUG_DEMO);
    // La marca es lo que activa el guardarrail: sin ella la demo podria enviar.
    expect(empresa?.isDemo).toBe(true);
    expect(empresa?.name).toContain(PREFIJO);

    const roles = await prisma.user.findMany({
      where: { companyId: id },
      select: { role: true },
      orderBy: { role: 'asc' },
    });
    expect(roles.map((r) => r.role).sort()).toEqual(['ADMIN', 'AGENT']);
  });

  it('NO crea ningun SUPER_ADMIN', async () => {
    const id = await aprovisionar();
    expect(
      await prisma.user.count({
        where: { companyId: id, role: 'SUPER_ADMIN' },
      }),
    ).toBe(0);
  });

  it('el baseline deja estados variados, no solo listas llenas', async () => {
    const id = await aprovisionar();

    expect(
      await prisma.contact.count({
        where: { companyId: id, archivedAt: null },
      }),
    ).toBe(5);
    // Uno archivado: la Papelera tiene que poder enseñarse.
    expect(
      await prisma.contact.count({
        where: { companyId: id, archivedAt: { not: null } },
      }),
    ).toBe(1);
    expect(
      await prisma.lead.count({ where: { companyId: id, status: 'WON' } }),
    ).toBe(1);
    expect(
      await prisma.lead.count({ where: { companyId: id, status: 'OPEN' } }),
    ).toBe(4);
    expect(
      await prisma.conversation.count({
        where: { companyId: id, status: 'ARCHIVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.task.count({
        where: { companyId: id, status: 'COMPLETED' },
      }),
    ).toBe(1);
    expect(
      await prisma.quote.count({ where: { companyId: id, status: 'DRAFT' } }),
    ).toBe(1);
    expect(
      await prisma.quote.count({ where: { companyId: id, status: 'SENT' } }),
    ).toBe(1);
    // Una oportunidad sin asesor, para que se vea «Sin asignar».
    expect(
      await prisma.lead.count({ where: { companyId: id, assignedTo: null } }),
    ).toBe(2);
  });

  it('las automatizaciones quedan en BORRADOR y sin ejecuciones', async () => {
    const id = await aprovisionar();
    expect(
      await prisma.automation.count({
        where: { companyId: id, isActive: true },
      }),
    ).toBe(0);
    expect(
      await prisma.automation.count({
        where: { companyId: id, isActive: false },
      }),
    ).toBe(1);
    expect(
      await prisma.automationRun.count({
        where: { automation: { companyId: id } },
      }),
    ).toBe(0);
  });

  it('aprovisionar DOS VECES no duplica nada', async () => {
    const id = await aprovisionar();
    const primera = await foto(id);

    const id2 = await aprovisionar();

    // La misma empresa, no una segunda.
    expect(id2).toBe(id);
    expect(await prisma.company.count({ where: { slug: SLUG_DEMO } })).toBe(1);
    expect(await foto(id)).toEqual(primera);
  });

  it('modificar y restaurar devuelve EXACTAMENTE el baseline', async () => {
    const id = await aprovisionar();
    const baseline = await foto(id);

    // Se ensucia como lo haria alguien recorriendo la demo.
    await prisma.contact.create({
      data: {
        companyId: id,
        phone: '+573001991111',
        name: 'Sobrante de la demo',
      },
    });
    await prisma.task.deleteMany({
      where: { companyId: id, status: 'COMPLETED' },
    });
    await prisma.contact.updateMany({
      where: { companyId: id, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    expect(await foto(id)).not.toEqual(baseline);

    // Restaurar: mismo camino que el comando.
    const admin = await prisma.user.findFirst({
      where: { companyId: id, role: 'ADMIN' },
      select: { id: true },
    });
    const asesor = await prisma.user.findFirst({
      where: { companyId: id, role: 'AGENT' },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await borrarDatosOperativos(tx, id);
      await sembrarBaseline(tx, id, admin!.id, asesor!.id);
    });

    expect(await foto(id)).toEqual(baseline);
    // Y el sobrante ya no esta.
    expect(
      await prisma.contact.count({
        where: { companyId: id, name: 'Sobrante de la demo' },
      }),
    ).toBe(0);
  });

  it('restaurar CONSERVA las dos cuentas: no las borra ni las recrea', async () => {
    const id = await aprovisionar();
    const antes = await prisma.user.findMany({
      where: { companyId: id },
      select: { id: true, email: true, role: true },
      orderBy: { email: 'asc' },
    });

    const admin = antes.find((u) => u.role === 'ADMIN')!;
    const asesor = antes.find((u) => u.role === 'AGENT')!;
    await prisma.$transaction(async (tx) => {
      await borrarDatosOperativos(tx, id);
      await sembrarBaseline(tx, id, admin.id, asesor.id);
    });

    const despues = await prisma.user.findMany({
      where: { companyId: id },
      select: { id: true, email: true, role: true },
      orderBy: { email: 'asc' },
    });
    // Los MISMOS ids: no se recrearon, se conservaron.
    expect(despues).toEqual(antes);
  });

  it('CERO FUGAS: aprovisionar y restaurar no tocan a la empresa vecina', async () => {
    const id = await aprovisionar();
    expect(await foto(vecinaId)).toEqual(vecinaFoto);

    const admin = await prisma.user.findFirst({
      where: { companyId: id, role: 'ADMIN' },
      select: { id: true },
    });
    const asesor = await prisma.user.findFirst({
      where: { companyId: id, role: 'AGENT' },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await borrarDatosOperativos(tx, id);
      await sembrarBaseline(tx, id, admin!.id, asesor!.id);
    });

    expect(await foto(vecinaId)).toEqual(vecinaFoto);
  });

  it('ningun dato demo se relaciona con otra empresa', async () => {
    const id = await aprovisionar();

    // Toda conversacion, oportunidad y tarea de la demo apunta a un contacto
    // de la MISMA empresa. Un id cruzado seria una fuga silenciosa.
    const conversaciones = await prisma.conversation.findMany({
      where: { companyId: id },
      select: { contact: { select: { companyId: true } } },
    });
    const leads = await prisma.lead.findMany({
      where: { companyId: id },
      select: {
        contact: { select: { companyId: true } },
        pipeline: { select: { companyId: true } },
      },
    });

    for (const c of conversaciones) expect(c.contact.companyId).toBe(id);
    for (const l of leads) {
      expect(l.contact.companyId).toBe(id);
      expect(l.pipeline.companyId).toBe(id);
    }
  });

  it('se NIEGA a tocar una empresa con ese slug que no esté marcada como demo', async () => {
    // El caso que convierte un comando de reinicio en una perdida de datos:
    // alguien crea a mano una empresa con el slug esperado. Sin la marca, no
    // se toca.
    const id = await aprovisionar();
    await prisma.company.update({ where: { id }, data: { isDemo: false } });

    await expect(empresaDemo(prisma)).rejects.toThrow(
      /NO está marcada como demo/,
    );

    await prisma.company.update({ where: { id }, data: { isDemo: true } });
  });

  it('la empresa demo no tiene integración de WhatsApp', async () => {
    const id = await aprovisionar();
    expect(
      await prisma.whatsAppIntegration.count({ where: { companyId: id } }),
    ).toBe(0);
  });

  it('no deja eventos en el outbox', async () => {
    const id = await aprovisionar();
    expect(await prisma.outboxEvent.count({ where: { companyId: id } })).toBe(
      0,
    );
  });
});
