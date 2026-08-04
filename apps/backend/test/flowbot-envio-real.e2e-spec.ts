import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { GuardarrailesWhatsApp } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.guardarrailes';
import { FlowBotKillSwitchService } from '../src/modules/flowbot/engine/flowbot.kill-switch.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { RegistroPlantillas } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.plantillas';
import { GUARDARRAILES } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.modo';

/**
 * LOS GUARDARRAÍLES CONTRA LA BASE REAL.
 *
 * Las pruebas unitarias fijan la decisión dada una foto del sistema. Lo que
 * solo se ve aquí es si esa foto se toma bien: si «la ejecución sigue viva» se
 * consulta con el filtro de empresa, si «hay una persona atendiendo» mira los
 * handoffs correctos, y si el interruptor se lee de verdad. Un mock diría que
 * sí a todo.
 *
 * NINGUNA de estas pruebas puede mandar nada: no hay transporte real por
 * ningún lado y la configuración por defecto ni siquiera lo permitiría.
 *
 * Datos con prefijo E2E-ENV, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-ENV';

const FLUJO = {
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes: [
    {
      id: 'inicio',
      type: 'trigger.inbound_message',
      position: { x: 0, y: 0 },
      config: {},
    },
    { id: 'fin', type: 'control.end', position: { x: 260, y: 0 }, config: {} },
  ],
  edges: [{ id: 'e1', from: 'inicio', fromPort: 'next', to: 'fin' }],
};

/** La configuración que SÍ permitiría enviar. Solo para estas pruebas. */
function permitirTodo(companyId: string, phoneNumberId: string, tel: string) {
  process.env.FLOWBOT_REAL_WHATSAPP_ENABLED = 'true';
  process.env.FLOWBOT_WHATSAPP_DRY_RUN = 'false';
  process.env.FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST = companyId;
  process.env.FLOWBOT_WHATSAPP_PHONE_ALLOWLIST = phoneNumberId;
  process.env.FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST = tel;
}

function limpiarEntorno() {
  delete process.env.FLOWBOT_REAL_WHATSAPP_ENABLED;
  delete process.env.FLOWBOT_WHATSAPP_DRY_RUN;
  delete process.env.FLOWBOT_WHATSAPP_COMPANY_ALLOWLIST;
  delete process.env.FLOWBOT_WHATSAPP_PHONE_ALLOWLIST;
  delete process.env.FLOWBOT_WHATSAPP_RECIPIENT_ALLOWLIST;
}

