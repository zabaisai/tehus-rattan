import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsService } from '../src/modules/contacts/contacts.service';
import {
  CONFIRMACION_REQUERIDA,
  ContactsEliminacionService,
} from '../src/modules/contacts/contacts-eliminacion.service';

/**
 * ELIMINACION DEFINITIVA DE CONTACTOS — contra la base real.
 *
 * Aqui lo unico que importa es lo que queda en las tablas despues, y eso un
 * doble no lo puede demostrar: diria que si a cualquier cosa. Lo que se
 * comprueba es que la historia comercial sobrevive a una supresion de datos
 * personales, y que un contacto vacio si se va del todo.
 *
 * Datos con prefijo E2E-ELIM, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-ELIM';

describe('Eliminación definitiva de contactos (e2e, base real)', () => {
  const contactos = new ContactsService(prisma as unknown as PrismaService);
  const eliminacion = new ContactsEliminacionService(
    prisma as unknown as PrismaService,
  );

  let empresaA: string;
  let empresaB: string;
  let n = 0;

  const telefono = () => `+5731111${String(1000 + n++).slice(-4)}`;

  async function contactoVacio(companyId: string) {
    return prisma.contact.create({
      data: { companyId, phone: telefono(), name: `${PREFIJO} Vacío` },
    });
  }

  async function contactoConHistorial(companyId: string) {
    const contacto = await prisma.contact.create({
      data: {
        companyId,
        phone: telefono(),
        name: `${PREFIJO} Con historia`,
        email: 'cliente@example.com',
        tags: ['vip'],
      },
    });
    const conversacion = await prisma.conversation.create({
      data: { companyId, contactId: contacto.id, status: 'OPEN' },
    });
    const mensaje = await prisma.message.create({
      data: {
        conversationId: conversacion.id,
        direction: 'INBOUND',
        body: 'Acordamos 4.500.000 por el lote',
        status: 'DELIVERED',
      },
    });
    return { contacto, conversacion, mensaje };
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
    await prisma.customFieldValue.deleteMany({
      where: { contact: { companyId: { in: empresas } } },
    });
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  // ── el impacto se ve ANTES de decidir ───────────────────────────

  it('el impacto cuenta lo que existe de verdad y no cambia nada', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    const impacto = await eliminacion.impacto(contacto.id, empresaA);

    expect(impacto.relaciones.conversaciones).toBe(1);
    expect(impacto.relaciones.mensajes).toBe(1);
    expect(impacto.vacio).toBe(false);
    expect(impacto.accionPropuesta).toBe('anonimizado');

    // Consultar el impacto es de solo lectura.
    expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(1);
    expect(
      await prisma.message.count({
        where: { conversation: { contactId: contacto.id } },
      }),
    ).toBe(1);
  });

  it('un contacto vacío se declara vacío y propone borrado', async () => {
    const contacto = await contactoVacio(empresaA);

    const impacto = await eliminacion.impacto(contacto.id, empresaA);

    expect(impacto.totalRelaciones).toBe(0);
    expect(impacto.vacio).toBe(true);
    expect(impacto.accionPropuesta).toBe('borrado');
  });

  it('el impacto de un contacto de OTRA empresa no se puede consultar', async () => {
    const contacto = await contactoVacio(empresaA);
    await expect(eliminacion.impacto(contacto.id, empresaB)).rejects.toThrow();
  });

  // ── la confirmacion reforzada ───────────────────────────────────

  it('sin la frase exacta no se elimina nada', async () => {
    const contacto = await contactoVacio(empresaA);

    await expect(
      eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
        confirmacion: 'sí',
      }),
    ).rejects.toThrow(/ELIMINAR DEFINITIVAMENTE/);

    expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(1);
  });

  // ── contacto vacio: se borra de verdad ──────────────────────────

  it('un contacto vacío SÍ se borra físicamente', async () => {
    const contacto = await contactoVacio(empresaA);

    const r = await eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
    });

    expect(r.accion).toBe('borrado');
    expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(0);
  });

  // ── contacto con historia: se anonimiza, NO se borra ────────────

  it('un contacto con historia se anonimiza y la historia SOBREVIVE', async () => {
    const { contacto, conversacion, mensaje } =
      await contactoConHistorial(empresaA);

    const r = await eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
      motivo: 'el cliente ejerció su derecho de supresión',
    });

    expect(r.accion).toBe('anonimizado');

    // La PII se fue.
    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
    });
    expect(fila).not.toBeNull();
    expect(fila!.email).toBeNull();
    expect(fila!.tags).toEqual([]);
    expect(fila!.name).toBe('Contacto anonimizado');
    expect(fila!.phone).not.toContain('+573');
    expect(fila!.anonymizedAt).toBeInstanceOf(Date);

    // Y el negocio sigue entero: esto es lo que una cascada se habría llevado.
    expect(
      await prisma.conversation.count({ where: { id: conversacion.id } }),
    ).toBe(1);
    const m = await prisma.message.findUnique({ where: { id: mensaje.id } });
    expect(m?.body).toBe('Acordamos 4.500.000 por el lote');
  });

  it('los campos personalizados SÍ se borran al anonimizar', async () => {
    const { contacto } = await contactoConHistorial(empresaA);
    const definicion = await prisma.customFieldDefinition.create({
      data: {
        companyId: empresaA,
        // La clave es un identificador, no una etiqueta: minúsculas,
        // empezando por letra. El prefijo E2E-ELIM no vale aquí.
        key: `e2e_elim_cedula_${n++}`,
        label: 'Cédula',
        entity: 'CONTACT',
        type: 'TEXT',
      },
    });
    await prisma.customFieldValue.create({
      data: {
        companyId: empresaA,
        definitionId: definicion.id,
        contactId: contacto.id,
        valueText: '1.020.304.050',
      },
    });

    await eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
    });

    // Son datos que la empresa recogió sobre la persona, no historia
    // comercial: se van con ella.
    expect(
      await prisma.customFieldValue.count({
        where: { contactId: contacto.id },
      }),
    ).toBe(0);

    await prisma.customFieldDefinition.deleteMany({
      where: { id: definicion.id },
    });
  });

  it('anonimizar dos veces no vuelve a pisar la marca', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    await eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
    });

    await expect(
      eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
        confirmacion: CONFIRMACION_REQUERIDA,
      }),
    ).rejects.toThrow(/ya fue anonimizado/i);
  });

  it('un contacto anonimizado ni se edita ni se restaura', async () => {
    const { contacto } = await contactoConHistorial(empresaA);
    await eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
    });

    // Rellenarle el nombre otra vez deshace en un clic lo que se hizo para
    // atender la supresión.
    await expect(
      contactos.update(contacto.id, empresaA, { name: 'Juan Pérez' }),
    ).rejects.toThrow(/anonimizado/i);

    await expect(contactos.restore(contacto.id, empresaA)).rejects.toThrow(
      /anonimizado/i,
    );
  });

  // ── concurrencia ────────────────────────────────────────────────

  it('dos eliminaciones simultáneas del mismo contacto: una gana, una falla', async () => {
    const { contacto } = await contactoConHistorial(empresaA);

    const resultados = await Promise.allSettled([
      eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
        confirmacion: CONFIRMACION_REQUERIDA,
      }),
      eliminacion.eliminarDefinitivo(contacto.id, empresaA, {
        confirmacion: CONFIRMACION_REQUERIDA,
      }),
    ]);

    const cumplidas = resultados.filter((r) => r.status === 'fulfilled');
    expect(cumplidas).toHaveLength(1);

    // Y el contacto quedó anonimizado UNA vez, no dos.
    const fila = await prisma.contact.findUnique({
      where: { id: contacto.id },
      select: { anonymizedAt: true },
    });
    expect(fila?.anonymizedAt).toBeInstanceOf(Date);
  });

  // ── aislamiento entre empresas ──────────────────────────────────

  it('no se puede eliminar el contacto de OTRA empresa', async () => {
    const contacto = await contactoVacio(empresaA);

    await expect(
      eliminacion.eliminarDefinitivo(contacto.id, empresaB, {
        confirmacion: CONFIRMACION_REQUERIDA,
      }),
    ).rejects.toThrow();

    expect(await prisma.contact.count({ where: { id: contacto.id } })).toBe(1);
  });

  it('dos empresas pueden tener el MISMO teléfono sin mezclarse', async () => {
    const mismoNumero = telefono();
    const enA = await prisma.contact.create({
      data: { companyId: empresaA, phone: mismoNumero, name: `${PREFIJO} A` },
    });
    const enB = await prisma.contact.create({
      data: { companyId: empresaB, phone: mismoNumero, name: `${PREFIJO} B` },
    });

    await eliminacion.eliminarDefinitivo(enA.id, empresaA, {
      confirmacion: CONFIRMACION_REQUERIDA,
    });

    // El de la empresa B sigue intacto: mismo número, otra casa.
    const fila = await prisma.contact.findUnique({ where: { id: enB.id } });
    expect(fila).not.toBeNull();
    expect(fila!.phone).toBe(mismoNumero);
    expect(await prisma.contact.count({ where: { id: enA.id } })).toBe(0);
  });

  // ── papelera ────────────────────────────────────────────────────

  it('la papelera trae los archivados de ESTA empresa y solo esos', async () => {
    const mio = await contactoVacio(empresaA);
    const ajeno = await contactoVacio(empresaB);
    await contactos.remove(mio.id, empresaA, 'a la papelera');
    await contactos.remove(ajeno.id, empresaB, 'de la otra empresa');

    const { items } = await eliminacion.papelera(empresaA);
    const ids = items.map((c) => c.id);

    expect(ids).toContain(mio.id);
    expect(ids).not.toContain(ajeno.id);
  });

  it('un contacto activo NO aparece en la papelera', async () => {
    const activo = await contactoVacio(empresaA);

    const { items } = await eliminacion.papelera(empresaA);

    expect(items.map((c) => c.id)).not.toContain(activo.id);
  });
});
