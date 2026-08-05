import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskSuggestionsService } from '../src/modules/tasks/task-suggestions.service';

/**
 * TAREAS PROPUESTAS — contra la base real.
 *
 * Lo que importa aqui son dos cosas que un doble no demuestra: que una
 * propuesta NO es una tarea hasta que alguien la aprueba, y que dos
 * aprobaciones a la vez producen UNA tarea y no dos.
 *
 * Datos con prefijo E2E-SUG, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-SUG';

describe('Propuestas de tarea (e2e, base real)', () => {
  const servicio = new TaskSuggestionsService(
    prisma as unknown as PrismaService,
  );

  let empresaA: string;
  let empresaB: string;
  let asesor: string;
  let contactoA: string;
  let n = 0;

  const clave = () => `${PREFIJO}-${Date.now()}-${n++}`;

  async function propuesta(companyId = empresaA, extra = {}) {
    return servicio.proponer({
      companyId,
      source: 'flowbot',
      title: `${PREFIJO} Llamar al cliente`,
      reason: 'El cliente pidió que le llamaran',
      excerpt: '¿Me pueden llamar mañana?',
      idempotencyKey: clave(),
      contactId: companyId === empresaA ? contactoA : null,
      ...extra,
    });
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

    const u = await prisma.user.create({
      data: {
        companyId: empresaA,
        email: `${PREFIJO.toLowerCase()}-asesor@qa.invalid`,
        name: 'Quien decide',
        password: 'no-se-usa',
        role: 'AGENT',
      },
    });
    asesor = u.id;

    const c = await prisma.contact.create({
      data: {
        companyId: empresaA,
        phone: '+573009998877',
        name: `${PREFIJO} Cliente`,
      },
    });
    contactoA = c.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.taskSuggestion.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  // ── el valor seguro es el de fabrica ────────────────────────────

  it('sin configuración, la empresa EXIGE aprobación', async () => {
    // La ausencia de una decisión no puede significar «haz lo que quieras con
    // la lista de tareas de la gente».
    expect(await servicio.exigeAprobacion(empresaB)).toBe(true);
  });

  it('una empresa puede apagarlo, pero es una decisión explícita', async () => {
    await prisma.companyLeadSettings.create({
      data: { companyId: empresaB, requireTaskApproval: false },
    });

    expect(await servicio.exigeAprobacion(empresaB)).toBe(false);

    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: empresaB },
    });
  });

  // ── proponer ────────────────────────────────────────────────────

  it('proponer NO crea ninguna tarea', async () => {
    const antes = await prisma.task.count({ where: { companyId: empresaA } });

    const p = await propuesta();

    expect(p.status).toBe('PENDING');
    expect(await prisma.task.count({ where: { companyId: empresaA } })).toBe(
      antes,
    );
  });

  it('guarda el motivo y un extracto, no la conversación entera', async () => {
    const p = await propuesta();

    expect(p.reason).toBe('El cliente pidió que le llamaran');
    expect(p.excerpt).toBe('¿Me pueden llamar mañana?');
    expect(p.excerpt!.length).toBeLessThanOrEqual(280);
  });

  it('la MISMA regla sobre el MISMO mensaje no propone dos veces', async () => {
    // Un reintento del worker duplicaría la propuesta y el asesor vería lo
    // mismo dos veces sin saber cuál atender.
    const k = clave();
    const primera = await servicio.proponer({
      companyId: empresaA,
      source: 'flowbot',
      title: `${PREFIJO} Seguimiento`,
      idempotencyKey: k,
    });
    const segunda = await servicio.proponer({
      companyId: empresaA,
      source: 'flowbot',
      title: `${PREFIJO} Seguimiento`,
      idempotencyKey: k,
    });

    expect(segunda.id).toBe(primera.id);
    expect(
      await prisma.taskSuggestion.count({ where: { idempotencyKey: k } }),
    ).toBe(1);
  });

  // ── aprobar ─────────────────────────────────────────────────────

  it('SOLO la aprobación crea la tarea real', async () => {
    const p = await propuesta();

    const r = await servicio.aprobar(p.id, empresaA, asesor);

    expect(r.tarea).not.toBeNull();
    expect(r.tarea!.title).toBe(`${PREFIJO} Llamar al cliente`);
    expect(r.tarea!.contactId).toBe(contactoA);
    expect(r.tarea!.status).toBe('PENDING');

    const fila = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
    });
    expect(fila!.status).toBe('APPROVED');
    expect(fila!.decidedById).toBe(asesor);
    expect(fila!.createdTaskId).toBe(r.tarea!.id);
  });

  it('el asesor puede CORREGIR la propuesta antes de aceptarla', async () => {
    // Lo que el bot sugiere es un borrador, no una orden.
    const p = await propuesta();

    const r = await servicio.aprobar(p.id, empresaA, asesor, {
      title: 'Llamar el lunes a primera hora',
      priority: 'URGENT',
      assignedTo: asesor,
    });

    expect(r.tarea!.title).toBe('Llamar el lunes a primera hora');
    expect(r.tarea!.priority).toBe('URGENT');
    expect(r.tarea!.assignedTo).toBe(asesor);
  });

  /**
   * LA PRUEBA QUE IMPORTA.
   *
   * Dos personas mirando la misma bandeja pulsan «aprobar» a la vez. Si de ahi
   * salen dos tareas, el equipo hace el trabajo dos veces y culpa al CRM.
   */
  it('dos aprobaciones simultáneas crean UNA sola tarea', async () => {
    const p = await propuesta();

    const resultados = await Promise.allSettled([
      servicio.aprobar(p.id, empresaA, asesor),
      servicio.aprobar(p.id, empresaA, asesor),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidas.length).toBeGreaterThanOrEqual(1);

    // Sea cual sea el reparto, en la base hay UNA tarea nacida de esta
    // propuesta.
    const conEstaPropuesta = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
      select: { createdTaskId: true, status: true },
    });
    expect(conEstaPropuesta!.status).toBe('APPROVED');
    expect(conEstaPropuesta!.createdTaskId).not.toBeNull();

    const tareas = await prisma.task.count({
      where: { suggestion: { id: p.id } },
    });
    expect(tareas).toBe(1);
  });

  it('aprobar una propuesta ya aprobada devuelve la MISMA tarea, no otra', async () => {
    const p = await propuesta();
    const primera = await servicio.aprobar(p.id, empresaA, asesor);

    const segunda = await servicio.aprobar(p.id, empresaA, asesor);

    expect(segunda.yaEstaba).toBe(true);
    expect(segunda.tarea!.id).toBe(primera.tarea!.id);
  });

  // ── rechazar, caducar, cancelar ─────────────────────────────────

  it('rechazar NO crea ninguna tarea', async () => {
    const p = await propuesta();
    const antes = await prisma.task.count({ where: { companyId: empresaA } });

    await servicio.rechazar(p.id, empresaA, asesor, 'no aplica');

    expect(await prisma.task.count({ where: { companyId: empresaA } })).toBe(
      antes,
    );
    const fila = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
    });
    expect(fila!.status).toBe('REJECTED');
    expect(fila!.decisionNote).toBe('no aplica');
  });

  it('una propuesta rechazada ya no se puede aprobar', async () => {
    const p = await propuesta();
    await servicio.rechazar(p.id, empresaA, asesor);

    await expect(servicio.aprobar(p.id, empresaA, asesor)).rejects.toThrow(
      /rechazada/i,
    );
  });

  it('las propuestas viejas caducan en vez de quedarse pendientes para siempre', async () => {
    const p = await propuesta();
    await prisma.taskSuggestion.update({
      where: { id: p.id },
      data: { createdAt: new Date('2020-01-01') },
    });

    const r = await servicio.caducarVencidas(empresaA, new Date('2021-01-01'));

    expect(r.caducadas).toBeGreaterThanOrEqual(1);
    const fila = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
    });
    expect(fila!.status).toBe('EXPIRED');
  });

  it('caducar NO toca las que ya fueron decididas', async () => {
    const p = await propuesta();
    await servicio.aprobar(p.id, empresaA, asesor);
    await prisma.taskSuggestion.update({
      where: { id: p.id },
      data: { createdAt: new Date('2020-01-01') },
    });

    await servicio.caducarVencidas(empresaA, new Date('2021-01-01'));

    const fila = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
    });
    expect(fila!.status).toBe('APPROVED');
  });

  // ── aislamiento multiempresa ────────────────────────────────────

  it('NO se puede aprobar la propuesta de otra empresa', async () => {
    const p = await propuesta();

    await expect(servicio.aprobar(p.id, empresaB, asesor)).rejects.toThrow();

    const fila = await prisma.taskSuggestion.findUnique({
      where: { id: p.id },
    });
    expect(fila!.status).toBe('PENDING');
  });

  it('NO se puede rechazar la propuesta de otra empresa', async () => {
    const p = await propuesta();

    await expect(servicio.rechazar(p.id, empresaB, asesor)).rejects.toThrow();
  });

  it('el listado solo trae las de la empresa que pregunta', async () => {
    const mia = await propuesta(empresaA);
    const ajena = await servicio.proponer({
      companyId: empresaB,
      source: 'rule',
      title: `${PREFIJO} de la otra empresa`,
      idempotencyKey: clave(),
    });

    const lista = await servicio.listar(empresaA, { estado: 'PENDING' });
    const ids = lista.map((s) => s.id);

    expect(ids).toContain(mia.id);
    expect(ids).not.toContain(ajena.id);
  });
});