describe('Guardarraíles de envío real (e2e, base real)', () => {
  const servicioPrisma = prisma as unknown as PrismaService;
  const auditoria = new PlatformAuditLogService(servicioPrisma);
  const killSwitch = new FlowBotKillSwitchService(servicioPrisma, auditoria);
  const guardarrailes = new GuardarrailesWhatsApp(servicioPrisma, killSwitch);
  const plantillas = new RegistroPlantillas(servicioPrisma);

  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let numeroA: string;
  let botA: string;
  let versionA: string;
  let conversacionA: string;
  let ejecucionA: string;
  const TELEFONO = '573001112233';

  beforeAll(async () => {
    process.env.QUEUE_ENABLED = 'false';

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const u = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `${PREFIJO.toLowerCase()}-a@ejemplo.test`,
        password: 'x',
        name: 'Admin A',
        role: 'ADMIN',
      },
    });
    usuarioA = u.id;

    const integracion = await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: `${PREFIJO}-phone-A`,
        status: 'CONNECTED',
        accessTokenEncrypted: 'cifrado-falso',
        isPrimary: true,
      },
    });
    numeroA = integracion.phoneNumberId;

    const bot = await prisma.flowBot.create({
      data: {
        companyId: empresaA,
        name: `${PREFIJO}-bot`,
        status: 'ACTIVE',
        draftGraph: FLUJO,
      },
    });
    botA = bot.id;

    const version = await prisma.flowBotVersion.create({
      data: {
        flowBotId: botA,
        version: 1,
        graph: FLUJO,
        compiled: FLUJO,
        compiledHash: `${PREFIJO}-hash`,
      },
    });
    versionA = version.id;
    await prisma.flowBot.update({
      where: { id: botA },
      data: { publishedVersionId: versionA },
    });

    const contacto = await prisma.contact.create({
      data: { companyId: empresaA, phone: `+${TELEFONO}` },
    });
    const conversacion = await prisma.conversation.create({
      data: {
        companyId: empresaA,
        contactId: contacto.id,
        status: 'OPEN',
        whatsappIntegrationId: integracion.id,
      },
    });
    conversacionA = conversacion.id;

    const ejecucion = await prisma.flowBotExecution.create({
      data: {
        companyId: empresaA,
        flowBotId: botA,
        versionId: versionA,
        conversationId: conversacionA,
        status: 'RUNNING',
        correlationId: `${PREFIJO}-corr`,
        idempotencyKey: `${PREFIJO}-arranque-1`,
        currentNodeId: 'inicio',
      },
    });
    ejecucionA = ejecucion.id;
  });

  afterAll(async () => {
    limpiarEntorno();
    const empresas = [empresaA, empresaB];
    await prisma.flowBotKillSwitch.deleteMany({});
    await prisma.auditLog.deleteMany({
      where: { affectedCompanyId: { in: empresas } },
    });
    await prisma.whatsAppTemplate.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.conversationHandoff.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBotExecution.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.flowBot.updateMany({
      where: { companyId: { in: empresas } },
      data: { publishedVersionId: null },
    });
    await prisma.flowBotVersion.deleteMany({
      where: { flowBot: { companyId: { in: empresas } } },
    });
    await prisma.flowBot.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.message.deleteMany({
      where: { conversation: { companyId: { in: empresas } } },
    });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.whatsAppIntegration.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    limpiarEntorno();
    await prisma.flowBotKillSwitch.deleteMany({});
    await prisma.conversationHandoff.deleteMany({
      where: { companyId: empresaA },
    });
    await prisma.flowBotExecution.updateMany({
      where: { id: ejecucionA },
      data: { status: 'RUNNING', versionId: versionA },
    });
    await prisma.flowBot.updateMany({
      where: { id: botA },
      data: { status: 'ACTIVE', publishedVersionId: versionA },
    });
  });

  const evaluar = () =>
    guardarrailes.evaluar({
      companyId: empresaA,
      executionId: ejecucionA,
      conversationId: conversacionA,
      phoneNumberId: numeroA,
      destinatario: TELEFONO,
      integracionConectada: true,
      idempotencyKey: 'ejec-1-nodo-1-1',
      ventanaOPlantilla: true,
      dentroDeLimite: true,
      circuitoSano: true,
    });

  it('1. con la configuración por defecto NO se llega a real', async () => {
    const d = await evaluar();

    expect(d.modo).toBe('falso');
    expect(d.bloqueos).toContain(GUARDARRAILES.FLAG_GLOBAL);
  });

  it('con todo permitido y el sistema sano, se llega a real', async () => {
    // Es la prueba de que los guardarraíles no son un muro inamovible: si
    // todos se cumplen de verdad, el envío puede salir. Sin esto no se sabría
    // si bloquea por seguridad o porque está roto.
    permitirTodo(empresaA, numeroA, TELEFONO);

    const d = await evaluar();

    expect(d.bloqueos).toEqual([]);
    expect(d.modo).toBe('real');
  });

  it('8. un handoff ACTIVO bloquea el envío', async () => {
    permitirTodo(empresaA, numeroA, TELEFONO);
    await prisma.conversationHandoff.create({
      data: {
        companyId: empresaA,
        conversationId: conversacionA,
        status: 'ACTIVE',
        reason: 'prueba',
      },
    });

    const d = await evaluar();

    expect(d.modo).not.toBe('real');
    expect(d.bloqueos).toContain(GUARDARRAILES.HANDOFF_HUMANO);
  });

  it('un handoff ya RESUELTO no bloquea: el bot puede seguir', async () => {
    permitirTodo(empresaA, numeroA, TELEFONO);
    await prisma.conversationHandoff.create({
      data: {
        companyId: empresaA,
        conversationId: conversacionA,
        status: 'RESOLVED',
        reason: 'prueba',
        resolvedAt: new Date(),
      },
    });

    expect((await evaluar()).modo).toBe('real');
  });

  it('9. una ejecución cancelada bloquea', async () => {
    permitirTodo(empresaA, numeroA, TELEFONO);
    await prisma.flowBotExecution.update({
      where: { id: ejecucionA },
      data: { status: 'CANCELLED' },
    });

    const d = await evaluar();
    expect(d.bloqueos).toContain(GUARDARRAILES.EJECUCION_NO_VIVA);
  });

  it('10. un trabajo de una versión ya sustituida bloquea', async () => {
    // El caso del job antiguo: la cola guardó el trabajo, alguien publicó otra
    // versión y el trabajo sigue ahí. No puede mandar mensajes en nombre de un
    // flujo que ya nadie usa.
    permitirTodo(empresaA, numeroA, TELEFONO);
    const otra = await prisma.flowBotVersion.create({
      data: {
        flowBotId: botA,
        version: 2,
        graph: FLUJO,
        compiled: FLUJO,
        compiledHash: `${PREFIJO}-hash-2`,
      },
    });
    await prisma.flowBot.update({
      where: { id: botA },
      data: { publishedVersionId: otra.id },
    });

    const d = await evaluar();

    expect(d.bloqueos).toContain(GUARDARRAILES.VERSION_INVALIDA);
    expect(d.modo).not.toBe('real');
  });

  it('un bot pausado bloquea aunque la ejecución siga viva', async () => {
    permitirTodo(empresaA, numeroA, TELEFONO);
    await prisma.flowBot.update({
      where: { id: botA },
      data: { status: 'PAUSED' },
    });

    expect((await evaluar()).bloqueos).toContain(GUARDARRAILES.BOT_NO_ACTIVO);
  });

  it('18. la ejecución de OTRA empresa no existe para esta', async () => {
    // El filtro por empresa es lo único que impide que un identificador
    // adivinado sirva para mandar en nombre de otra.
    permitirTodo(empresaB, numeroA, TELEFONO);

    const d = await guardarrailes.evaluar({
      companyId: empresaB,
      executionId: ejecucionA,
      conversationId: conversacionA,
      phoneNumberId: numeroA,
      destinatario: TELEFONO,
      integracionConectada: true,
      idempotencyKey: 'k',
      ventanaOPlantilla: true,
      dentroDeLimite: true,
      circuitoSano: true,
    });

    expect(d.modo).not.toBe('real');
    expect(d.bloqueos).toEqual(
      expect.arrayContaining([
        GUARDARRAILES.EJECUCION_NO_VIVA,
        GUARDARRAILES.BOT_NO_PUBLICADO,
      ]),
    );
  });

  describe('interruptor de emergencia', () => {
    it('activo, bloquea todo y queda auditado', async () => {
      permitirTodo(empresaA, numeroA, TELEFONO);

      await killSwitch.cambiar({
        activo: true,
        motivo: 'prueba de emergencia',
        actorUserId: usuarioA,
        actorRole: 'ADMIN',
      });

      const d = await evaluar();
      expect(d.modo).not.toBe('real');
      expect(d.bloqueos).toContain(GUARDARRAILES.KILL_SWITCH);

      const registro = await prisma.auditLog.findFirst({
        where: { action: 'flowbot.killswitch.on' },
        orderBy: { createdAt: 'desc' },
      });
      expect(registro?.actorUserId).toBe(usuarioA);
      expect(registro?.reason).toBe('prueba de emergencia');
    });

    it('desactivarlo devuelve el sistema a donde estaba', async () => {
      permitirTodo(empresaA, numeroA, TELEFONO);
      await killSwitch.cambiar({
        activo: true,
        motivo: 'x',
        actorUserId: usuarioA,
        actorRole: 'ADMIN',
      });
      await killSwitch.cambiar({
        activo: false,
        actorUserId: usuarioA,
        actorRole: 'ADMIN',
      });

      expect((await evaluar()).modo).toBe('real');
    });

    it('NO borra ejecuciones ni conversaciones', async () => {
      // Parar los envíos es una pausa, no una limpieza. Si además borrara,
      // nadie se atrevería a usarlo.
      await killSwitch.cambiar({
        activo: true,
        motivo: 'x',
        actorUserId: usuarioA,
        actorRole: 'ADMIN',
      });

      expect(
        await prisma.flowBotExecution.count({ where: { id: ejecucionA } }),
      ).toBe(1);
      expect(
        await prisma.conversation.count({ where: { id: conversacionA } }),
      ).toBe(1);
    });

    it('el estado se puede consultar y dice por qué', async () => {
      await killSwitch.cambiar({
        activo: true,
        motivo: 'incidente con un cliente',
        actorUserId: usuarioA,
        actorRole: 'ADMIN',
      });

      const estado = await killSwitch.estado();
      expect(estado.activo).toBe(true);
      expect(estado.motivo).toBe('incidente con un cliente');
      expect(estado.activadoPor).toBe('Admin A');
    });

    it('si no se puede leer, se asume ACTIVO', async () => {
      // Fail-closed. Un interruptor que se abre solo cuando no puede
      // comprobarse no es un interruptor, es una recomendación.
      const roto = new FlowBotKillSwitchService(
        {
          flowBotKillSwitch: {
            findUnique: () => Promise.reject(new Error('base caída')),
          },
        } as unknown as PrismaService,
        auditoria,
      );

      expect(await roto.activo()).toBe(true);
    });
  });

  describe('plantillas', () => {
    it('15. una plantilla que no está registrada queda BLOQUEADA', async () => {
      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'no-registrada',
        idioma: 'es',
        parametrosEnviados: 0,
      });

      expect(estado.aprobada).toBe(false);
      expect(estado.motivo).toContain('no está registrada');
    });

    it('una registrada pero sin verificar tampoco pasa', async () => {
      // Registrarla no es aprobarla. Asumir que sí es lo que acaba mandando
      // plantillas que Meta rechaza y degradando la calidad del número.
      await prisma.whatsAppTemplate.create({
        data: {
          companyId: empresaA,
          name: 'sin-verificar',
          language: 'es',
          status: 'UNKNOWN',
        },
      });

      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'sin-verificar',
        idioma: 'es',
        parametrosEnviados: 0,
      });

      expect(estado.aprobada).toBe(false);
      expect(estado.motivo).toContain('nunca se verificó');
    });

    it('una aprobada con otro número de parámetros se bloquea', async () => {
      await prisma.whatsAppTemplate.create({
        data: {
          companyId: empresaA,
          name: 'con-dos-datos',
          language: 'es',
          status: 'APPROVED',
          bodyParams: 2,
          lastCheckedAt: new Date(),
        },
      });

      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'con-dos-datos',
        idioma: 'es',
        parametrosEnviados: 1,
      });

      expect(estado.aprobada).toBe(false);
      expect(estado.motivo).toContain('espera 2');
    });

    it('una aprobada con los parámetros correctos pasa', async () => {
      await prisma.whatsAppTemplate.create({
        data: {
          companyId: empresaA,
          name: 'lista',
          language: 'es',
          status: 'APPROVED',
          bodyParams: 1,
          lastCheckedAt: new Date(),
        },
      });

      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'lista',
        idioma: 'es',
        parametrosEnviados: 1,
      });

      expect(estado.aprobada).toBe(true);
    });

    it('la plantilla de OTRA empresa no vale', async () => {
      await prisma.whatsAppTemplate.create({
        data: {
          companyId: empresaB,
          name: 'de-la-otra',
          language: 'es',
          status: 'APPROVED',
          bodyParams: 0,
          lastCheckedAt: new Date(),
        },
      });

      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'de-la-otra',
        idioma: 'es',
        parametrosEnviados: 0,
      });

      expect(estado.aprobada).toBe(false);
    });

    it('el idioma forma parte de la identidad de la plantilla', async () => {
      // Una plantilla aprobada en `es` NO existe en `en`, y el envío fallaría
      // con un código que no menciona el idioma.
      await prisma.whatsAppTemplate.create({
        data: {
          companyId: empresaA,
          name: 'solo-en-espanol',
          language: 'es',
          status: 'APPROVED',
          bodyParams: 0,
          lastCheckedAt: new Date(),
        },
      });

      const estado = await plantillas.estado({
        companyId: empresaA,
        whatsappIntegrationId: null,
        nombre: 'solo-en-espanol',
        idioma: 'en',
        parametrosEnviados: 0,
      });

      expect(estado.aprobada).toBe(false);
    });
  });
});
