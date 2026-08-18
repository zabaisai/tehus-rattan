import { Prisma } from '@prisma/client';
import { PREFIJO, TEL_DEMO, DOMINIO_DEMO } from './demo-socio';

/**
 * EL BASELINE: pequeño, coherente y con estados variados.
 *
 * La regla que lo gobierna es «que cada pantalla tenga algo que enseñar y
 * también algo vacío». Un producto poblado solo con listas llenas no
 * demuestra cómo se comporta cuando no hay nada, y ahí es justo donde un CRM
 * suele verse mal delante de alguien que lo está evaluando.
 *
 * Es deliberadamente corto: 6 contactos, 5 oportunidades, 3 conversaciones.
 * Llenarlo con decenas de filas haría la demo menos legible, no más creíble.
 */
export async function sembrarBaseline(
  tx: Prisma.TransactionClient,
  empresaId: string,
  autorId: string,
  asesorId: string,
): Promise<void> {
  // `isDefault: true` NO es un adorno. `analytics/leads-by-stage` —lo que
  // alimenta «Oportunidades abiertas» y el resumen del embudo en el Inicio—
  // busca el embudo PREDETERMINADO de la empresa y, si no lo encuentra,
  // devuelve una lista vacia. Sin esta linea el Inicio enseñaba «0
  // oportunidades» y «el embudo no tiene etapas» mientras el valor abierto
  // decia 26,5 M: dos cifras que no pueden ser ciertas a la vez. Todas las
  // demas empresas de la base lo tienen puesto; la demo era la unica que no.
  const embudo = await tx.pipeline.create({
    data: {
      companyId: empresaId,
      name: `${PREFIJO}Embudo comercial`,
      order: 0,
      isDefault: true,
    },
    select: { id: true },
  });

  const etapasDef = [
    { name: 'Nuevo', color: '#131C4A' },
    { name: 'Contactado', color: '#1A2352' },
    { name: 'Cotizado', color: '#FF6A00' },
    { name: 'Negociación', color: '#0E8A5F' },
    { name: 'Ganado', color: '#0C734F' },
  ];
  const etapas: { id: string }[] = [];
  for (let i = 0; i < etapasDef.length; i++) {
    etapas.push(
      await tx.pipelineStage.create({
        data: {
          pipelineId: embudo.id,
          name: etapasDef[i].name,
          order: i,
          color: etapasDef[i].color,
          isInitial: i === 0,
        },
        select: { id: true },
      }),
    );
  }

  const productosDef = [
    { name: 'Sofá modular Aurora', price: 4200000, sku: 'SOF-001' },
    { name: 'Mesa de comedor roble', price: 2800000, sku: 'MES-001' },
    { name: 'Silla tapizada lino', price: 690000, sku: 'SIL-001' },
  ];
  const productos: { id: string }[] = [];
  for (const p of productosDef) {
    productos.push(
      await tx.product.create({
        data: {
          companyId: empresaId,
          name: `${PREFIJO}${p.name}`,
          price: new Prisma.Decimal(p.price),
          sku: `${PREFIJO}${p.sku}`,
        },
        select: { id: true },
      }),
    );
  }

  async function contacto(
    nombre: string,
    phone: string,
    tags: string[],
    archivado = false,
  ) {
    return tx.contact.create({
      data: {
        companyId: empresaId,
        name: `${PREFIJO}${nombre}`,
        phone,
        email: `${nombre.split(' ')[0].toLowerCase()}@${DOMINIO_DEMO}`,
        tags,
        ...(archivado
          ? {
              archivedAt: new Date('2026-08-01T10:00:00Z'),
              archivedReason: 'Cliente inactivo',
            }
          : {}),
      },
      select: { id: true },
    });
  }

  const ana = await contacto('Ana Villalba', TEL_DEMO.ana, [
    'Cliente VIP',
    'Bogotá',
  ]);
  const bruno = await contacto('Bruno Cifuentes', TEL_DEMO.bruno, [
    'Interesado',
  ]);
  const carla = await contacto('Carla Duarte', TEL_DEMO.carla, ['Mayorista']);
  const diego = await contacto('Diego Erazo', TEL_DEMO.diego, []);
  const elena = await contacto('Elena Fajardo', TEL_DEMO.elena, ['Showroom']);
  // Uno archivado: la Papelera de Contactos no puede estar vacía en una demo,
  // porque restaurar es justo una de las cosas que hay que poder enseñar.
  await contacto('Fabio Guzmán', TEL_DEMO.archivado, [], true);

  const oportunidades = [
    {
      c: ana,
      etapa: 3,
      titulo: 'Sala completa para apartamento',
      valor: 12400000,
      estado: 'OPEN' as const,
      asesor: asesorId,
    },
    {
      c: bruno,
      etapa: 1,
      titulo: 'Comedor de seis puestos',
      valor: 5200000,
      estado: 'OPEN' as const,
      asesor: asesorId,
    },
    // Sin asesor: la señal «Sin asignar» tiene que verse en el listado.
    {
      c: carla,
      etapa: 2,
      titulo: 'Pedido mayorista de sillas',
      valor: 8900000,
      estado: 'OPEN' as const,
      asesor: null,
    },
    {
      c: diego,
      etapa: 4,
      titulo: 'Renovación de recepción',
      valor: 3100000,
      estado: 'WON' as const,
      asesor: asesorId,
    },
    {
      c: elena,
      etapa: 0,
      titulo: 'Consulta por showroom',
      valor: 0,
      estado: 'OPEN' as const,
      asesor: null,
    },
  ];

  const leads: { id: string }[] = [];
  for (const o of oportunidades) {
    leads.push(
      await tx.lead.create({
        data: {
          companyId: empresaId,
          contactId: o.c.id,
          pipelineId: embudo.id,
          stageId: etapas[o.etapa].id,
          title: `${PREFIJO}${o.titulo}`,
          value: new Prisma.Decimal(o.valor),
          status: o.estado,
          ...(o.asesor ? { assignedTo: o.asesor } : {}),
        },
        select: { id: true },
      }),
    );
  }

  const conversacionesDef = [
    {
      c: ana,
      estado: 'OPEN' as const,
      asesor: asesorId as string | null,
      lead: leads[0].id as string | null,
    },
    {
      c: bruno,
      estado: 'PENDING' as const,
      asesor: null,
      lead: leads[1].id as string | null,
    },
    // Archivada: la pestaña de archivadas del inbox tampoco puede estar vacía.
    { c: carla, estado: 'ARCHIVED' as const, asesor: null, lead: null },
  ];

  for (const cv of conversacionesDef) {
    const hilo = await tx.conversation.create({
      data: {
        companyId: empresaId,
        contactId: cv.c.id,
        status: cv.estado,
        lastMessageAt: new Date('2026-08-17T15:00:00Z'),
        ...(cv.asesor ? { assignedTo: cv.asesor } : {}),
        ...(cv.lead ? { leadId: cv.lead } : {}),
      },
      select: { id: true },
    });
    await tx.message.createMany({
      data: [
        {
          conversationId: hilo.id,
          direction: 'INBOUND',
          body: 'Hola, quisiera información de precios.',
          status: 'DELIVERED',
          createdAt: new Date('2026-08-17T14:58:00Z'),
        },
        {
          conversationId: hilo.id,
          direction: 'OUTBOUND',
          body: '¡Claro! ¿Qué espacio quieres amoblar?',
          status: 'DELIVERED',
          createdAt: new Date('2026-08-17T15:00:00Z'),
        },
      ],
    });
  }

  // Pendiente, vencida y completada: los tres estados que hacen legible Tareas.
  await tx.task.createMany({
    data: [
      {
        companyId: empresaId,
        contactId: ana.id,
        leadId: leads[0].id,
        title: `${PREFIJO}Enviar cotización de la sala`,
        status: 'PENDING',
        priority: 'HIGH',
        dueDate: new Date('2026-08-20T17:00:00Z'),
      },
      {
        companyId: empresaId,
        contactId: bruno.id,
        title: `${PREFIJO}Llamar para confirmar medidas`,
        status: 'PENDING',
        priority: 'MEDIUM',
        dueDate: new Date('2026-08-10T17:00:00Z'),
      },
      {
        companyId: empresaId,
        contactId: diego.id,
        title: `${PREFIJO}Coordinar entrega de recepción`,
        status: 'COMPLETED',
        priority: 'LOW',
      },
    ],
  });

  // Una cotización EMITIDA —que es lo que el producto llama «documento»— y
  // otra en borrador, que no lo es todavía.
  const emitida = await tx.quote.create({
    data: {
      companyId: empresaId,
      contactId: ana.id,
      leadId: leads[0].id,
      number: `${PREFIJO}COT-0001`,
      title: `${PREFIJO}Sala completa`,
      status: 'SENT',
      subtotal: new Prisma.Decimal(8400000),
      total: new Prisma.Decimal(8400000),
    },
    select: { id: true },
  });
  await tx.quoteItem.create({
    data: {
      quoteId: emitida.id,
      productId: productos[0].id,
      // `name` se copia al crear la linea a proposito: una cotizacion emitida
      // no puede cambiar porque despues se renombre el producto.
      name: `${PREFIJO}Sofá modular Aurora`,
      description: 'Dos módulos, tapizado lino arena.',
      quantity: 2,
      unitPrice: new Prisma.Decimal(4200000),
      // 2 × 4.200.000, sin descuento de linea. La cotizacion emitida cuadra:
      // subtotal de linea = subtotal = total de la cotizacion.
      subtotal: new Prisma.Decimal(8400000),
    },
  });
  await tx.quote.create({
    data: {
      companyId: empresaId,
      contactId: carla.id,
      leadId: leads[2].id,
      number: `${PREFIJO}COT-0002`,
      title: `${PREFIJO}Pedido mayorista`,
      status: 'DRAFT',
      subtotal: new Prisma.Decimal(8900000),
      total: new Prisma.Decimal(8900000),
    },
  });

  await tx.note.create({
    data: {
      companyId: empresaId,
      leadId: leads[0].id,
      content:
        'Prefiere entrega en la mañana. Vive en un quinto piso sin ascensor.',
      createdBy: autorId,
    },
  });

  // ── Actividad reciente ────────────────────────────────────────────────
  //
  // El panel del Inicio lee la AUDITORIA de la empresa. Un baseline recien
  // sembrado no ha registrado nada, asi que el panel salia vacio y la
  // conclusion razonable de quien lo mira es que el producto no anota lo que
  // pasa. Estos eventos son ficticios y existen solo para que esa pantalla
  // sea demostrable.
  //
  // `entityType: 'DEMO_SOCIO_BASELINE'` es el marcador que permite
  // REGENERARLOS en cada restauracion sin tocar una sola auditoria de verdad:
  // si alguien archiva un contacto recorriendo la demo, ese registro es real
  // y se conserva, como en cualquier otra empresa.
  //
  // Fechas fijas y escalonadas: el panel ordena por fecha, y con `now()` los
  // cinco caerian en el mismo segundo y el orden seria arbitrario.
  const momento = new Date('2026-08-17T15:10:00Z').getTime();
  const eventos = [
    {
      action: 'contact.archive',
      minutos: 0,
      actor: autorId,
      rol: 'ADMIN' as const,
    },
    {
      action: 'contact.restore',
      minutos: 55,
      actor: asesorId,
      rol: 'AGENT' as const,
    },
    {
      action: 'flowbot.create',
      minutos: 130,
      actor: autorId,
      rol: 'ADMIN' as const,
    },
    {
      action: 'custom_field.create',
      minutos: 240,
      actor: autorId,
      rol: 'ADMIN' as const,
    },
    {
      action: 'CREATE_COMPANY',
      minutos: 1440,
      actor: autorId,
      rol: 'ADMIN' as const,
    },
  ];
  for (const e of eventos) {
    await tx.auditLog.create({
      data: {
        affectedCompanyId: empresaId,
        actorUserId: e.actor,
        actorRole: e.rol,
        action: e.action,
        entityType: 'DEMO_SOCIO_BASELINE',
        // Sin `entityId`, sin `reason`, sin `metadata`, sin IP y sin agente:
        // nada que pueda parecer el dato de una persona.
        createdAt: new Date(momento - e.minutos * 60_000),
      },
    });
  }

  // Automatización en BORRADOR y sin ejecuciones: el alcance lo pide
  // explícitamente, y además una activa en modo demo no podría ejecutarse.
  await tx.automation.create({
    data: {
      companyId: empresaId,
      name: `${PREFIJO}Saludo al primer mensaje`,
      // isActive: false — BORRADOR, como pide el alcance. Y aunque alguien la
      // activara, en modo demo no llegaria a ejecutarse.
      isActive: false,
      trigger: 'MESSAGE_RECEIVED',
      actions: [
        {
          type: 'SEND_MESSAGE',
          body: 'Gracias por escribirnos. Te respondemos enseguida.',
        },
      ],
    },
  });
}
