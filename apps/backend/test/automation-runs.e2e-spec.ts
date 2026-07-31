import { PrismaService } from '../src/prisma/prisma.service';
import {
  AutomationRunsService,
  MAXIMOS_INTENTOS,
} from '../src/modules/automations/automation-runs.service';
import { AutomationsService } from '../src/modules/automations/automations.service';

/**
 * Historial, versionado e idempotencia de automatizaciones, contra base REAL.
 *
 * La idempotencia se apoya en un indice unico: probarla con un doble solo
 * comprobaria que el doble devuelve lo que yo le dije. Aqui la garantiza
 * PostgreSQL, que es quien la garantizara en produccion.
 */
describe('Automatizaciones: historial y versiones (e2e, base real)', () => {
  let prisma: PrismaService;
  let runs: AutomationRunsService;
  let automations: AutomationsService;

  let empresaId: string;
  let automatizacionId: string;

  const dobles = {
    messages: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    conversations: { update: jest.fn().mockResolvedValue({}) },
    whatsapp: {
      sendMessage: jest.fn().mockResolvedValue('wamid-1'),
      sendFromConversation: jest.fn().mockResolvedValue('wamid-1'),
    },
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    runs = new AutomationRunsService();
    automations = new AutomationsService(
      prisma,
      dobles.messages as never,
      dobles.conversations as never,
      dobles.whatsapp as never,
      runs,
    );

    const empresa = await prisma.company.create({
      data: { name: 'E2E Automations Co' },
    });
    empresaId = empresa.id;

    const creada = await automations.create(
      empresaId,
      {
        name: 'Saludo inicial',
        trigger: 'first_message',
        actions: [{ type: 'send_message', message: 'Hola' }],
      },
      undefined,
    );
    automatizacionId = creada.id;
  });

  afterAll(async () => {
    await prisma.automationRun.deleteMany({ where: { companyId: empresaId } });
    await prisma.automationVersion.deleteMany({
      where: { automation: { companyId: empresaId } },
    });
    await prisma.automation.deleteMany({ where: { companyId: empresaId } });
    await prisma.company.delete({ where: { id: empresaId } });
    await prisma.$disconnect();
  });

  describe('versionado', () => {
    it('crear publica la version 1 en la misma transaccion', async () => {
      // Una automatizacion sin ninguna version guardada dejaria el historial
      // sin nada con que explicar sus ejecuciones.
      const versiones = await prisma.automationVersion.findMany({
        where: { automationId: automatizacionId },
      });

      expect(versiones).toHaveLength(1);
      expect(versiones[0].version).toBe(1);
      expect(versiones[0].trigger).toBe('first_message');
    });

    it('cambiar las acciones sube la version y guarda la foto', async () => {
      await automations.update(automatizacionId, empresaId, {
        actions: [{ type: 'close_conversation' }],
      });

      const automatizacion = await prisma.automation.findUniqueOrThrow({
        where: { id: automatizacionId },
      });
      const versiones = await prisma.automationVersion.findMany({
        where: { automationId: automatizacionId },
        orderBy: { version: 'asc' },
      });

      expect(automatizacion.version).toBe(2);
      expect(versiones).toHaveLength(2);
      // La version 1 conserva lo que decia entonces: es lo que permite
      // explicar una ejecucion antigua.
      expect(JSON.stringify(versiones[0].actions)).toContain('send_message');
    });

    it('cambiar solo el nombre NO crea version', async () => {
      // Versionar cada retoque cosmetico llenaria el historial de ruido en el
      // que se pierde el cambio que si importa.
      const antes = await prisma.automationVersion.count({
        where: { automationId: automatizacionId },
      });

      await automations.update(automatizacionId, empresaId, {
        name: 'Saludo inicial (renombrado)',
      });

      const despues = await prisma.automationVersion.count({
        where: { automationId: automatizacionId },
      });
      expect(despues).toBe(antes);
    });

    it('desactivar tampoco crea version', async () => {
      const antes = await prisma.automationVersion.count({
        where: { automationId: automatizacionId },
      });

      await automations.update(automatizacionId, empresaId, {
        isActive: false,
      });
      await automations.update(automatizacionId, empresaId, { isActive: true });

      const despues = await prisma.automationVersion.count({
        where: { automationId: automatizacionId },
      });
      expect(despues).toBe(antes);
    });
  });

  describe('idempotencia', () => {
    it('la misma llave solo abre UNA ejecucion', async () => {
      // Es lo que impide que un reintento del job vuelva a mandarle un
      // WhatsApp al cliente.
      const llave = `idem-${Date.now()}`;
      const entrada = {
        automationId: automatizacionId,
        automationVersion: 1,
        companyId: empresaId,
        triggerType: 'first_message',
        idempotencyKey: llave,
      };

      const primera = await runs.abrir(prisma, entrada);
      const segunda = await runs.abrir(prisma, entrada);

      expect(primera).not.toBeNull();
      expect(segunda).toBeNull();
    });

    it('llaves distintas abren ejecuciones distintas', async () => {
      const base = {
        automationId: automatizacionId,
        automationVersion: 1,
        companyId: empresaId,
        triggerType: 'first_message',
      };

      const a = await runs.abrir(prisma, {
        ...base,
        idempotencyKey: `a-${Date.now()}`,
      });
      const b = await runs.abrir(prisma, {
        ...base,
        idempotencyKey: `b-${Date.now()}`,
      });

      expect(a?.id).not.toBe(b?.id);
    });
  });

  describe('resultado de la ejecucion', () => {
    const abrir = () =>
      runs.abrir(prisma, {
        automationId: automatizacionId,
        automationVersion: 1,
        companyId: empresaId,
        triggerType: 'keyword',
        idempotencyKey: `res-${Math.random()}`,
      });

    it('todas las acciones bien -> COMPLETED con sus pasos', async () => {
      const run = await abrir();

      await runs.cerrar(prisma, run!.id, [
        { type: 'send_message', ok: true, durationMs: 12 },
      ]);

      const fila = await prisma.automationRun.findUniqueOrThrow({
        where: { id: run!.id },
      });
      expect(fila.status).toBe('COMPLETED');
      expect(JSON.stringify(fila.steps)).toContain('send_message');
      expect(fila.finishedAt).not.toBeNull();
    });

    it('una accion fallida hace que la ejecucion NO sea completada', async () => {
      // Marcarla verde porque "la mayoria funciono" es como se pierden los
      // fallos.
      const run = await abrir();

      await runs.cerrar(prisma, run!.id, [
        { type: 'send_message', ok: false, error: 'MetaError' },
        { type: 'change_stage', ok: true },
      ]);

      const fila = await prisma.automationRun.findUniqueOrThrow({
        where: { id: run!.id },
      });
      expect(fila.status).toBe('FAILED');
      expect(fila.lastError).toBe('MetaError');
    });

    it('el historial guarda el clasificador, no el mensaje del proveedor', async () => {
      // El error de Meta arrastra el telefono del cliente, y esto se guarda y
      // se muestra en pantalla.
      const run = await abrir();

      await runs.cerrar(prisma, run!.id, [
        { type: 'send_message', ok: false, error: 'MetaError' },
      ]);

      const fila = await prisma.automationRun.findUniqueOrThrow({
        where: { id: run!.id },
      });
      expect(JSON.stringify(fila)).not.toMatch(/\+\d{9,}/);
    });
  });

  describe('reintentos y cola de muertas', () => {
    it('reintenta mientras queden intentos', async () => {
      const run = await runs.abrir(prisma, {
        automationId: automatizacionId,
        automationVersion: 1,
        companyId: empresaId,
        triggerType: 'keyword',
        idempotencyKey: `retry-${Math.random()}`,
      });

      const veredicto = await runs.registrarFallo(
        prisma,
        run!.id,
        'TimeoutError',
      );

      expect(veredicto).toBe('reintentara');
      const fila = await prisma.automationRun.findUniqueOrThrow({
        where: { id: run!.id },
      });
      expect(fila.status).toBe('PENDING');
    });

    it('al agotar los intentos queda DEAD, no desaparece', async () => {
      // Es la dead-letter queue, pero en la base: sobrevive a un reinicio de
      // Redis y se puede consultar desde el propio CRM.
      const run = await runs.abrir(prisma, {
        automationId: automatizacionId,
        automationVersion: 1,
        companyId: empresaId,
        triggerType: 'keyword',
        idempotencyKey: `dead-${Math.random()}`,
      });

      let veredicto = 'reintentara';
      for (let i = 0; i < MAXIMOS_INTENTOS; i++) {
        veredicto = await runs.registrarFallo(prisma, run!.id, 'TimeoutError');
      }

      expect(veredicto).toBe('muerta');
      const fila = await prisma.automationRun.findUniqueOrThrow({
        where: { id: run!.id },
      });
      expect(fila.status).toBe('DEAD');
      expect(fila.finishedAt).not.toBeNull();
    });
  });

  describe('consulta del historial', () => {
    it('devuelve lo mas reciente primero y acotado a la empresa', async () => {
      const otra = await prisma.company.create({
        data: { name: 'E2E Automations Otra' },
      });

      const listado = await runs.listar(prisma, empresaId, { limit: 5 });

      expect(listado.length).toBeGreaterThan(0);
      expect(listado.length).toBeLessThanOrEqual(5);
      const ajenas = await runs.listar(prisma, otra.id);
      expect(ajenas).toHaveLength(0);

      await prisma.company.delete({ where: { id: otra.id } });
    });

    it('se puede filtrar por estado', async () => {
      const muertas = await runs.listar(prisma, empresaId, { status: 'DEAD' });

      expect(muertas.every((r) => r.status === 'DEAD')).toBe(true);
    });

    it('el limite tiene tope', async () => {
      const listado = await runs.listar(prisma, empresaId, { limit: 9999 });

      expect(listado.length).toBeLessThanOrEqual(200);
    });
  });
});
