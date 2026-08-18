// El entorno se fija ANTES de importar nada del comando: `SLUG_DEMO` y los
// correos se resuelven al cargar el modulo, asi que ponerlos despues no
// serviria de nada y la suite acabaria apuntando al tenant demo de la maquina.
const CORRIDA = process.pid.toString(36);
process.env.DEMO_SLUG = `demo-restablecer-e2e-${CORRIDA}`;
process.env.DEMO_ADMIN_EMAIL = `admin.reset.${CORRIDA}@example.invalid`;
process.env.DEMO_AGENT_EMAIL = `asesor.reset.${CORRIDA}@example.invalid`;
process.env.DEMO_ADMIN_PASSWORD = `clave-admin-reset-${CORRIDA}`;
process.env.DEMO_AGENT_PASSWORD = `clave-agente-reset-${CORRIDA}`;

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  SLUG_DEMO,
  PREFIJO,
  validarCuentas,
  asegurarEmpresaYCuentas,
  empresaDemo,
  borrarDatosOperativos,
} from '../scripts/demo-socio';
import { restablecer } from '../scripts/demo-restablecer';
import { verificar } from '../scripts/demo-verificar';

/**
 * DEMO 1.2 — RESTABLECER Y VERIFICAR, CONTRA POSTGRESQL DE VERDAD.
 *
 * Con dobles no se demuestra nada de lo que importa aqui. Que el borrado
 * respeta el orden de las claves ajenas, que una transaccion revierte entera,
 * que `deleteMany` acotado por `companyId` no roza la empresa de al lado: eso
 * son propiedades del MOTOR, y un doble de Prisma responde lo que le digas.
 *
 * La suite monta cuatro empresas vecinas con los prefijos que el incremento
 * nombra —`PREVIEW_BRANDING_`, `QA_MERGE_`, `QA_INBOX_`, `QA_CONTACTS_`— y las
 * usa de testigo: se retratan antes y despues de cada restablecimiento. Si el
 * comando borrara por prefijo de NOMBRE en vez de por `companyId`, esas cuatro
 * son justo las que se llevaria por delante.
 */
const prisma = new PrismaClient();

const CUENTAS = validarCuentas(process.env);

/** Empresa demo aprovisionada desde cero, como haria el comando. */
async function aprovisionar(): Promise<string> {
  const empresaId = await asegurarEmpresaYCuentas(prisma, CUENTAS);
  const r = await restablecer(prisma);
  // El punto de partida de cada prueba tiene que estar comprobado. Si el
  // baseline ya llega torcido, lo que falle despues sera cualquier cosa menos
  // lo que la prueba dice estar comprobando.
  if (!r.informe.ok) {
    throw new Error(
      `El baseline de partida no cuadra: ${r.informe.fallos
        .map((f) => `${f.nombre} (obtenido ${JSON.stringify(f.obtenido)})`)
        .join(' · ')}`,
    );
  }
  return empresaId;
}

/**
 * RETRATO DE CONTENIDO, no de filas.
 *
 * Restablecer BORRA y vuelve a sembrar, asi que los `id` y los `createdAt` de
 * lo sembrado son nuevos cada vez. Comparar filas crudas diria «distinto»
 * siempre y no probaria nada. Lo que tiene que ser identico es el CONTENIDO, y
 * eso es lo que se normaliza aqui: sin ids, sin marcas de tiempo generadas, y
 * en un orden estable para que la comparacion no dependa del planificador.
 *
 * Las cuentas SI llevan su hash: es la unica forma de que «la contraseña se
 * conserva» sea una afirmacion comprobada y no una intencion.
 */
