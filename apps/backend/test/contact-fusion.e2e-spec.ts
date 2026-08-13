import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { FusionContactosService } from '../src/modules/contacts/fusion/fusion.service';
import { ContactsService } from '../src/modules/contacts/contacts.service';
import { ContactsEliminacionService } from '../src/modules/contacts/contacts-eliminacion.service';

/**
 * FUSIÓN DE CONTACTOS DUPLICADOS — contra la base real.
 *
 * Con dobles no se demuestra nada de lo que da miedo aquí: que la transacción
 * revierte entera si algo falla a medias, que dos fusiones a la vez no se
 * pisan, que el índice único de teléfono no revienta al intercambiarlo, y que
 * los mensajes siguen exactamente donde estaban. Todo eso solo lo dice
 * PostgreSQL.
 *
 * Datos con prefijo E2E-FUS, limpiados al final. Ningún dato real.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-FUS';

describe('Fusión de contactos duplicados (e2e, base real)', () => {
  const fusion = new FusionContactosService(prisma as unknown as PrismaService);
  const contactos = new ContactsService(prisma as unknown as PrismaService);
  const eliminacion = new ContactsEliminacionService(
    prisma as unknown as PrismaService,
  );

  let empresaA: string;
  let empresaB: string;
  let usuario: string;
  let pipelineId: string;
  let etapaId: string;
  let n = 0;

  const tel = () => `+57300${String(700000 + n++)}`;

  async function contacto(companyId: string, extra: any = {}) {
    return prisma.contact.create({
      data: {
        companyId,
        phone: extra.phone ?? tel(),
        name: extra.name ?? `${PREFIJO} Persona`,
        email: extra.email ?? null,
        tags: extra.tags ?? [],
        ...(extra.archivedAt ? { archivedAt: extra.archivedAt } : {}),
      },
    });
  }

  /** Un contacto con una de cada relación real que cuelga de `contactId`. */
  async function conHistorial(companyId: string, extra: any = {}) {
    const c = await contacto(companyId, extra);

    const conversacion = await prisma.conversation.create({
      data: { companyId, contactId: c.id, status: 'OPEN' },
    });
    const mensaje = await prisma.message.create({
      data: {
        conversationId: conversacion.id,
        direction: 'INBOUND',
        body: `${PREFIJO} texto que no se puede tocar`,
        status: 'DELIVERED',
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId: c.id,
        title: `${PREFIJO} oportunidad`,
        pipelineId,
        stageId: etapaId,
      },
    });
    const tarea = await prisma.task.create({
      data: { companyId, contactId: c.id, title: `${PREFIJO} tarea` },
    });
    const cotizacion = await prisma.quote.create({
      data: {
        companyId,
        contactId: c.id,
        leadId: lead.id,
        number: `${PREFIJO}-${n++}`,
      },
    });
    const nota = await prisma.note.create({
      data: { companyId, leadId: lead.id, content: `${PREFIJO} nota` },
    });

    return { c, conversacion, mensaje, lead, tarea, cotizacion, nota };
  }

  function versiones(p: any, d: any) {
    return {
      principal: p.updatedAt.toISOString(),
      duplicado: d.updatedAt.toISOString(),
    };
  }

  async function recargar(id: string) {
    return prisma.contact.findUniqueOrThrow({ where: { id } });
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
        email: `${PREFIJO}-${Date.now()}@example.invalid`,
        password: 'x',
        name: `${PREFIJO} Ejecutor`,
        role: 'ADMIN',
      },
    });
    usuario = u.id;

    const p = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO} embudo` },
    });
    pipelineId = p.id;
    const e = await prisma.pipelineStage.create({
      data: { pipelineId, name: `${PREFIJO} etapa`, order: 1 },
    });
    etapaId = e.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.message.deleteMany({
      where: { conversation: { companyId: { in: empresas } } },
    });
    await prisma.note.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.quote.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.customFieldValue.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.customFieldDefinition.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contactMerge.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contactMergeDismissal.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.leadStageHistory.deleteMany({
      where: { lead: { companyId: { in: empresas } } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.auditLog.deleteMany({
      where: { affectedCompanyId: { in: empresas } },
    });
    await prisma.contact.updateMany({
      where: { companyId: { in: empresas } },
      data: { mergedIntoId: null },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } });
    await prisma.pipeline.deleteMany({ where: { companyId: empresaA } });
    await prisma.user.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  // ────────────────────────────────────────────────────────────────────
  describe('caso feliz: se conserva todo y no se mezcla nada', () => {
    it('traslada cada tipo real de relación y deja los mensajes intactos', async () => {
      const P = await conHistorial(empresaA, { name: `${PREFIJO} Laura M` });
      const D = await conHistorial(empresaA, {
        name: `${PREFIJO} Laura Martinez`,
        email: 'laura@example.invalid',
        tags: ['vip'],
      });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.c.id,
        duplicadoId: D.c.id,
        elecciones: {},
        versiones: versiones(P.c, D.c),
      });

      expect(r.trasladadas.conversaciones).toBe(1);
      expect(r.trasladadas.oportunidades).toBe(1);
      expect(r.trasladadas.tareas).toBe(1);
      expect(r.trasladadas.cotizaciones).toBe(1);
      expect(r.trasladadas.mensajes).toBe(1);
      expect(r.trasladadas.notas).toBe(1);

      // Cada relación cuelga ahora del principal…
      for (const [modelo, id] of [
        ['conversation', D.conversacion.id],
        ['lead', D.lead.id],
        ['task', D.tarea.id],
        ['quote', D.cotizacion.id],
      ] as const) {
        const fila = await (prisma as any)[modelo].findUnique({
          where: { id },
        });
        expect(fila.contactId).toBe(P.c.id);
      }

      // …y el mensaje sigue siendo el mismo mensaje, en la misma conversación.
      const mensaje = await prisma.message.findUniqueOrThrow({
        where: { id: D.mensaje.id },
      });
      expect(mensaje.conversationId).toBe(D.conversacion.id);
      expect(mensaje.body).toBe(`${PREFIJO} texto que no se puede tocar`);

      // Las dos conversaciones siguen existiendo por separado: nunca se funden.
      const conversaciones = await prisma.conversation.count({
        where: { contactId: P.c.id },
      });
      expect(conversaciones).toBe(2);
    });

    it('une etiquetas sin duplicados y conserva la identidad que no ganó', async () => {
      const P = await contacto(empresaA, {
        name: `${PREFIJO} Ana`,
        email: 'ana@example.invalid',
        tags: ['vip', 'mayorista'],
      });
      const D = await contacto(empresaA, {
        name: `${PREFIJO} Ana R`,
        email: 'ana.r@example.invalid',
        tags: ['vip', 'feria'],
      });

      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      const principal = await recargar(P.id);
      expect(principal.tags.sort()).toEqual(['feria', 'mayorista', 'vip']);
      expect(principal.altEmails).toContain('ana.r@example.invalid');
      expect(principal.altPhones).toContain(D.phone);
      // El correo principal no cambió: nadie lo eligió.
      expect(principal.email).toBe('ana@example.invalid');
    });

    it('elegir el teléfono del duplicado lo intercambia sin romper el índice único', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Beto` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Beto R` });
      const telefonoDeD = D.phone;
      const telefonoDeP = P.phone;

      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: { campos: { phone: 'duplicado' } },
        versiones: versiones(P, D),
      });

      const principal = await recargar(P.id);
      const alias = await recargar(D.id);
      expect(principal.phone).toBe(telefonoDeD);
      // El número del principal no se pierde: se queda en el alias y además
      // queda buscable como alternativo.
      expect(alias.phone).toBe(telefonoDeP);
      expect(principal.altPhones).toContain(telefonoDeP);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('alias: ni aparece, ni se restaura, ni encadena', () => {
    it('el absorbido no sale en activos ni en papelera y su id redirige', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Carla` });
      const D = await contacto(empresaA, {
        name: `${PREFIJO} Carla D`,
        archivedAt: new Date(),
      });

      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      const activos = await contactos.findAll(empresaA, {});
      expect(activos.map((c) => c.id)).not.toContain(D.id);

      const papelera = await eliminacion.papelera(empresaA, {});
      expect(papelera.items.map((c: any) => c.id)).not.toContain(D.id);

      const resuelto = await fusion.resolverCanonico(D.id, empresaA);
      expect(resuelto.canonicoId).toBe(P.id);
      expect(resuelto.fueFusionado).toBe(true);
    });

    it('no crea cadenas: los alias del absorbido se reapuntan al principal', async () => {
      const A = await contacto(empresaA, { name: `${PREFIJO} Cadena A` });
      const B = await contacto(empresaA, { name: `${PREFIJO} Cadena B` });
      const C = await contacto(empresaA, { name: `${PREFIJO} Cadena C` });

      // C se absorbe en B…
      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: B.id,
        duplicadoId: C.id,
        elecciones: {},
        versiones: versiones(B, C),
      });
      // …y después B se absorbe en A.
      const bAhora = await recargar(B.id);
      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: A.id,
        duplicadoId: bAhora.id,
        elecciones: {},
        versiones: versiones(A, bAhora),
      });

      // C ya no apunta a B: apunta directamente a A. Un solo salto siempre.
      const cAhora = await recargar(C.id);
      expect(cAhora.mergedIntoId).toBe(A.id);
      expect((await fusion.resolverCanonico(C.id, empresaA)).canonicoId).toBe(
        A.id,
      );
    });

    it('un contacto ya absorbido no puede volver a fusionarse ni ser principal', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Dora` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Dora D` });
      const X = await contacto(empresaA, { name: `${PREFIJO} Dora X` });

      await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      const dAhora = await recargar(D.id);
      await expect(
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: dAhora.id,
          duplicadoId: X.id,
          elecciones: {},
          versiones: versiones(dAhora, X),
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('no se fusiona un contacto consigo mismo', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Eva` });
      await expect(
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: P.id,
          duplicadoId: P.id,
          elecciones: {},
          versiones: versiones(P, P),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('aislamiento entre empresas', () => {
    it('un contacto de otra empresa responde como inexistente y no escribe nada', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Fabi` });
      const ajeno = await contacto(empresaB, { name: `${PREFIJO} Ajeno` });

      await expect(
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: P.id,
          duplicadoId: ajeno.id,
          elecciones: {},
          versiones: versiones(P, ajeno),
        }),
      ).rejects.toMatchObject({ status: 404 });

      // Cero escrituras: ni alias, ni fila de fusión.
      expect((await recargar(ajeno.id)).mergedIntoId).toBeNull();
      expect((await recargar(P.id)).mergedIntoId).toBeNull();
      expect(
        await prisma.contactMerge.count({
          where: { mergedContactId: ajeno.id },
        }),
      ).toBe(0);
    });

    it('los candidatos nunca cruzan la frontera de la empresa', async () => {
      const mismoTelefono = tel();
      const aqui = await contacto(empresaA, {
        name: `${PREFIJO} Gemelo`,
        phone: mismoTelefono,
      });
      await contacto(empresaB, {
        name: `${PREFIJO} Gemelo`,
        phone: mismoTelefono,
      });

      const candidatos = await fusion.candidatos(aqui.id, empresaA);
      const ajenos = candidatos.filter((c) =>
        c.contacto.phone === mismoTelefono ? false : true,
      );
      expect(candidatos.every((c) => c.contacto.id !== aqui.id)).toBe(true);
      // Ninguno de los devueltos pertenece a la empresa B.
      for (const c of candidatos) {
        const fila = await recargar(c.contacto.id);
        expect(fila.companyId).toBe(empresaA);
      }
      expect(ajenos).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('detección y descarte', () => {
    it('teléfono o correo iguales son coincidencia fuerte; el nombre solo sugiere', async () => {
      const base = await contacto(empresaA, {
        name: `${PREFIJO} Hugo Perez`,
        email: 'hugo@example.invalid',
      });
      const porCorreo = await contacto(empresaA, {
        name: `${PREFIJO} Otro Distinto`,
        email: 'HUGO@example.invalid',
      });
      const porNombre = await contacto(empresaA, {
        name: `${PREFIJO} Hugo P`,
      });

      const candidatos = await fusion.candidatos(base.id, empresaA);
      const fuerte = candidatos.find((c) => c.contacto.id === porCorreo.id);
      const sugerida = candidatos.find((c) => c.contacto.id === porNombre.id);

      expect(fuerte?.nivel).toBe('alta');
      expect(fuerte?.razones).toContain('Mismo correo');
      expect(sugerida?.nivel).toBe('sugerida');
      expect(sugerida?.razones).toContain('Nombre parecido');
    });

    it('«no son duplicados» deja de sugerir la pareja sin tocar los contactos', async () => {
      const a = await contacto(empresaA, {
        name: `${PREFIJO} Iris Uno`,
        email: 'iris@example.invalid',
      });
      const b = await contacto(empresaA, {
        name: `${PREFIJO} Iris Dos`,
        email: 'iris@example.invalid',
      });

      expect(
        (await fusion.candidatos(a.id, empresaA)).some(
          (c) => c.contacto.id === b.id,
        ),
      ).toBe(true);

      await fusion.descartar(a.id, b.id, empresaA, usuario);

      expect(
        (await fusion.candidatos(a.id, empresaA)).some(
          (c) => c.contacto.id === b.id,
        ),
      ).toBe(false);
      // Al revés también: la pareja se guarda ordenada.
      expect(
        (await fusion.candidatos(b.id, empresaA)).some(
          (c) => c.contacto.id === a.id,
        ),
      ).toBe(false);

      // Y ninguno de los dos cambió.
      expect((await recargar(a.id)).mergedIntoId).toBeNull();
      expect((await recargar(b.id)).mergedIntoId).toBeNull();
    });

    it('descartar dos veces no es un error ni duplica la fila', async () => {
      const a = await contacto(empresaA, { name: `${PREFIJO} Jota Uno` });
      const b = await contacto(empresaA, { name: `${PREFIJO} Jota Dos` });

      const primera = await fusion.descartar(a.id, b.id, empresaA, usuario);
      const segunda = await fusion.descartar(b.id, a.id, empresaA, usuario);

      expect(primera.nuevo).toBe(true);
      expect(segunda.nuevo).toBe(false);
      expect(
        await prisma.contactMergeDismissal.count({
          where: { companyId: empresaA, contactAId: a.id < b.id ? a.id : b.id },
        }),
      ).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('concurrencia, idempotencia y vista previa obsoleta', () => {
    it('repetir la misma petición devuelve el mismo resultado, no un conflicto', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Kilo` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Kilo D` });
      const v = versiones(P, D);

      const primera = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: v,
      });
      const segunda = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: v,
      });

      expect(segunda.mergeId).toBe(primera.mergeId);
      expect(
        await prisma.contactMerge.count({ where: { mergedContactId: D.id } }),
      ).toBe(1);
    });

    it('dos fusiones concurrentes sobre el mismo duplicado: solo una gana', async () => {
      const P1 = await contacto(empresaA, { name: `${PREFIJO} Lima A` });
      const P2 = await contacto(empresaA, { name: `${PREFIJO} Lima B` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Lima D` });

      const intentos = await Promise.allSettled([
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: P1.id,
          duplicadoId: D.id,
          elecciones: {},
          versiones: versiones(P1, D),
        }),
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: P2.id,
          duplicadoId: D.id,
          elecciones: {},
          versiones: versiones(P2, D),
        }),
      ]);

      const ok = intentos.filter((i) => i.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      expect(
        await prisma.contactMerge.count({ where: { mergedContactId: D.id } }),
      ).toBe(1);
    });

    it('si un contacto cambió después de la comparación, la fusión se rechaza', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Mike` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Mike D` });
      const v = versiones(P, D);

      // Alguien edita el duplicado entre la vista previa y el botón.
      await prisma.contact.update({
        where: { id: D.id },
        data: { name: `${PREFIJO} Mike editado` },
      });

      await expect(
        fusion.fusionar({
          companyId: empresaA,
          usuarioId: usuario,
          principalId: P.id,
          duplicadoId: D.id,
          elecciones: {},
          versiones: v,
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect((await recargar(D.id)).mergedIntoId).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('transacción: o entra todo, o no entra nada', () => {
    it('un fallo a mitad del traslado no deja ni alias ni relaciones movidas', async () => {
      const P = await conHistorial(empresaA, { name: `${PREFIJO} November` });
      const D = await conHistorial(empresaA, { name: `${PREFIJO} November D` });

      // EL FALLO SE INYECTA EN LA BASE, NO EN UN DOBLE.
      //
      // Sustituir un método del cliente no sirve: dentro de `$transaction` el
      // servicio usa `tx`, que es otro objeto, así que el doble nunca se
      // ejecutaría y la prueba pasaría sin probar nada. Con un CHECK temporal
      // el error lo lanza PostgreSQL en la última escritura de la transacción
      // —crear la fila de `contact_merges`—, cuando el alias ya está marcado y
      // las relaciones ya están movidas. Si la transacción no revirtiera,
      // quedaría exactamente el estado a medias que esto descarta.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE contact_merges ADD CONSTRAINT e2e_fus_fallo CHECK ("performedById" <> '__fallo__')`,
      );

      try {
        await expect(
          fusion.fusionar({
            companyId: empresaA,
            usuarioId: '__fallo__',
            principalId: P.c.id,
            duplicadoId: D.c.id,
            elecciones: {},
            versiones: versiones(P.c, D.c),
          }),
        ).rejects.toThrow();
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE contact_merges DROP CONSTRAINT e2e_fus_fallo`,
        );
      }

      expect((await recargar(D.c.id)).mergedIntoId).toBeNull();
      const conversacion = await prisma.conversation.findUniqueOrThrow({
        where: { id: D.conversacion.id },
      });
      expect(conversacion.contactId).toBe(D.c.id);
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: D.lead.id },
      });
      expect(lead.contactId).toBe(D.c.id);
      expect(
        await prisma.contactMerge.count({ where: { mergedContactId: D.c.id } }),
      ).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('deshacer', () => {
    it('devuelve exactamente el estado anterior dentro de la ventana', async () => {
      const P = await conHistorial(empresaA, {
        name: `${PREFIJO} Oscar`,
        tags: ['uno'],
        email: 'oscar@example.invalid',
      });
      const D = await conHistorial(empresaA, {
        name: `${PREFIJO} Oscar D`,
        tags: ['dos'],
        email: 'oscar.d@example.invalid',
      });
      const antes = await recargar(P.c.id);

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.c.id,
        duplicadoId: D.c.id,
        elecciones: {},
        versiones: versiones(P.c, D.c),
      });

      await fusion.deshacer(r.mergeId, empresaA, usuario);

      const despues = await recargar(P.c.id);
      expect(despues.name).toBe(antes.name);
      expect(despues.email).toBe(antes.email);
      expect(despues.tags).toEqual(antes.tags);
      expect(despues.altEmails).toEqual(antes.altEmails);

      const alias = await recargar(D.c.id);
      expect(alias.mergedIntoId).toBeNull();
      expect(alias.phone).toBe(D.c.phone);

      // Las relaciones vuelven a su contacto.
      const conversacion = await prisma.conversation.findUniqueOrThrow({
        where: { id: D.conversacion.id },
      });
      expect(conversacion.contactId).toBe(D.c.id);
      const cotizacion = await prisma.quote.findUniqueOrThrow({
        where: { id: D.cotizacion.id },
      });
      expect(cotizacion.contactId).toBe(D.c.id);
    });

    it('vencida la ventana de 10 minutos ya no se puede deshacer', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Papa` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Papa D` });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      // Se envejece la ventana en la propia fila: no se toca el reloj del
      // proceso, que haría la prueba dependiente del orden de ejecución.
      await prisma.contactMerge.update({
        where: { id: r.mergeId },
        data: { undoableUntil: new Date(Date.now() - 1000) },
      });

      await expect(
        fusion.deshacer(r.mergeId, empresaA, usuario),
      ).rejects.toMatchObject({ status: 409 });
      expect((await recargar(D.id)).mergedIntoId).toBe(P.id);
    });

    it('si el principal cambió después de fusionar, deshacer se bloquea y lo explica', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Quebec` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Quebec D` });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      await prisma.contact.update({
        where: { id: P.id },
        data: { name: `${PREFIJO} Quebec editado después` },
      });

      await expect(
        fusion.deshacer(r.mergeId, empresaA, usuario),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ codigo: 'REVERSION_INSEGURA' }),
      });
    });

    it('si se borró algo que se trasladó, deshacer se bloquea en vez de dejarlo a medias', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Romeo` });
      const D = await conHistorial(empresaA, { name: `${PREFIJO} Romeo D` });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.c.id,
        elecciones: {},
        versiones: versiones(P, D.c),
      });

      await prisma.task.delete({ where: { id: D.tarea.id } });

      await expect(
        fusion.deshacer(r.mergeId, empresaA, usuario),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ codigo: 'REVERSION_INSEGURA' }),
      });
    });

    it('no se deshace dos veces', async () => {
      const P = await contacto(empresaA, { name: `${PREFIJO} Sierra` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Sierra D` });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: {},
        versiones: versiones(P, D),
      });

      await fusion.deshacer(r.mergeId, empresaA, usuario);
      await expect(
        fusion.deshacer(r.mergeId, empresaA, usuario),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('campos personalizados', () => {
    it('resuelve campo por campo y la reversión repone el valor perdido', async () => {
      const definicion = await prisma.customFieldDefinition.create({
        data: {
          companyId: empresaA,
          entity: 'CONTACT',
          key: 'e2e_fus_presupuesto',
          label: 'Presupuesto',
          type: 'TEXT',
        },
      });

      const P = await contacto(empresaA, { name: `${PREFIJO} Tango` });
      const D = await contacto(empresaA, { name: `${PREFIJO} Tango D` });

      await prisma.customFieldValue.create({
        data: {
          companyId: empresaA,
          definitionId: definicion.id,
          contactId: P.id,
          valueText: '15-20 millones',
        },
      });
      await prisma.customFieldValue.create({
        data: {
          companyId: empresaA,
          definitionId: definicion.id,
          contactId: D.id,
          valueText: '10-15 millones',
        },
      });

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.id,
        duplicadoId: D.id,
        elecciones: { camposPersonalizados: { [definicion.id]: 'duplicado' } },
        versiones: versiones(P, D),
      });

      // Gana el valor elegido y el principal se queda con UNA sola fila: el
      // índice único por definición y contacto no admite dos.
      const delPrincipal = await prisma.customFieldValue.findMany({
        where: { contactId: P.id, definitionId: definicion.id },
      });
      expect(delPrincipal).toHaveLength(1);
      expect(delPrincipal[0].valueText).toBe('10-15 millones');

      await fusion.deshacer(r.mergeId, empresaA, usuario);

      const reponePrincipal = await prisma.customFieldValue.findFirstOrThrow({
        where: { contactId: P.id, definitionId: definicion.id },
      });
      expect(reponePrincipal.valueText).toBe('15-20 millones');
      const reponeDuplicado = await prisma.customFieldValue.findFirstOrThrow({
        where: { contactId: D.id, definitionId: definicion.id },
      });
      expect(reponeDuplicado.valueText).toBe('10-15 millones');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  describe('vista previa', () => {
    it('concuerda con la ejecución y marca las decisiones pendientes', async () => {
      const P = await conHistorial(empresaA, {
        name: `${PREFIJO} Uniform`,
        email: 'u@example.invalid',
      });
      const D = await conHistorial(empresaA, {
        name: `${PREFIJO} Uniform D`,
        email: 'u.d@example.invalid',
      });

      const vista = await fusion.comparar(P.c.id, D.c.id, empresaA);

      expect(vista.relaciones.conversaciones).toBe(1);
      expect(vista.relaciones.mensajes).toBe(1);
      expect(vista.decisionesPendientes).toBeGreaterThan(0);
      const correo = vista.campos.find((c) => c.campo === 'email');
      expect(correo?.requiereDecision).toBe(true);

      const r = await fusion.fusionar({
        companyId: empresaA,
        usuarioId: usuario,
        principalId: P.c.id,
        duplicadoId: D.c.id,
        elecciones: {},
        versiones: vista.versiones,
      });
      expect(r.trasladadas.conversaciones).toBe(
        vista.relaciones.conversaciones,
      );
    });

    it('un teléfono igual en otro formato no cuenta como diferencia', async () => {
      const P = await contacto(empresaA, {
        name: `${PREFIJO} Victor`,
        phone: '+573001119999',
      });
      const D = await contacto(empresaA, {
        name: `${PREFIJO} Victor`,
        phone: '3001119999',
      });

      const vista = await fusion.comparar(P.id, D.id, empresaA);
      const telefono = vista.campos.find((c) => c.campo === 'phone');
      expect(telefono?.iguales).toBe(true);
      expect(telefono?.requiereDecision).toBe(false);
      expect(vista.coincidencia.nivel).toBe('alta');
    });
  });
});
