import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsService } from '../src/modules/contacts/contacts.service';

/**
 * ARCHIVAR UN CONTACTO NO PUEDE PERDER NADA — contra la base real.
 *
 * Con dobles no se ve lo que importa: que las conversaciones, los mensajes y
 * las oportunidades SIGUEN AHÍ después de archivar. Un mock devuelve lo que se
 * le diga; solo la base de verdad demuestra que nada cayó por una cascada.
 *
 * Datos con prefijo E2E-ARCH, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-ARCH';

describe('Archivado seguro de contactos (e2e, base real)', () => {
  const servicio = new ContactsService(prisma as unknown as PrismaService);

  let empresaA: string;
  let empresaB: string;
  let n = 0;

  const telefono = () => `+5730000${String(1000 + n++).slice(-4)}`;

  async function contactoConHistorial(companyId: string) {
    const contacto = await prisma.contact.create({
      data: { companyId, phone: telefono(), name: `${PREFIJO} Cliente` },
    });

    const conversacion = await prisma.conversation.create({
      data: { companyId, contactId: contacto.id, status: 'OPEN' },
    });

    await prisma.message.create({
      data: {
        conversationId: conversacion.id,
        direction: 'INBOUND',
        body: 'Quiero información de precios',
        status: 'DELIVERED',
      },
    });

    return { contacto, conversacion };
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
    await prisma.message.deleteMany({
      where: { conversation: { companyId: { in: empresas } } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  it('archivar CONSERVA la conversación y sus mensajes', async () => {
    const { contacto, conversacion } = await contactoConHistorial(empresaA);

    await servicio.remove(contacto.id, empresaA, 'ya no es cliente');

    // Lo que se acordó en esa conversación no deja de existir porque alguien
    // limpie la lista de contactos.
    expect(
      await prisma.conversation.count({ where: { id: conversacion.id } }),
    ).toBe(1);
    expect(
      await prisma.message.count({
        where: { conversationId: conversacion.id },
      }),
    ).toBe(1);
    expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(1);
  });

  it('archivar CONSERVA las oportunidades', async () => {
    const { contacto } = await contactoConHistorial(empresaA);
    const pipeline = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO}-pipe`, order: 0 },
    });
    const etapa = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: 'Entrada',
        order: 0,
        isInitial: true,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: empresaA,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: etapa.id,
        title: `${PREFIJO} oportunidad`,
      },
    });

    await servicio.remove(contacto.id, empresaA);

    expect(await prisma.lead.count({ where: { id: lead.id } })).toBe(1);

    await prisma.lead.deleteMany({ where: { id: lead.id } });
    await prisma.pipelineStage.deleteMany({ where: { id: etapa.id } });
    await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
  });

  it('deja la marca de cuándo y por qué', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    await servicio.remove(
      contacto.id,
      empresaA,
      'pidió que no le escribiéramos',
    );

    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { archivedAt: true, archivedReason: true },
    });

    expect(fila?.archivedAt).toBeInstanceOf(Date);
    expect(fila?.archivedReason).toBe('pidió que no le escribiéramos');
  });

  it('archivar dos veces NO pisa la fecha ni el motivo originales', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    await servicio.remove(contacto.id, empresaA, 'el primero');
    const primera = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { archivedAt: true, archivedReason: true },
    });

    const segunda = await servicio.remove(contacto.id, empresaA, 'el segundo');

    expect(segunda.archivado).toBe(false);
    const despues = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { archivedAt: true, archivedReason: true },
    });
    expect(despues?.archivedReason).toBe('el primero');
    expect(despues?.archivedAt?.getTime()).toBe(primera?.archivedAt?.getTime());
  });

  it('restaurar lo devuelve a las listas', async () => {
    const { contacto } = await contactoConHistorial(empresaA);
    await servicio.remove(contacto.id, empresaA, 'un motivo');

    const r = await servicio.restore(contacto.id, empresaA);

    expect(r.restaurado).toBe(true);
    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { archivedAt: true, archivedReason: true },
    });
    expect(fila?.archivedAt).toBeNull();
    expect(fila?.archivedReason).toBeNull();
  });

  it('el listado no los trae, y con `includeArchived` sí', async () => {
    const { contacto } = await contactoConHistorial(empresaA);
    await servicio.remove(contacto.id, empresaA);

    const normales = await servicio.findAll(empresaA);
    expect(normales.map((c) => c.id)).not.toContain(contacto.id);

    const conArchivados = await servicio.findAll(empresaA, {
      includeArchived: true,
    });
    expect(conArchivados.map((c) => c.id)).toContain(contacto.id);
  });

  it('no se puede archivar el contacto de OTRA empresa', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    await expect(servicio.remove(contacto.id, empresaB)).rejects.toThrow();

    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { archivedAt: true },
    });
    expect(fila?.archivedAt).toBeNull();
  });

  it('archivar es distinto de bloquear: no marca `isBlocked`', async () => {
    // Archivar es «ya no está activo»; bloquear es una decisión sobre la
    // relación. Confundirlos dejaría de recibir mensajes de alguien a quien
    // solo se quería quitar de la lista.
    const { contacto } = await contactoConHistorial(empresaA);

    await servicio.remove(contacto.id, empresaA);

    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { isBlocked: true },
    });
    expect(fila?.isBlocked).toBe(false);
  });
});
