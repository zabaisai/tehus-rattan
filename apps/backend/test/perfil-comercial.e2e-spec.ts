import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PerfilComercialService } from '../src/modules/contacts/perfil-comercial.service';

/**
 * EL PERFIL COMERCIAL — un contrato, un origen, contra la base real.
 *
 * El Pipeline y Conversaciones enseñan el MISMO panel. Lo que se comprueba
 * aqui es que ese panel se arma de una sola consulta y que no puede cruzar
 * empresas: son las dos cosas que un doble no demuestra.
 *
 * Datos con prefijo E2E-PERF, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-PERF';

describe('Perfil comercial (e2e, base real)', () => {
  const servicio = new PerfilComercialService(
    prisma as unknown as PrismaService,
  );

  let empresaA: string;
  let empresaB: string;
  let asesorA: string;
  let n = 0;

  const telefono = () => `+5733333${String(1000 + n++).slice(-4)}`;

  async function escenarioCompleto(companyId: string, agentId?: string) {
    const contacto = await prisma.contact.create({
      data: {
        companyId,
        phone: telefono(),
        name: `${PREFIJO} Cliente`,
        email: 'cliente@example.com',
        tags: ['vip', 'mayorista'],
      },
    });

    const pipeline = await prisma.pipeline.create({
      data: { companyId, name: `${PREFIJO} Ventas`, order: n },
    });
    const etapa = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name: 'Cotizando',
        order: 0,
        isInitial: true,
        color: '#FF6A00',
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId,
        contactId: contacto.id,
        pipelineId: pipeline.id,
        stageId: etapa.id,
        title: `${PREFIJO} Sala de ratán`,
        value: '4500000.50',
        assignedTo: agentId,
      },
    });

    const conversacion = await prisma.conversation.create({
      data: {
        companyId,
        contactId: contacto.id,
        status: 'OPEN',
        assignedTo: agentId,
        lastMessageAt: new Date(),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversacion.id,
        direction: 'INBOUND',
        body: '¿Me confirma el precio del lote?',
        status: 'DELIVERED',
      },
    });

    await prisma.task.create({
      data: {
        companyId,
        contactId: contacto.id,
        leadId: lead.id,
        title: `${PREFIJO} Llamar mañana`,
        status: 'PENDING',
        priority: 'HIGH',
      },
    });

    await prisma.quote.create({
      data: {
        companyId,
        leadId: lead.id,
        number: `COT-${PREFIJO}-${n++}`,
        subtotal: '4500000.50',
        discount: '0',
        total: '4500000.50',
      },
    });

    return { contacto, pipeline, etapa, lead, conversacion };
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
        name: 'Camila Ruiz',
        password: 'no-se-usa',
        role: 'AGENT',
      },
    });
    asesorA = u.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
    await prisma.message.deleteMany({
      where: { conversation: { companyId: { in: empresas } } },
    });
    await prisma.quote.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.leadStageHistory.deleteMany({
      where: { lead: { companyId: { in: empresas } } },
    });
    await prisma.note.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.customFieldValue.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.customFieldDefinition.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.conversation.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
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

  it('trae TODO lo que el panel promete, de una sola llamada', async () => {
    const { contacto, pipeline, etapa, conversacion } = await escenarioCompleto(
      empresaA,
      asesorA,
    );

    const p = await servicio.perfil(contacto.id, empresaA);

    // Identidad
    expect(p.contacto.nombre).toBe(`${PREFIJO} Cliente`);
    expect(p.contacto.telefono).toBe(contacto.phone);
    expect(p.contacto.etiquetas).toEqual(['vip', 'mayorista']);
    expect(p.empresa.nombre).toBe(`${PREFIJO}-A`);

    // Oportunidad: embudo, etapa, valor y asesor
    expect(p.oportunidad).not.toBeNull();
    expect(p.oportunidad!.pipeline.id).toBe(pipeline.id);
    expect(p.oportunidad!.etapa.id).toBe(etapa.id);
    expect(p.oportunidad!.etapa.nombre).toBe('Cotizando');
    expect(p.oportunidad!.valor).toBe(4500000.5);
    expect(p.oportunidad!.asesor?.nombre).toBe('Camila Ruiz');

    // Conversación y último mensaje: es lo que decide si escribir o no
    expect(p.conversacion?.id).toBe(conversacion.id);
    expect(p.conversacion?.ultimoMensaje?.cuerpo).toBe(
      '¿Me confirma el precio del lote?',
    );
    expect(p.conversacion?.ultimoMensaje?.entrante).toBe(true);

    // Trabajo pendiente
    expect(p.tareasPendientes).toHaveLength(1);
    expect(p.tareasPendientes[0].titulo).toBe(`${PREFIJO} Llamar mañana`);
    expect(p.cotizaciones).toHaveLength(1);
    expect(p.cotizaciones[0].total).toBe(4500000.5);
  });

  it('el valor y el total llegan como número exacto, no como Decimal serializado', async () => {
    // El panel los pinta; si llegaran como objeto Decimal saldría "[object
    // Object]" donde va el precio acordado.
    const { contacto } = await escenarioCompleto(empresaA, asesorA);

    const p = await servicio.perfil(contacto.id, empresaA);

    expect(typeof p.oportunidad!.valor).toBe('number');
    expect(typeof p.cotizaciones[0].total).toBe('number');
  });

  it('un contacto sin oportunidad ni conversación no rompe el panel', async () => {
    // Un contacto recién creado a mano existe y hay que poder verlo.
    const contacto = await prisma.contact.create({
      data: {
        companyId: empresaA,
        phone: telefono(),
        name: `${PREFIJO} Nuevo`,
      },
    });

    const p = await servicio.perfil(contacto.id, empresaA);

    expect(p.oportunidad).toBeNull();
    expect(p.conversacion).toBeNull();
    expect(p.tareasPendientes).toEqual([]);
    expect(p.cotizaciones).toEqual([]);
    expect(p.actividad).toEqual([]);
  });

  it('las tareas YA HECHAS no cuentan como pendientes', async () => {
    const { contacto } = await escenarioCompleto(empresaA, asesorA);
    await prisma.task.updateMany({
      where: { contactId: contacto.id },
      data: { status: 'COMPLETED' },
    });

    const p = await servicio.perfil(contacto.id, empresaA);

    expect(p.tareasPendientes).toEqual([]);
  });

  it('la actividad mezcla etapas, notas y cotizaciones ordenadas por fecha', async () => {
    const { contacto, lead, etapa } = await escenarioCompleto(
      empresaA,
      asesorA,
    );
    await prisma.leadStageHistory.create({
      data: { leadId: lead.id, toStageId: etapa.id },
    });
    await prisma.note.create({
      data: {
        companyId: empresaA,
        leadId: lead.id,
        content: `${PREFIJO} el cliente pidió factura`,
      },
    });

    const p = await servicio.perfil(contacto.id, empresaA);

    const tipos = p.actividad.map((a) => a.tipo);
    expect(tipos).toContain('etapa');
    expect(tipos).toContain('nota');
    expect(tipos).toContain('cotizacion');

    // El nombre de la etapa se resuelve: el historial solo guarda el id.
    const cambio = p.actividad.find((a) => a.tipo === 'etapa');
    expect(cambio!.descripcion).toContain('Cotizando');

    // Más reciente primero.
    const fechas = p.actividad.map((a) => a.fecha);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it('los campos personalizados llegan como texto, no como columnas crudas', async () => {
    const { contacto } = await escenarioCompleto(empresaA, asesorA);
    const definicion = await prisma.customFieldDefinition.create({
      data: {
        companyId: empresaA,
        key: `e2e_perf_ciudad_${n++}`,
        label: 'Ciudad',
        entity: 'CONTACT',
        type: 'TEXT',
      },
    });
    await prisma.customFieldValue.create({
      data: {
        companyId: empresaA,
        definitionId: definicion.id,
        contactId: contacto.id,
        valueText: 'Medellín',
      },
    });

    const p = await servicio.perfil(contacto.id, empresaA);

    // Cada tipo guarda en su columna; que cada pantalla sepa cuál mirar es
    // justo la lógica duplicada que este servicio existe para evitar.
    expect(p.camposPersonalizados).toEqual([
      expect.objectContaining({ label: 'Ciudad', valor: 'Medellín' }),
    ]);
  });

  // ── aislamiento multiempresa ────────────────────────────────────

  /**
   * EL PERFIL 360 (mockup 18) NECESITA MAS DE LO QUE EL CONTRATO DABA.
   *
   * El panel lateral se conforma con «la oportunidad abierta» y «la
   * conversacion mas reciente». La pantalla completa necesita las LISTAS y los
   * CONTEOS: cuantas conversaciones hay, cuantas oportunidades, cuanto vale lo
   * abierto. Sin eso, una pestaña «Conversaciones 3» solo se puede escribir
   * inventando el 3.
   */
  describe('lo que el perfil 360 necesita', () => {
    it('resume con conteos reales, no con lo que quepa en el panel', async () => {
      const e = await escenarioCompleto(empresaA, asesorA);
      const p = await servicio.perfil(e.contacto.id, empresaA);

      expect(p.resumen).toBeDefined();
      expect(p.resumen.conversaciones).toBeGreaterThanOrEqual(1);
      expect(p.resumen.oportunidades).toBeGreaterThanOrEqual(1);
      expect(p.resumen.cotizaciones).toBeGreaterThanOrEqual(1);
      expect(p.resumen.tareasPendientes).toBeGreaterThanOrEqual(1);
      expect(typeof p.resumen.valorAbierto).toBe('number');
    });

    it('el valor abierto suma SOLO las oportunidades abiertas', async () => {
      const e = await escenarioCompleto(empresaA, asesorA);
      await prisma.lead.create({
        data: {
          companyId: empresaA,
          contactId: e.contacto.id,
          pipelineId: e.pipeline.id,
          stageId: e.etapa.id,
          title: `${PREFIJO} Ganada`,
          value: '9000000',
          status: 'WON',
        },
      });

      const p = await servicio.perfil(e.contacto.id, empresaA);

      // La ganada cuenta en la lista, pero no en el valor abierto.
      expect(p.resumen.oportunidades).toBe(2);
      expect(p.resumen.valorAbierto).toBe(4500000.5);
    });

    it('lista las conversaciones con canal y estado, para poder abrir cada una', async () => {
      const e = await escenarioCompleto(empresaA, asesorA);
      const p = await servicio.perfil(e.contacto.id, empresaA);

      expect(p.conversaciones.length).toBeGreaterThanOrEqual(1);
      expect(p.conversaciones[0]).toMatchObject({
        id: expect.any(String),
        canal: expect.any(String),
        estado: expect.any(String),
      });
    });

    it('lista TODAS las oportunidades, no solo la abierta', async () => {
      const e = await escenarioCompleto(empresaA, asesorA);
      await prisma.lead.create({
        data: {
          companyId: empresaA,
          contactId: e.contacto.id,
          pipelineId: e.pipeline.id,
          stageId: e.etapa.id,
          title: `${PREFIJO} Perdida`,
          value: '100',
          status: 'LOST',
        },
      });

      const p = await servicio.perfil(e.contacto.id, empresaA);

      expect(p.oportunidades.length).toBe(2);
      expect(p.oportunidades.map((o) => o.estado).sort()).toEqual([
        'LOST',
        'OPEN',
      ]);
      expect(p.oportunidades[0].etapa.nombre).toBeTruthy();
    });

    it('los documentos del producto son los PDF de cotizaciones emitidas', async () => {
      // No hay modelo `Document` en el repositorio. Un borrador todavia no es
      // un documento; una cotizacion enviada si tiene PDF.
      const e = await escenarioCompleto(empresaA, asesorA);
      const p = await servicio.perfil(e.contacto.id, empresaA);

      expect(Array.isArray(p.documentos)).toBe(true);
      expect(p.documentos.every((d) => d.estado !== 'DRAFT')).toBe(true);
      expect(p.resumen.documentos).toBe(p.documentos.length);
    });

    it('la ultima interaccion sale del ultimo mensaje real', async () => {
      const e = await escenarioCompleto(empresaA, asesorA);
      const p = await servicio.perfil(e.contacto.id, empresaA);

      expect(p.ultimaInteraccionEn).toEqual(expect.any(String));
    });

    it('un contacto sin nada devuelve ceros y listas vacias, no undefined', async () => {
      const solo = await prisma.contact.create({
        data: {
          companyId: empresaA,
          phone: telefono(),
          name: `${PREFIJO} Solo`,
        },
      });

      const p = await servicio.perfil(solo.id, empresaA);

      expect(p.resumen).toEqual({
        valorAbierto: 0,
        conversaciones: 0,
        oportunidades: 0,
        tareasPendientes: 0,
        cotizaciones: 0,
        documentos: 0,
      });
      expect(p.conversaciones).toEqual([]);
      expect(p.oportunidades).toEqual([]);
      expect(p.documentos).toEqual([]);
      expect(p.ultimaInteraccionEn).toBeNull();
    });

    it('los conteos NO cruzan empresas', async () => {
      const a = await escenarioCompleto(empresaA, asesorA);
      const b = await escenarioCompleto(empresaB);

      const pa = await servicio.perfil(a.contacto.id, empresaA);
      const pb = await servicio.perfil(b.contacto.id, empresaB);

      expect(pa.resumen.conversaciones).toBe(1);
      expect(pb.resumen.conversaciones).toBe(1);
      expect(pa.conversaciones[0].id).not.toBe(pb.conversaciones[0].id);
    });
  });

  it('NO se puede ver el perfil de un contacto de otra empresa', async () => {
    const { contacto } = await escenarioCompleto(empresaA, asesorA);

    await expect(servicio.perfil(contacto.id, empresaB)).rejects.toThrow();
  });

  it('dos empresas con el MISMO teléfono no mezclan perfiles', async () => {
    const mismoNumero = telefono();
    const enA = await prisma.contact.create({
      data: { companyId: empresaA, phone: mismoNumero, name: `${PREFIJO} A` },
    });
    const enB = await prisma.contact.create({
      data: { companyId: empresaB, phone: mismoNumero, name: `${PREFIJO} B` },
    });

    const pa = await servicio.perfil(enA.id, empresaA);
    const pb = await servicio.perfil(enB.id, empresaB);

    expect(pa.contacto.nombre).toBe(`${PREFIJO} A`);
    expect(pb.contacto.nombre).toBe(`${PREFIJO} B`);
    expect(pa.empresa.id).not.toBe(pb.empresa.id);
  });
});