async function retrato(companyId: string) {
  const empresa = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      slug: true,
      isDemo: true,
      status: true,
      email: true,
      city: true,
      country: true,
      businessType: true,
      description: true,
      logoUrl: true,
      primaryColor: true,
      website: true,
      legalName: true,
      quoteFooter: true,
      currency: true,
      timezone: true,
      locale: true,
      taxIncluded: true,
      autoAssignEnabled: true,
      responseSlaMinutes: true,
      retentionMonths: true,
      defaultTaxRate: true,
    },
  });

  const usuarios = await prisma.user.findMany({
    where: { companyId },
    orderBy: { email: 'asc' },
    select: { id: true, email: true, name: true, role: true, password: true },
  });

  const contactos = await prisma.contact.findMany({
    where: { companyId },
    orderBy: { phone: 'asc' },
    select: {
      name: true,
      phone: true,
      email: true,
      tags: true,
      archivedReason: true,
      archivedAt: true,
    },
  });

  const embudos = await prisma.pipeline.findMany({
    where: { companyId },
    orderBy: { order: 'asc' },
    select: {
      name: true,
      order: true,
      isDefault: true,
      stages: {
        orderBy: { order: 'asc' },
        select: { name: true, order: true, color: true, isInitial: true },
      },
    },
  });

  const leads = await prisma.lead.findMany({
    where: { companyId },
    orderBy: { title: 'asc' },
    select: {
      title: true,
      value: true,
      status: true,
      stage: { select: { name: true } },
      contact: { select: { phone: true } },
      agent: { select: { email: true } },
    },
  });

  const conversaciones = await prisma.conversation.findMany({
    where: { companyId },
    orderBy: [{ status: 'asc' }, { contactId: 'asc' }],
    select: {
      status: true,
      contact: { select: { phone: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { direction: true, body: true, status: true, wamid: true },
      },
    },
  });

  const tareas = await prisma.task.findMany({
    where: { companyId },
    orderBy: { title: 'asc' },
    select: { title: true, status: true, priority: true, dueDate: true },
  });

  const productos = await prisma.product.findMany({
    where: { companyId },
    orderBy: { sku: 'asc' },
    select: { name: true, sku: true, price: true },
  });

  const cotizaciones = await prisma.quote.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: {
      number: true,
      title: true,
      status: true,
      total: true,
      items: {
        orderBy: { name: 'asc' },
        select: { name: true, quantity: true, unitPrice: true, subtotal: true },
      },
    },
  });

  const automatizaciones = await prisma.automation.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
    select: { name: true, isActive: true, trigger: true, actions: true },
  });

  const notas = await prisma.note.findMany({
    where: { companyId },
    orderBy: { content: 'asc' },
    select: { content: true },
  });

  const actividad = await prisma.auditLog.findMany({
    where: { affectedCompanyId: companyId },
    orderBy: [{ createdAt: 'desc' }, { action: 'asc' }],
    select: { action: true, entityType: true, actorRole: true },
  });

  const [
    integraciones,
    plantillas,
    outbox,
    ejecucionesAuto,
    ejecucionesBot,
    bots,
    flujosChatbot,
    sesionesChatbot,
    notificaciones,
    camposPropios,
    invitaciones,
    importaciones,
    ajustesLeads,
  ] = await Promise.all([
    prisma.whatsAppIntegration.count({ where: { companyId } }),
    prisma.whatsAppTemplate.count({ where: { companyId } }),
    prisma.outboxEvent.count({ where: { companyId } }),
    prisma.automationRun.count({ where: { automation: { companyId } } }),
    prisma.flowBotExecution.count({ where: { companyId } }),
    prisma.flowBot.count({ where: { companyId } }),
    prisma.chatbotFlow.count({ where: { companyId } }),
    prisma.chatbotSession.count({ where: { companyId } }),
    prisma.notification.count({ where: { companyId } }),
    prisma.customFieldDefinition.count({ where: { companyId } }),
    prisma.invitationCode.count({ where: { companyId } }),
    prisma.productImport.count({ where: { companyId } }),
    prisma.companyLeadSettings.count({ where: { companyId } }),
  ]);

  // `JSON.parse(JSON.stringify(...))` normaliza los `Decimal` y las fechas a
  // texto: dos `Decimal` con la misma cifra no son iguales para `toEqual`.
  return JSON.parse(
    JSON.stringify({
      empresa,
      usuarios,
      contactos,
      embudos,
      leads,
      conversaciones,
      tareas,
      productos,
      cotizaciones,
      automatizaciones,
      notas,
      actividad,
      recuentos: {
        integraciones,
        plantillas,
        outbox,
        ejecucionesAuto,
        ejecucionesBot,
        bots,
        flujosChatbot,
        sesionesChatbot,
        notificaciones,
        camposPropios,
        invitaciones,
        importaciones,
        ajustesLeads,
      },
    }),
  ) as Record<string, unknown>;
}

