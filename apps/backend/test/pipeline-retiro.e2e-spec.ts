import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineService } from '../src/modules/pipeline/pipeline.service';
import { PipelineRetiroService } from '../src/modules/pipeline/pipeline-retiro.service';

/**
 * RETIRAR UN EMBUDO NO PUEDE PERDER OPORTUNIDADES — contra la base real.
 *
 * Lo que se comprueba es que las filas siguen ahi y apuntando a donde toca.
 * Un doble diria que si a cualquier cosa; solo la base demuestra que ninguna
 * oportunidad se quedo apuntando a una etapa que ya no existe.
 *
 * Datos con prefijo E2E-RET, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-RET';

describe('Retiro seguro de embudos (e2e, base real)', () => {
  const pipelines = new PipelineService(prisma as unknown as PrismaService);
  const retiro = new PipelineRetiroService(prisma as unknown as PrismaService);

  let empresaA: string;
  let empresaB: string;
  let n = 0;

  async function embudo(
    companyId: string,
    opciones: { isDefault?: boolean } = {},
  ) {
    const p = await prisma.pipeline.create({
      data: {
        companyId,
        name: `${PREFIJO}-${n++}`,
        order: n,
        isDefault: opciones.isDefault ?? false,
      },
    });
    const etapa = await prisma.pipelineStage.create({
      data: { pipelineId: p.id, name: 'Entrada', order: 0, isInitial: true },
    });
    return { pipeline: p, etapa };
  }

  async function oportunidad(
    companyId: string,
    pipelineId: string,
    stageId: string,
  ) {
    const contacto = await prisma.contact.create({
      data: {
        companyId,
        phone: `+5732222${String(1000 + n++).slice(-4)}`,
        name: `${PREFIJO} contacto`,
      },
    });
    return prisma.lead.create({
      data: {
        companyId,
        contactId: contacto.id,
        pipelineId,
        stageId,
        title: `${PREFIJO} venta`,
      },
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
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  // ── el resumen dice la verdad ───────────────────────────────────

  it('el resumen cuenta las oportunidades y explica por qué no se puede eliminar', async () => {
    const { pipeline, etapa } = await embudo(empresaA);
    await oportunidad(empresaA, pipeline.id, etapa.id);
    await oportunidad(empresaA, pipeline.id, etapa.id);

    const r = await retiro.resumen(pipeline.id, empresaA);

    expect(r.oportunidades.total).toBe(2);
    expect(r.oportunidades.abiertas).toBe(2);
    expect(r.puede.eliminar).toBe(false);
    expect(r.puede.requiereTraslado).toBe(true);
    expect(r.motivo).toMatch(/2 oportunidades/i);
    expect(r.porEtapa.find((e) => e.stageId === etapa.id)?.total).toBe(2);
  });

  it('un embudo vacío se declara eliminable', async () => {
    const { pipeline } = await embudo(empresaA);

    const r = await retiro.resumen(pipeline.id, empresaA);

    expect(r.oportunidades.total).toBe(0);
    expect(r.puede.eliminar).toBe(true);
    expect(r.motivo).toBeNull();
  });

  it('el resumen de un embudo de OTRA empresa no se puede consultar', async () => {
    const { pipeline } = await embudo(empresaA);
    await expect(retiro.resumen(pipeline.id, empresaB)).rejects.toThrow();
  });

  // ── eliminar ────────────────────────────────────────────────────

  it('NO se puede eliminar un embudo con oportunidades, y ninguna se pierde', async () => {
    const { pipeline, etapa } = await embudo(empresaA);
    const lead = await oportunidad(empresaA, pipeline.id, etapa.id);

    await expect(pipelines.remove(pipeline.id, empresaA)).rejects.toThrow(
      /oportunidad/i,
    );

    expect(await prisma.lead.count({ where: { id: lead.id } })).toBe(1);
    expect(await prisma.pipeline.count({ where: { id: pipeline.id } })).toBe(1);
  });

  it('un embudo vacío sí se elimina, con sus etapas', async () => {
    const { pipeline, etapa } = await embudo(empresaA);

    await pipelines.remove(pipeline.id, empresaA);

    expect(await prisma.pipeline.count({ where: { id: pipeline.id } })).toBe(0);
    expect(await prisma.pipelineStage.count({ where: { id: etapa.id } })).toBe(
      0,
    );
  });

  // ── trasladar ───────────────────────────────────────────────────

  it('trasladar mueve TODAS las oportunidades y no borra ninguna', async () => {
    const origen = await embudo(empresaA);
    const destino = await embudo(empresaA);
    const l1 = await oportunidad(empresaA, origen.pipeline.id, origen.etapa.id);
    const l2 = await oportunidad(empresaA, origen.pipeline.id, origen.etapa.id);

    const r = await retiro.trasladarOportunidades(
      origen.pipeline.id,
      empresaA,
      { pipelineId: destino.pipeline.id, stageId: destino.etapa.id },
    );

    expect(r.trasladadas).toBe(2);

    for (const id of [l1.id, l2.id]) {
      const fila = await prisma.lead.findUnique({ where: { id } });
      expect(fila).not.toBeNull();
      expect(fila!.pipelineId).toBe(destino.pipeline.id);
      expect(fila!.stageId).toBe(destino.etapa.id);
    }

    // Y ahora el de origen SÍ se puede eliminar.
    const resumen = await retiro.resumen(origen.pipeline.id, empresaA);
    expect(resumen.puede.eliminar).toBe(true);
    await pipelines.remove(origen.pipeline.id, empresaA);
  });

  it('no se traslada a una etapa que NO pertenece al embudo de destino', async () => {
    const origen = await embudo(empresaA);
    const destino = await embudo(empresaA);
    const otro = await embudo(empresaA);
    const lead = await oportunidad(
      empresaA,
      origen.pipeline.id,
      origen.etapa.id,
    );

    await expect(
      retiro.trasladarOportunidades(origen.pipeline.id, empresaA, {
        pipelineId: destino.pipeline.id,
        stageId: otro.etapa.id, // etapa de un tercer embudo
      }),
    ).rejects.toThrow();

    // La oportunidad no se movió a ninguna parte.
    const fila = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(fila!.pipelineId).toBe(origen.pipeline.id);
  });

  it('no se traslada a un embudo de OTRA empresa', async () => {
    const origen = await embudo(empresaA);
    const ajeno = await embudo(empresaB);
    const lead = await oportunidad(
      empresaA,
      origen.pipeline.id,
      origen.etapa.id,
    );

    await expect(
      retiro.trasladarOportunidades(origen.pipeline.id, empresaA, {
        pipelineId: ajeno.pipeline.id,
        stageId: ajeno.etapa.id,
      }),
    ).rejects.toThrow();

    const fila = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(fila!.pipelineId).toBe(origen.pipeline.id);
  });

  it('no se traslada a un embudo archivado', async () => {
    const origen = await embudo(empresaA);
    const destino = await embudo(empresaA);
    await oportunidad(empresaA, origen.pipeline.id, origen.etapa.id);
    await retiro.archivar(destino.pipeline.id, empresaA);

    await expect(
      retiro.trasladarOportunidades(origen.pipeline.id, empresaA, {
        pipelineId: destino.pipeline.id,
        stageId: destino.etapa.id,
      }),
    ).rejects.toThrow(/archivado/i);
  });

  it('el origen y el destino no pueden ser el mismo', async () => {
    const { pipeline, etapa } = await embudo(empresaA);

    await expect(
      retiro.trasladarOportunidades(pipeline.id, empresaA, {
        pipelineId: pipeline.id,
        stageId: etapa.id,
      }),
    ).rejects.toThrow(/distinto/i);
  });

  // ── archivar y restaurar ────────────────────────────────────────

  it('archivar CONSERVA las oportunidades y dice cuántas son', async () => {
    const { pipeline, etapa } = await embudo(empresaA);
    const lead = await oportunidad(empresaA, pipeline.id, etapa.id);

    const r = await retiro.archivar(pipeline.id, empresaA);

    expect(r.archivado).toBe(true);
    expect(r.oportunidades).toBe(1);

    const fila = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(fila).not.toBeNull();
    expect(fila!.pipelineId).toBe(pipeline.id);
  });

  it('un embudo archivado desaparece del listado normal y vuelve al restaurarlo', async () => {
    const { pipeline } = await embudo(empresaA);
    await retiro.archivar(pipeline.id, empresaA);

    const normales = await pipelines.findAll(empresaA);
    expect(normales.map((p) => p.id)).not.toContain(pipeline.id);

    const conArchivados = await pipelines.findAll(empresaA, true);
    expect(conArchivados.map((p) => p.id)).toContain(pipeline.id);

    await retiro.restaurar(pipeline.id, empresaA);
    const despues = await pipelines.findAll(empresaA);
    expect(despues.map((p) => p.id)).toContain(pipeline.id);
  });

  it('archivar dos veces es idempotente', async () => {
    const { pipeline } = await embudo(empresaA);

    expect((await retiro.archivar(pipeline.id, empresaA)).archivado).toBe(true);
    expect((await retiro.archivar(pipeline.id, empresaA)).archivado).toBe(
      false,
    );
  });

  it('NO se puede archivar el embudo predeterminado', async () => {
    const { pipeline } = await embudo(empresaB, { isDefault: true });

    await expect(retiro.archivar(pipeline.id, empresaB)).rejects.toThrow(
      /predeterminado/i,
    );
  });

  it('no se puede archivar el embudo de OTRA empresa', async () => {
    const { pipeline } = await embudo(empresaA);

    await expect(retiro.archivar(pipeline.id, empresaB)).rejects.toThrow();

    const fila = await prisma.pipeline.findUnique({
      where: { id: pipeline.id },
    });
    expect(fila!.isArchived).toBe(false);
  });

  // ── reordenar ───────────────────────────────────────────────────

  it('reordenar aplica el orden pedido', async () => {
    const a = await embudo(empresaA);
    const b = await embudo(empresaA);

    await retiro.reordenar(empresaA, [
      { id: a.pipeline.id, order: 20 },
      { id: b.pipeline.id, order: 10 },
    ]);

    const filas = await prisma.pipeline.findMany({
      where: { id: { in: [a.pipeline.id, b.pipeline.id] } },
      select: { id: true, order: true },
    });
    expect(filas.find((f) => f.id === a.pipeline.id)!.order).toBe(20);
    expect(filas.find((f) => f.id === b.pipeline.id)!.order).toBe(10);
  });

  it('reordenar rechaza la lista entera si un id es de otra empresa', async () => {
    const mio = await embudo(empresaA);
    const ajeno = await embudo(empresaB);
    const ordenPrevio = ajeno.pipeline.order;

    await expect(
      retiro.reordenar(empresaA, [
        { id: mio.pipeline.id, order: 5 },
        { id: ajeno.pipeline.id, order: 99 },
      ]),
    ).rejects.toThrow(/no pertenecen/i);

    // Nada se escribió, ni siquiera el que sí era suyo.
    const fila = await prisma.pipeline.findUnique({
      where: { id: ajeno.pipeline.id },
    });
    expect(fila!.order).toBe(ordenPrevio);
  });
});
