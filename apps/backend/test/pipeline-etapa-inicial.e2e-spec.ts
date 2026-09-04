import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineService } from '../src/modules/pipeline/pipeline.service';

/**
 * LA ETAPA DE ENTRADA — contra la base real.
 *
 * Es la etapa donde cae el cliente que acaba de escribir por primera vez. Que
 * haya exactamente una no es un detalle: con dos marcadas, en cuál aparece el
 * lead depende del orden que devuelva la consulta, y eso no se puede depurar
 * mirando la pantalla. Con ninguna, cae en «la primera por orden», que puede
 * ser perfectamente «Ganado».
 *
 * Se prueba contra la base porque la exclusividad la sostiene una transacción:
 * un doble diría que sí sin ejecutarla.
 *
 * Datos con prefijo E2E-INI, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-INI';

describe('Etapa inicial de un embudo (e2e, base real)', () => {
  const servicio = new PipelineService(prisma as unknown as PrismaService);

  let empresa: string;
  let n = 0;

  async function embudoConEtapas() {
    const pipeline = await prisma.pipeline.create({
      data: { companyId: empresa, name: `${PREFIJO}-${n++}`, order: 0 },
    });
    const entrada = await servicio.createStage(pipeline.id, empresa, {
      name: 'Primer contacto',
      isInitial: true,
    });
    const segunda = await servicio.createStage(pipeline.id, empresa, {
      name: 'Cotizado',
    });
    return { pipeline, entrada, segunda };
  }

  beforeAll(async () => {
    const c = await prisma.company.create({
      data: { name: `${PREFIJO}-empresa`, status: 'ACTIVE' },
    });
    empresa = c.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { companyId: empresa } });
    await prisma.contact.deleteMany({ where: { companyId: empresa } });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: empresa } },
    });
    await prisma.pipeline.deleteMany({ where: { companyId: empresa } });
    await prisma.company.deleteMany({ where: { id: empresa } });
    await prisma.$disconnect();
  });

  it('la etapa de entrada NO tiene que llamarse «Nuevo lead»', async () => {
    // Ese nombre es una costumbre, no una regla: una empresa que llame a la
    // suya «Primer contacto» tiene el mismo derecho a que sus leads caigan
    // donde toca.
    const { entrada } = await embudoConEtapas();

    expect(entrada.name).toBe('Primer contacto');
    expect(entrada.isInitial).toBe(true);
  });

  it('marcar otra como inicial DESMARCA la anterior', async () => {
    const { pipeline, entrada, segunda } = await embudoConEtapas();

    await servicio.updateStage(pipeline.id, segunda.id, empresa, {
      isInitial: true,
    });

    const iniciales = await prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id, isInitial: true },
      select: { id: true },
    });

    expect(iniciales.map((e) => e.id)).toEqual([segunda.id]);
    const anterior = await prisma.pipelineStage.findUnique({
      where: { id: entrada.id },
      select: { isInitial: true },
    });
    expect(anterior?.isInitial).toBe(false);
  });

  it('crear una etapa inicial nueva también desmarca la anterior', async () => {
    const { pipeline, entrada } = await embudoConEtapas();

    const nueva = await servicio.createStage(pipeline.id, empresa, {
      name: 'Entrada nueva',
      isInitial: true,
    });

    const iniciales = await prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id, isInitial: true },
      select: { id: true },
    });
    expect(iniciales.map((e) => e.id)).toEqual([nueva.id]);
    expect(iniciales.map((e) => e.id)).not.toContain(entrada.id);
  });

  it('NO se puede dejar un embudo sin etapa de entrada', async () => {
    // Desmarcarla a secas dejaría al siguiente cliente cayendo en «la primera
    // por orden», que es una regla de reserva y no la decisión de nadie.
    const { pipeline, entrada } = await embudoConEtapas();

    await expect(
      servicio.updateStage(pipeline.id, entrada.id, empresa, {
        isInitial: false,
      }),
    ).rejects.toThrow(/etapa de entrada/i);
  });

  it('NO se puede borrar la etapa de entrada mientras haya otras', async () => {
    const { pipeline, entrada } = await embudoConEtapas();

    await expect(
      servicio.removeStage(pipeline.id, entrada.id, empresa),
    ).rejects.toThrow(/inicial/i);
  });

  it('tampoco se puede borrar una etapa que tenga oportunidades', async () => {
    const { pipeline, segunda } = await embudoConEtapas();
    const contacto = await prisma.contact.create({
      data: { companyId: empresa, phone: `+57300111${n++}222` },
    });
    await prisma.lead.create({
      data: {
        companyId: empresa,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: segunda.id,
        title: `${PREFIJO} oportunidad`,
      },
    });

    await expect(
      servicio.removeStage(pipeline.id, segunda.id, empresa),
    ).rejects.toThrow(/oportunidad/i);
  });

  it('cada embudo tiene su propia etapa de entrada', async () => {
    // Marcar la de uno no puede tocar la del otro: son tableros distintos.
    const a = await embudoConEtapas();
    const b = await embudoConEtapas();

    await servicio.updateStage(a.pipeline.id, a.segunda.id, empresa, {
      isInitial: true,
    });

    const inicialDeB = await prisma.pipelineStage.findFirst({
      where: { pipelineId: b.pipeline.id, isInitial: true },
      select: { id: true },
    });
    expect(inicialDeB?.id).toBe(b.entrada.id);
  });

  it('no se puede tocar el embudo de OTRA empresa', async () => {
    const { pipeline, segunda } = await embudoConEtapas();

    await expect(
      servicio.updateStage(pipeline.id, segunda.id, 'otra-empresa', {
        isInitial: true,
      }),
    ).rejects.toThrow();
  });
});
