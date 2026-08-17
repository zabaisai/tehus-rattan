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
/** Sufijo por ejecucion, para las claves unicas globales (correo de usuario). */
const corrida = process.pid.toString(36);

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
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    // Los alias primero: `mergedInto` es `Restrict` y el borrado en bloque
    // fallaria mientras una fila siga apuntando a otra.
    await prisma.contact.deleteMany({
      where: { companyId: { in: empresas }, mergedIntoId: { not: null } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    // Embudos, etapas y usuarios se crean dentro de algunas pruebas. Se
    // limpian TAMBIEN aqui y no solo en linea: si una prueba falla a mitad, su
    // limpieza no llega a ejecutarse y la corrida siguiente se encuentra la
    // empresa imposible de borrar por clave foranea.
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
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

  /**
   * EL LISTADO DE LA PANTALLA (incremento 3.z, mockup 02).
   *
   * Va en este archivo y no en uno nuevo porque prueba el MISMO motor sobre
   * la MISMA base: archivar, restaurar y listar son la misma historia contada
   * desde tres sitios, y separarlas invitaría a que una cambiara sin la otra.
   */
  describe('listado de la pantalla de Contactos', () => {
    it('activos excluye archivados; papelera trae SOLO archivados', async () => {
      const { contacto: activo } = await contactoConHistorial(empresaA);
      const { contacto: archivado } = await contactoConHistorial(empresaA);
      await servicio.remove(archivado.id, empresaA, 'para la papelera');

      const activos = await servicio.listado(empresaA, { vista: 'activos' });
      const papelera = await servicio.listado(empresaA, { vista: 'papelera' });

      expect(activos.items.map((c) => c.id)).toContain(activo.id);
      expect(activos.items.map((c) => c.id)).not.toContain(archivado.id);
      expect(papelera.items.map((c) => c.id)).toContain(archivado.id);
      expect(papelera.items.map((c) => c.id)).not.toContain(activo.id);
    });

    it('los contadores son del TOTAL, no de la página que se pidió', async () => {
      // Es la diferencia entre «12 archivados» y «los 5 que caben en pantalla».
      // Derivarlos de la página daría un número que cambia al pasar de hoja.
      const { contacto } = await contactoConHistorial(empresaA);
      await servicio.remove(contacto.id, empresaA);

      const pagina = await servicio.listado(empresaA, {
        vista: 'activos',
        limit: '1',
      });

      expect(pagina.items).toHaveLength(1);
      expect(pagina.contadores.activos).toBeGreaterThan(1);
      expect(pagina.contadores.archivados).toBeGreaterThanOrEqual(1);
      // El total es el de la VISTA pedida, no el de la página.
      expect(pagina.total).toBe(pagina.contadores.activos);
    });

    it('la búsqueda la resuelve el SERVIDOR, no la página ya descargada', async () => {
      // El defecto que corrige: la pantalla filtraba en memoria lo que ya se
      // había traído, así que un contacto fuera de esa tanda era invisible
      // por mucho que se escribiera su nombre entero.
      const raro = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: telefono(),
          name: `${PREFIJO} Wenceslao Zubizarreta`,
        },
      });

      const encontrado = await servicio.listado(empresaA, {
        vista: 'activos',
        search: 'Zubizarreta',
        limit: '5',
      });

      expect(encontrado.items.map((c) => c.id)).toContain(raro.id);
      expect(encontrado.total).toBe(1);
    });

    it('busca por teléfono y por correo, y también dentro de la papelera', async () => {
      const contacto = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: telefono(),
          name: `${PREFIJO} Buscable`,
          email: 'buscable@example.invalid',
        },
      });
      await servicio.remove(contacto.id, empresaA);

      const porCorreo = await servicio.listado(empresaA, {
        vista: 'papelera',
        search: 'buscable@example.invalid',
      });
      const porTelefono = await servicio.listado(empresaA, {
        vista: 'papelera',
        search: contacto.phone,
      });

      expect(porCorreo.items.map((c) => c.id)).toContain(contacto.id);
      expect(porTelefono.items.map((c) => c.id)).toContain(contacto.id);
    });

    it('resuelve asesor, etapa, conversación y tareas pendientes en una sola llamada', async () => {
      const { contacto, conversacion } = await contactoConHistorial(empresaA);
      const asesor = await prisma.user.create({
        data: {
          companyId: empresaA,
          // `email` es unico GLOBAL, no por empresa: un sufijo por corrida
          // evita que una ejecucion anterior interrumpida bloquee la
          // siguiente con un choque de clave.
          email: `asesor-${corrida}-${n++}@example.invalid`,
          password: 'no-es-una-credencial-real',
          name: `${PREFIJO} Asesora`,
          role: 'AGENT',
        },
      });
      const pipeline = await prisma.pipeline.create({
        data: { companyId: empresaA, name: `${PREFIJO}-pipe-l`, order: 0 },
      });
      const etapa = await prisma.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          name: 'Negociación',
          order: 0,
          color: '#131C4A',
        },
      });
      const lead = await prisma.lead.create({
        data: {
          companyId: empresaA,
          contactId: contacto.id,
          pipelineId: pipeline.id,
          stageId: etapa.id,
          // El campo se llama `assignedTo`; `agent` es solo la relacion.
          assignedTo: asesor.id,
          title: `${PREFIJO} oportunidad viva`,
          status: 'OPEN',
        },
      });
      const tarea = await prisma.task.create({
        data: {
          companyId: empresaA,
          contactId: contacto.id,
          title: `${PREFIJO} llamar`,
          status: 'PENDING',
        },
      });

      const fila = (
        await servicio.listado(empresaA, { vista: 'activos' })
      ).items.find((c) => c.id === contacto.id);

      expect(fila?.asesor).toEqual({ id: asesor.id, nombre: asesor.name });
      expect(fila?.etapa?.nombre).toBe('Negociación');
      expect(fila?.etapa?.color).toBe('#131C4A');
      expect(fila?.conversacionId).toBe(conversacion.id);
      expect(fila?.tareasPendientes).toBe(1);

      await prisma.task.deleteMany({ where: { id: tarea.id } });
      await prisma.lead.deleteMany({ where: { id: lead.id } });
      await prisma.pipelineStage.deleteMany({ where: { id: etapa.id } });
      await prisma.pipeline.deleteMany({ where: { id: pipeline.id } });
      await prisma.user.deleteMany({ where: { id: asesor.id } });
    });

    it('CERO FUGAS: el contacto de otra empresa no sale ni buscándolo por su nombre exacto', async () => {
      const ajeno = await prisma.contact.create({
        data: {
          companyId: empresaB,
          phone: telefono(),
          name: `${PREFIJO} Secreto de la empresa B`,
        },
      });

      const activos = await servicio.listado(empresaA, { vista: 'activos' });
      const buscado = await servicio.listado(empresaA, {
        vista: 'activos',
        search: 'Secreto de la empresa B',
      });
      const papelera = await servicio.listado(empresaA, { vista: 'papelera' });

      expect(activos.items.map((c) => c.id)).not.toContain(ajeno.id);
      expect(buscado.items).toHaveLength(0);
      expect(buscado.total).toBe(0);
      expect(papelera.items.map((c) => c.id)).not.toContain(ajeno.id);
    });

    it('un alias de fusión no aparece en activos ni en papelera', async () => {
      const principal = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: telefono(),
          name: `${PREFIJO} Principal`,
        },
      });
      const absorbido = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: telefono(),
          name: `${PREFIJO} Absorbido`,
          mergedIntoId: principal.id,
          mergedAt: new Date(),
          archivedAt: new Date(),
        },
      });

      const activos = await servicio.listado(empresaA, { vista: 'activos' });
      const papelera = await servicio.listado(empresaA, { vista: 'papelera' });

      expect(activos.items.map((c) => c.id)).not.toContain(absorbido.id);
      expect(papelera.items.map((c) => c.id)).not.toContain(absorbido.id);
      expect(activos.items.map((c) => c.id)).toContain(principal.id);

      // El alias se retira AQUI: `mergedInto` es `Restrict`, asi que el
      // borrado en bloque del `afterAll` fallaria mientras esta fila apunte
      // al principal.
      await prisma.contact.deleteMany({ where: { id: absorbido.id } });
    });

    it('archivar y restaurar devuelven EL MISMO id con sus relaciones intactas', async () => {
      const { contacto, conversacion } = await contactoConHistorial(empresaA);

      await servicio.remove(contacto.id, empresaA, 'se va a la papelera');
      const enPapelera = (
        await servicio.listado(empresaA, { vista: 'papelera' })
      ).items.find((c) => c.id === contacto.id);
      expect(enPapelera?.motivoDeArchivo).toBe('se va a la papelera');
      expect(enPapelera?.conversacionId).toBe(conversacion.id);

      await servicio.restore(contacto.id, empresaA);
      const devuelto = (
        await servicio.listado(empresaA, { vista: 'activos' })
      ).items.find((c) => c.id === contacto.id);

      // El mismo id: restaurar no crea un contacto nuevo.
      expect(devuelto?.id).toBe(contacto.id);
      expect(devuelto?.archivadoEn).toBeNull();
      expect(devuelto?.conversacionId).toBe(conversacion.id);
      // Y sigue habiendo UNA sola fila con ese teléfono en la empresa.
      expect(
        await prisma.contact.count({
          where: { companyId: empresaA, phone: contacto.phone },
        }),
      ).toBe(1);
    });

    it('restaurar dos veces no duplica nada y avisa de que ya estaba', async () => {
      const { contacto } = await contactoConHistorial(empresaA);
      await servicio.remove(contacto.id, empresaA);

      const primera = await servicio.restore(contacto.id, empresaA);
      const segunda = await servicio.restore(contacto.id, empresaA);

      expect(primera.restaurado).toBe(true);
      expect(segunda.restaurado).toBe(false);
      expect(segunda.yaEstaba).toBe(true);
      expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(
        1,
      );
    });
  });
});