/** Las cuatro vecinas, con los prefijos que el incremento manda no tocar. */
const VECINAS = [
  'PREVIEW_BRANDING_',
  'QA_MERGE_',
  'QA_INBOX_',
  'QA_CONTACTS_',
] as const;
const vecinas: { prefijo: string; id: string }[] = [];
let retratosVecinas: Record<string, unknown>[] = [];

async function retratarVecinas() {
  return Promise.all(vecinas.map((v) => retrato(v.id)));
}

describe('DEMO 1.2 · restablecer y verificar la empresa demo (e2e, PostgreSQL real)', () => {
  beforeAll(async () => {
    for (let i = 0; i < VECINAS.length; i++) {
      const prefijo = VECINAS[i];
      const empresa = await prisma.company.create({
        data: {
          name: `${prefijo}vecina-${CORRIDA}`,
          status: 'ACTIVE',
          city: 'Ciudad Vecina',
          // A proposito SIN `isDemo`: son empresas normales, y el comando
          // tiene que dejarlas en paz precisamente por eso.
        },
        select: { id: true },
      });
      const contacto = await prisma.contact.create({
        data: {
          companyId: empresa.id,
          name: `${prefijo}contacto`,
          phone: `+57300199${(7000 + i).toString()}`,
          tags: ['vecina'],
        },
        select: { id: true },
      });
      const embudo = await prisma.pipeline.create({
        data: {
          companyId: empresa.id,
          name: `${prefijo}embudo`,
          order: 0,
          isDefault: true,
        },
        select: { id: true },
      });
      const etapa = await prisma.pipelineStage.create({
        data: {
          pipelineId: embudo.id,
          name: 'Nuevo',
          order: 0,
          isInitial: true,
        },
        select: { id: true },
      });
      await prisma.lead.create({
        data: {
          companyId: empresa.id,
          contactId: contacto.id,
          pipelineId: embudo.id,
          stageId: etapa.id,
          title: `${prefijo}oportunidad`,
          value: 1_000_000,
          status: 'OPEN',
        },
      });
      const conversacion = await prisma.conversation.create({
        data: {
          companyId: empresa.id,
          contactId: contacto.id,
          status: 'OPEN',
        },
        select: { id: true },
      });
      await prisma.message.create({
        data: {
          conversationId: conversacion.id,
          direction: 'INBOUND',
          body: `${prefijo}mensaje de la vecina`,
          status: 'DELIVERED',
        },
      });
      await prisma.outboxEvent.create({
        data: {
          companyId: empresa.id,
          type: 'vecina.evento',
          payload: {},
          idempotencyKey: `vecina-${prefijo}${CORRIDA}`,
        },
      });
      vecinas.push({ prefijo, id: empresa.id });
    }
    retratosVecinas = await retratarVecinas();
  });

  afterAll(async () => {
    // EL CANDADO. Esta limpieza borra una empresa entera. Si por un orden de
    // carga inesperado `SLUG_DEMO` acabara siendo el REAL —`demo-socio`—, se
    // llevaria por delante la demo de la maquina. No se borra nada cuyo slug
    // no sea EXACTAMENTE el de esta suite.
    if (!SLUG_DEMO.startsWith('demo-restablecer-e2e-')) {
      throw new Error(
        `La suite iba a limpiar el slug "${SLUG_DEMO}", que no es el suyo. ` +
          `No se borra nada.`,
      );
    }
    const empresa = await prisma.company
      .findUnique({ where: { slug: SLUG_DEMO }, select: { id: true } })
      .catch(() => null);
    if (empresa) {
      await prisma.$transaction(async (tx) => {
        await borrarDatosOperativos(tx, empresa.id);
      });
      await prisma.auditLog.deleteMany({
        where: { affectedCompanyId: empresa.id },
      });
      await prisma.user.deleteMany({ where: { companyId: empresa.id } });
      await prisma.company.deleteMany({ where: { id: empresa.id } });
    }
    for (const v of vecinas) {
      await prisma.$transaction(async (tx) => {
        await borrarDatosOperativos(tx, v.id);
      });
      await prisma.company.deleteMany({ where: { id: v.id } });
    }
    await prisma.$disconnect();
  });

  // ────────────────────────────────────────────────────────────────────
  describe('el comando de verificación (solo lectura)', () => {
    it('da verde sobre una demo recién restablecida, y cubre lo que el alcance pide', async () => {
      await aprovisionar();
      const informe = await verificar(prisma);

      if (!informe.ok) {
        // El mensaje del fallo importa: si esto se pone rojo, lo util es SABER
        // QUE no cuadra, no que «algo» no cuadra.
        throw new Error(
          `Comprobaciones en rojo: ${informe.fallos
            .map(
              (f) =>
                `${f.nombre} (esperado ${JSON.stringify(f.esperado)}, ` +
                `obtenido ${JSON.stringify(f.obtenido)})`,
            )
            .join(' · ')}`,
        );
      }
      expect(informe.ok).toBe(true);
      expect(informe.slug).toBe(SLUG_DEMO);

      // Y que el informe comprueba de verdad cada punto del alcance, no que
      // simplemente sale en verde porque no mira nada.
      const nombres = informe.comprobaciones.map((c) => c.nombre);
      for (const exigido of [
        `slug "${SLUG_DEMO}"`,
        'modo demo activo (isDemo)',
        'total de usuarios',
        'roles exactos',
        'contactos activos',
        'contactos archivados',
        'conversaciones',
        'mensajes',
        'oportunidades abiertas',
        'oportunidades ganadas',
        'el embudo es el PREDETERMINADO',
        'etapas del embudo',
        'tareas',
        'productos',
        'cotizaciones',
        'automatizaciones',
        'valor abierto = suma de las abiertas',
        'sin integración de WhatsApp',
        'cero ejecuciones de automatización',
        'cero outbox pendiente',
      ]) {
        expect(nombres).toContain(exigido);
      }
    });

    it('NO ESCRIBE NADA: el retrato es idéntico antes y después de verificar', async () => {
      const id = await aprovisionar();
      const antes = await retrato(id);
      const tocadaAntes = await prisma.company.findUniqueOrThrow({
        where: { id },
        select: { updatedAt: true },
      });

      await verificar(prisma);

      expect(await retrato(id)).toEqual(antes);
      // `updatedAt` se mueve solo con que alguien haga un `update` vacio: es
      // el detector mas fino que hay de una escritura accidental.
      expect(
        (
          await prisma.company.findUniqueOrThrow({
            where: { id },
            select: { updatedAt: true },
          })
        ).updatedAt,
      ).toEqual(tocadaAntes.updatedAt);
    });

    it('se pone ROJO cuando la demo se sale del baseline, en vez de callar', async () => {
      const id = await aprovisionar();
      await prisma.contact.create({
        data: {
          companyId: id,
          name: 'Contacto de más',
          phone: `+573001998${CORRIDA.slice(-3).padStart(3, '0')}`,
        },
      });

      const informe = await verificar(prisma);
      expect(informe.ok).toBe(false);
      expect(informe.fallos.map((f) => f.nombre)).toContain(
        'contactos activos',
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('restablecer', () => {
    it('devuelve el baseline EXACTO aunque el socio haya creado, editado, archivado y movido datos', async () => {
      const id = await aprovisionar();
      const baseline = await retrato(id);

      // Un recorrido completo de alguien evaluando el producto.
      const admin = await prisma.user.findFirstOrThrow({
        where: { companyId: id, role: 'ADMIN' },
        select: { id: true },
      });

      // CREADO: contactos, campos propios, un flujo de chatbot, un aviso, un
      // codigo de invitacion y hasta una integracion de WhatsApp.
      await prisma.contact.create({
        data: {
          companyId: id,
          name: 'Prospecto del recorrido',
          phone: `+573001997${CORRIDA.slice(-3).padStart(3, '0')}`,
        },
      });
      await prisma.customFieldDefinition.create({
        data: {
          companyId: id,
          entity: 'CONTACT',
          key: 'presupuesto',
          label: 'Presupuesto',
          type: 'CURRENCY',
        },
      });
      await prisma.chatbotFlow.create({
        data: { companyId: id, name: 'Flujo a medio hacer', draftNodes: [] },
      });
      await prisma.notification.create({
        data: {
          companyId: id,
          recipientUserId: admin.id,
          type: 'lead.assigned',
          category: 'LEAD',
          title: 'Te asignaron una oportunidad',
        },
      });
      await prisma.invitationCode.create({
        data: {
          companyId: id,
          codeHash: `hash-inv-${CORRIDA}`,
          codePreview: 'INV-XXXX',
          intendedCompanyName: 'Empresa invitada durante la demo',
          createdByUserId: admin.id,
        },
      });
      await prisma.whatsAppIntegration.create({
        data: {
          companyId: id,
          phoneNumberId: `pn-demo-${CORRIDA}`,
          displayPhoneNumber: '+573001990000',
        },
      });
      await prisma.outboxEvent.create({
        data: {
          companyId: id,
          type: 'message.outbound',
          payload: {},
          idempotencyKey: `demo-sucia-${CORRIDA}`,
        },
      });

      // EDITADO: el perfil de la empresa, que el ADMIN puede cambiar entero.
      await prisma.company.update({
        where: { id },
        data: {
          name: 'Muebles del Socio S.A.S.',
          city: 'Otra Ciudad',
          logoUrl: 'https://ejemplo.invalid/logo.png',
          primaryColor: '#123456',
          quoteFooter: 'Condiciones inventadas durante la demo',
          currency: 'USD',
          retentionMonths: 3,
        },
      });

      // ARCHIVADO Y DESARCHIVADO.
      await prisma.contact.updateMany({
        where: { companyId: id, archivedAt: { not: null } },
        data: { archivedAt: null, archivedReason: null },
      });

      // MOVIDO: una oportunidad cambia de etapa y de estado.
      const etapaFinal = await prisma.pipelineStage.findFirstOrThrow({
        where: { pipeline: { companyId: id }, order: 4 },
        select: { id: true },
      });
      const abierta = await prisma.lead.findFirstOrThrow({
        where: { companyId: id, status: 'OPEN' },
        select: { id: true },
      });
      await prisma.lead.update({
        where: { id: abierta.id },
        data: { stageId: etapaFinal.id, status: 'WON', value: 99_000_000 },
      });

      // BORRADO: se lleva por delante tareas y una cotización.
      await prisma.task.deleteMany({ where: { companyId: id } });
      await prisma.quote.deleteMany({
        where: { companyId: id, status: 'DRAFT' },
      });

      expect(await retrato(id)).not.toEqual(baseline);

      await restablecer(prisma);

      expect(await retrato(id)).toEqual(baseline);
    });

    it('es IDEMPOTENTE: dos veces seguidas dejan exactamente el mismo resultado', async () => {
      const id = await aprovisionar();

      await restablecer(prisma);
      const primera = await retrato(id);

      await restablecer(prisma);
      const segunda = await retrato(id);

      expect(segunda).toEqual(primera);
      // Y no ha aparecido una segunda empresa demo por el camino.
      expect(await prisma.company.count({ where: { slug: SLUG_DEMO } })).toBe(
        1,
      );
    });

    it('CONSERVA las contraseñas vigentes de ADMIN y AGENT', async () => {
      const id = await aprovisionar();

      // El operador cambio las claves despues de aprovisionar: son las que
      // tiene apuntadas y las que va a teclear delante del socio. Se simula
      // escribiendo un hash distinto, que es lo que dejaria ese cambio.
      const antes = await prisma.user.findMany({
        where: { companyId: id },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, password: true, role: true },
      });
      for (const u of antes) {
        await prisma.user.update({
          where: { id: u.id },
          data: { password: `$2b$10$hash-rotado-${u.role}-${CORRIDA}` },
        });
      }
      const rotadas = await prisma.user.findMany({
        where: { companyId: id },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, password: true, role: true },
      });

      await restablecer(prisma);

      const despues = await prisma.user.findMany({
        where: { companyId: id },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, password: true, role: true },
      });
      // Mismos ids, mismos correos y —lo que importa— los MISMOS hashes: el
      // restablecimiento no reescribio ninguna contraseña.
      expect(despues).toEqual(rotadas);
      expect(despues.map((u) => u.password)).not.toEqual(
        antes.map((u) => u.password),
      );
    });

    it('ADMIN y AGENT conservan sus permisos: ni se pierden, ni se amplían', async () => {
      const id = await aprovisionar();
      const antes = await prisma.user.findMany({
        where: { companyId: id },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, role: true, companyId: true },
      });
      expect(antes.map((u) => u.role).sort()).toEqual(['ADMIN', 'AGENT']);

      await restablecer(prisma);

      const despues = await prisma.user.findMany({
        where: { companyId: id },
        orderBy: { email: 'asc' },
        select: { id: true, email: true, role: true, companyId: true },
      });
      expect(despues).toEqual(antes);
      // Ninguna cuenta demo alcanza la plataforma. Un SUPER_ADMIN aqui
      // administraria TODAS las empresas de la instalacion.
      expect(despues.some((u) => u.role === 'SUPER_ADMIN')).toBe(false);
    });

    it('recupera los dos roles aunque el socio se los haya cambiado durante la demo', async () => {
      // El ADMIN de la demo PUEDE ascender al asesor: es una pantalla del
      // producto. Resolver las cuentas solo por rol dejaba la empresa sin
      // ningun AGENT y el comando fallaba justo cuando hacia falta.
      const id = await aprovisionar();
      const asesor = await prisma.user.findFirstOrThrow({
        where: { companyId: id, role: 'AGENT' },
        select: { id: true, email: true, password: true },
      });
      await prisma.user.update({
        where: { id: asesor.id },
        data: { role: 'ADMIN', name: 'Renombrado por el socio' },
      });

      await restablecer(prisma);

      const vuelto = await prisma.user.findUniqueOrThrow({
        where: { id: asesor.id },
        select: { role: true, email: true, password: true, name: true },
      });
      expect(vuelto.role).toBe('AGENT');
      expect(vuelto.email).toBe(asesor.email);
      // La clave sigue siendo la suya aunque el rol se haya repuesto.
      expect(vuelto.password).toBe(asesor.password);
      expect(vuelto.name).toBe(`${PREFIJO}Asesor`);
    });

    it('retira las cuentas de más y deja exactamente dos', async () => {
      const id = await aprovisionar();
      const admin = await prisma.user.findFirstOrThrow({
        where: { companyId: id, role: 'ADMIN' },
        select: { id: true },
      });
      const invitado = await prisma.user.create({
        data: {
          companyId: id,
          email: `invitado.${CORRIDA}@example.invalid`,
          name: 'Invitado durante la demo',
          password: '$2b$10$hash-invitado',
          role: 'AGENT',
        },
        select: { id: true },
      });
      // Con un codigo de invitacion a su nombre: es una clave ajena
      // OBLIGATORIA y `Restrict`, asi que sin retirarla antes el borrado del
      // usuario tumbaria la transaccion entera.
      await prisma.invitationCode.create({
        data: {
          companyId: id,
          codeHash: `hash-inv-extra-${CORRIDA}`,
          codePreview: 'INV-YYYY',
          intendedCompanyName: 'Empresa invitada por la cuenta de más',
          createdByUserId: invitado.id,
        },
      });

      const r = await restablecer(prisma);

      expect(r.usuariosRetirados).toBe(1);
      expect(await prisma.user.count({ where: { companyId: id } })).toBe(2);
      expect(await prisma.user.count({ where: { id: invitado.id } })).toBe(0);
      expect(await prisma.user.count({ where: { id: admin.id } })).toBe(1);
    });

    it('FALLA CERRADO si la empresa con ese slug no está marcada como demo', async () => {
      const id = await aprovisionar();
      const baseline = await retrato(id);

      // El caso que convierte un comando de reinicio en una perdida de datos:
      // alguien crea a mano una empresa con el slug esperado, o retira la
      // marca. Sin `isDemo`, no se toca ni una fila.
      await prisma.company.update({ where: { id }, data: { isDemo: false } });

      await expect(restablecer(prisma)).rejects.toThrow(
        /NO está marcada como demo/,
      );

      await prisma.company.update({ where: { id }, data: { isDemo: true } });
      // Y lo que habia sigue ahi: fallar no puede significar «medio borrado».
      expect(await retrato(id)).toEqual(baseline);
    });

    it('no crea nada si no hay empresa demo: remite a aprovisionar', async () => {
      const empresa = await empresaDemo(prisma);
      if (empresa) {
        await prisma.$transaction(async (tx) => {
          await borrarDatosOperativos(tx, empresa.id);
        });
        await prisma.auditLog.deleteMany({
          where: { affectedCompanyId: empresa.id },
        });
        await prisma.user.deleteMany({ where: { companyId: empresa.id } });
        await prisma.company.delete({ where: { id: empresa.id } });
      }

      await expect(restablecer(prisma)).rejects.toThrow(/demo:aprovisionar/);
      expect(await prisma.company.count({ where: { slug: SLUG_DEMO } })).toBe(
        0,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('aislamiento por companyId', () => {
    it('no roza PREVIEW_BRANDING_, QA_MERGE_, QA_INBOX_ ni QA_CONTACTS_', async () => {
      await aprovisionar();
      expect(await retratarVecinas()).toEqual(retratosVecinas);

      await restablecer(prisma);
      expect(await retratarVecinas()).toEqual(retratosVecinas);
    });

    it('tampoco las roza cuando la demo está sucia: el borrado va por id, no por nombre', async () => {
      const id = await aprovisionar();
      // Se ensucia la demo con datos que llevan los MISMOS prefijos que las
      // vecinas. Un borrado por nombre se llevaria las cuatro por delante.
      await prisma.contact.createMany({
        data: VECINAS.map((prefijo, i) => ({
          companyId: id,
          name: `${prefijo}señuelo`,
          phone: `+57300199${(7100 + i).toString()}`,
        })),
      });

      await restablecer(prisma);

      expect(await retratarVecinas()).toEqual(retratosVecinas);
      // Y los señuelos de la demo sí se fueron.
      expect(
        await prisma.contact.count({
          where: { companyId: id, name: { contains: 'señuelo' } },
        }),
      ).toBe(0);
    });

    it('ninguna fila del baseline apunta fuera de la empresa demo', async () => {
      const id = await aprovisionar();

      const conversaciones = await prisma.conversation.findMany({
        where: { companyId: id },
        select: { contact: { select: { companyId: true } } },
      });
      const leads = await prisma.lead.findMany({
        where: { companyId: id },
        select: {
          contact: { select: { companyId: true } },
          pipeline: { select: { companyId: true } },
          stage: { select: { pipeline: { select: { companyId: true } } } },
        },
      });
      const cotizaciones = await prisma.quote.findMany({
        where: { companyId: id },
        select: { contact: { select: { companyId: true } } },
      });

      expect(conversaciones.length).toBeGreaterThan(0);
      for (const c of conversaciones) expect(c.contact.companyId).toBe(id);
      for (const l of leads) {
        expect(l.contact.companyId).toBe(id);
        expect(l.pipeline.companyId).toBe(id);
        expect(l.stage.pipeline.companyId).toBe(id);
      }
      for (const q of cotizaciones) expect(q.contact?.companyId).toBe(id);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('ningún efecto externo', () => {
    it('deja la empresa sin canal, sin ejecuciones y con el outbox vacío', async () => {
      const id = await aprovisionar();
      await restablecer(prisma);

      expect(
        await prisma.whatsAppIntegration.count({ where: { companyId: id } }),
      ).toBe(0);
      expect(
        await prisma.whatsAppTemplate.count({ where: { companyId: id } }),
      ).toBe(0);
      expect(await prisma.outboxEvent.count({ where: { companyId: id } })).toBe(
        0,
      );
      expect(
        await prisma.outboxEvent.count({
          where: { companyId: id, status: { in: ['PENDING', 'PROCESSING'] } },
        }),
      ).toBe(0);
      expect(
        await prisma.automationRun.count({
          where: { automation: { companyId: id } },
        }),
      ).toBe(0);
      expect(
        await prisma.flowBotExecution.count({ where: { companyId: id } }),
      ).toBe(0);
      expect(
        await prisma.chatbotSession.count({ where: { companyId: id } }),
      ).toBe(0);
      // La marca queda REAFIRMADA: es lo que corta los envios despues, cuando
      // la aplicacion vuelva a leer la empresa.
      expect(
        (
          await prisma.company.findUniqueOrThrow({
            where: { id },
            select: { isDemo: true },
          })
        ).isDemo,
      ).toBe(true);
    });

    it('ningún mensaje del baseline lleva huella de haber salido', async () => {
      const id = await aprovisionar();
      // `wamid` lo asigna Meta y `sentAt` lo pone el transporte: cualquiera de
      // los dos relleno significaria que un mensaje SALIO de verdad.
      expect(
        await prisma.message.count({
          where: { conversation: { companyId: id }, wamid: { not: null } },
        }),
      ).toBe(0);
      expect(
        await prisma.message.count({
          where: { conversation: { companyId: id }, sentAt: { not: null } },
        }),
      ).toBe(0);
      expect(
        await prisma.message.count({
          where: {
            conversation: { companyId: id },
            externalKey: { not: null },
          },
        }),
      ).toBe(0);
    });

    it('los comandos no cargan siquiera un transporte: no hay por dónde enviar', () => {
      // La comprobacion estructural que respalda a las de arriba. Las de
      // arriba dicen «no salio nada esta vez»; esta dice que NO HAY CAMINO:
      // ninguno de los ficheros del comando importa una cola, un cliente HTTP,
      // un cliente de correo ni la aplicacion Nest. Si alguien añadiera un
      // aviso por correo «solo para saber que se restablecio», esto se pone
      // rojo antes de que llegue a enviarse.
      const prohibidos =
        /from\s+'(bullmq|ioredis|axios|nodemailer|@nestjs\/core|socket\.io[^']*|\.\.\/src\/app\.module)'/;
      const ficheros = [
        'demo-restablecer.ts',
        'demo-verificar.ts',
        'demo-socio.ts',
        'demo-socio-baseline.ts',
        'demo-aprovisionar.ts',
        'demo-restaurar.ts',
      ];
      for (const f of ficheros) {
        const fuente = readFileSync(
          join(__dirname, '..', 'scripts', f),
          'utf8',
        );
        expect({
          fichero: f,
          importaTransporte: prohibidos.test(fuente),
        }).toEqual({ fichero: f, importaTransporte: false });
      }
    });
  });
});
