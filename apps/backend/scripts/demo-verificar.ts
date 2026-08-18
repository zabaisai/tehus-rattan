import { PrismaClient } from '@prisma/client';
import { SLUG_DEMO, PREFIJO, PERFIL_EMPRESA, empresaDemo } from './demo-socio';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * VERIFICA la empresa demo. SOLO LEE.
 *
 * Por que existe un comando aparte en vez de confiar en el que restablece.
 * Quien enseña el producto no lo hace desde su portatil con la suite de
 * pruebas al lado: entra media hora antes, ejecuta esto y sabe si la demo
 * esta como debe. Un restablecimiento que dice «hecho» no es lo mismo que una
 * demo comprobada, porque entre una cosa y otra puede haber pasado un
 * despliegue, una migracion o el recorrido de ayer.
 *
 * NO ESCRIBE NADA, y es una propiedad, no una casualidad: solo hay `count`,
 * `findMany`, `aggregate` y lecturas de `AnalyticsService`. Se puede ejecutar
 * con la demo abierta en pantalla y delante de quien la esta viendo.
 *
 * Las metricas del Inicio se comprueban LLAMANDO AL SERVICIO REAL, no
 * recalculandolas aqui. Repetir la formula en el verificador solo demostraria
 * que se sabe sumar; lo que hay que demostrar es que la pantalla que se va a
 * enseñar cuadra con las filas que hay debajo.
 *
 * Uso:
 *   npm run demo:verificar
 *
 * Sale con codigo 1 si algo no cuadra, para poder encadenarlo en un guion.
 */

export interface Comprobacion {
  grupo: string;
  nombre: string;
  esperado: unknown;
  obtenido: unknown;
  ok: boolean;
}

export interface Informe {
  companyId: string;
  slug: string;
  comprobaciones: Comprobacion[];
  fallos: Comprobacion[];
  ok: boolean;
}

/** Cifras crudas del baseline aprobado. Un solo sitio donde mirarlas. */
export const BASELINE = {
  usuarios: 2,
  contactosActivos: 5,
  contactosArchivados: 1,
  conversaciones: 3,
  mensajes: 6,
  oportunidades: 5,
  oportunidadesAbiertas: 4,
  oportunidadesGanadas: 1,
  embudos: 1,
  etapas: 5,
  tareas: 3,
  productos: 3,
  cotizaciones: 2,
  automatizaciones: 1,
  valorAbierto: 26_500_000,
  eventosDeActividad: 5,
} as const;

export async function verificar(prisma: PrismaClient): Promise<Informe> {
  const comprobaciones: Comprobacion[] = [];
  let grupo = '';
  const anotar = (nombre: string, esperado: unknown, obtenido: unknown) => {
    comprobaciones.push({
      grupo,
      nombre,
      esperado,
      obtenido,
      // Comparacion estructural: varias comprobaciones devuelven listas
      // ordenadas —los roles, los nombres de las etapas— y compararlas por
      // identidad daria siempre falso.
      ok: JSON.stringify(esperado) === JSON.stringify(obtenido),
    });
  };

  // ── La empresa ────────────────────────────────────────────────────────
  grupo = 'empresa';
  // `empresaDemo` es tambien el guardarrail: si existe una empresa con ese
  // slug SIN la marca de demo, esto lanza en vez de dar un informe en verde
  // sobre una empresa que no es la demo.
  const empresa = await empresaDemo(prisma);
  if (!empresa) {
    anotar(`existe la empresa con slug "${SLUG_DEMO}"`, true, false);
    return {
      companyId: '',
      slug: SLUG_DEMO,
      comprobaciones,
      fallos: comprobaciones,
      ok: false,
    };
  }
  const id = empresa.id;

  const fila = await prisma.company.findUniqueOrThrow({
    where: { id },
    select: {
      slug: true,
      isDemo: true,
      status: true,
      name: true,
      city: true,
      country: true,
      businessType: true,
    },
  });
  anotar(`slug "${SLUG_DEMO}"`, SLUG_DEMO, fila.slug);
  // La marca es lo que apaga los efectos externos. Si esta en falso, la demo
  // puede MANDAR WHATSAPP DE VERDAD, y eso es lo primero que hay que saber.
  anotar('modo demo activo (isDemo)', true, fila.isDemo);
  anotar('empresa ACTIVE', 'ACTIVE', fila.status);
  anotar('perfil en su estado aprobado', PERFIL_EMPRESA.name, fila.name);
  anotar('ciudad del perfil', PERFIL_EMPRESA.city, fila.city);
  anotar('sector del perfil', PERFIL_EMPRESA.businessType, fila.businessType);

  // ── Las dos cuentas ───────────────────────────────────────────────────
  grupo = 'cuentas';
  const usuarios = await prisma.user.findMany({
    where: { companyId: id },
    select: { role: true, name: true },
    orderBy: { role: 'asc' },
  });
  anotar('total de usuarios', BASELINE.usuarios, usuarios.length);
  anotar(
    'roles exactos',
    ['ADMIN', 'AGENT'],
    usuarios.map((u) => u.role).sort(),
  );
  // Una cuenta demo con permisos de plataforma podria administrar TODAS las
  // empresas de la instalacion desde una sesion que se presta a un tercero.
  anotar(
    'ningún SUPER_ADMIN',
    0,
    usuarios.filter((u) => u.role === 'SUPER_ADMIN').length,
  );
  anotar(
    'los dos nombres llevan el prefijo demo',
    BASELINE.usuarios,
    usuarios.filter((u) => u.name?.startsWith(PREFIJO)).length,
  );

  // ── Contactos, bandeja y oportunidades ────────────────────────────────
  grupo = 'datos';
  const [
    activos,
    archivados,
    conversaciones,
    mensajes,
    oportunidades,
    abiertas,
    ganadas,
    tareas,
    productos,
    cotizaciones,
    automatizaciones,
  ] = await Promise.all([
    prisma.contact.count({ where: { companyId: id, archivedAt: null } }),
    prisma.contact.count({
      where: { companyId: id, archivedAt: { not: null } },
    }),
    prisma.conversation.count({ where: { companyId: id } }),
    prisma.message.count({ where: { conversation: { companyId: id } } }),
    prisma.lead.count({ where: { companyId: id } }),
    prisma.lead.count({ where: { companyId: id, status: 'OPEN' } }),
    prisma.lead.count({ where: { companyId: id, status: 'WON' } }),
    prisma.task.count({ where: { companyId: id } }),
    prisma.product.count({ where: { companyId: id } }),
    prisma.quote.count({ where: { companyId: id } }),
    prisma.automation.count({ where: { companyId: id } }),
  ]);
  anotar('contactos activos', BASELINE.contactosActivos, activos);
  anotar('contactos archivados', BASELINE.contactosArchivados, archivados);
  anotar('conversaciones', BASELINE.conversaciones, conversaciones);
  anotar('mensajes', BASELINE.mensajes, mensajes);
  anotar('oportunidades', BASELINE.oportunidades, oportunidades);
  anotar('oportunidades abiertas', BASELINE.oportunidadesAbiertas, abiertas);
  anotar('oportunidades ganadas', BASELINE.oportunidadesGanadas, ganadas);
  anotar('tareas', BASELINE.tareas, tareas);
  anotar('productos', BASELINE.productos, productos);
  anotar('cotizaciones', BASELINE.cotizaciones, cotizaciones);
  anotar('automatizaciones', BASELINE.automatizaciones, automatizaciones);

  // ── El embudo ─────────────────────────────────────────────────────────
  grupo = 'embudo';
  const embudos = await prisma.pipeline.findMany({
    where: { companyId: id },
    select: {
      id: true,
      isDefault: true,
      stages: {
        select: { name: true, order: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  anotar('un solo embudo', BASELINE.embudos, embudos.length);
  const embudo = embudos[0];
  // Sin `isDefault` el Inicio pide el embudo predeterminado, no lo encuentra y
  // enseña «0 oportunidades» junto a un valor abierto de 26,5 M. Dos cifras
  // que no pueden ser ciertas a la vez, delante de quien evalua el producto.
  anotar('el embudo es el PREDETERMINADO', true, embudo?.isDefault ?? false);
  anotar('etapas del embudo', BASELINE.etapas, embudo?.stages.length ?? 0);
  anotar(
    'nombres de las etapas, en orden',
    ['Nuevo', 'Contactado', 'Cotizado', 'Negociación', 'Ganado'],
    embudo?.stages.map((e) => e.name) ?? [],
  );

  const idsDeEtapa = await prisma.pipelineStage.findMany({
    where: { pipeline: { companyId: id } },
    select: { id: true },
  });
  const conocidas = new Set(idsDeEtapa.map((e) => e.id));
  const leads = await prisma.lead.findMany({
    where: { companyId: id },
    select: { stageId: true, pipelineId: true },
  });
  anotar(
    'toda oportunidad vive en una etapa del embudo demo',
    leads.length,
    leads.filter((l) => conocidas.has(l.stageId) && l.pipelineId === embudo?.id)
      .length,
  );

  // ── El Inicio ─────────────────────────────────────────────────────────
  //
  // Se llama al servicio REAL: es la pantalla que se va a enseñar.
  grupo = 'inicio';
  const analytics = new AnalyticsService(prisma as unknown as PrismaService);
  const [overview, porEtapa, actividad, vencidas, pendientes] =
    await Promise.all([
      analytics.getOverview(id),
      analytics.getLeadsByStage(id),
      analytics.getRecentActivity(id),
      analytics.getOverdueTasksCount(id),
      analytics.getPendingConversationsCount(id),
    ]);

  const sumaAbiertas = (
    await prisma.lead.findMany({
      where: { companyId: id, status: 'OPEN' },
      select: { value: true },
    })
  ).reduce((a, l) => a + Number(l.value), 0);
  anotar(
    'valor abierto = suma de las abiertas',
    sumaAbiertas,
    overview.openValue,
  );
  anotar('valor abierto del baseline', BASELINE.valorAbierto, sumaAbiertas);
  anotar(
    'el resumen del embudo cuenta las mismas abiertas',
    abiertas,
    porEtapa.reduce((a, e) => a + e.count, 0),
  );
  anotar(
    'el resumen del embudo suma el mismo valor',
    overview.openValue,
    porEtapa.reduce((a, e) => a + e.totalValue, 0),
  );
  anotar('ganadas del Inicio', ganadas, overview.wonCount);
  const perdidas = await prisma.lead.count({
    where: { companyId: id, status: 'LOST' },
  });
  anotar('perdidas del Inicio', perdidas, overview.lostCount);
  const cerradas = ganadas + perdidas;
  anotar(
    'conversión calculada, no inventada',
    cerradas === 0 ? 0 : Math.round((ganadas / cerradas) * 100),
    overview.conversionRate,
  );

  // Estas dos dependen de la FECHA en que se ejecute: una tarea vence sola con
  // el paso del tiempo. Por eso se comprueban CONTRA LA BASE y no contra una
  // constante, que empezaria a fallar un martes cualquiera sin que nadie haya
  // tocado nada.
  //
  // Y el criterio de la consulta es EL MISMO que usa el servicio, no uno
  // parecido. La primera version conto aqui solo las conversaciones `PENDING`
  // mientras la pantalla cuenta `OPEN` y `PENDING`, y el verificador declaro
  // roto un baseline que estaba bien. Un verificador que reinventa la regla
  // comprueba su propia regla, que es lo unico que no hace falta comprobar.
  anotar(
    'tareas vencidas coherentes con la base',
    await prisma.task.count({
      where: {
        companyId: id,
        dueDate: { lt: new Date() },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    }),
    vencidas,
  );
  anotar(
    'conversaciones pendientes coherentes con la base',
    await prisma.conversation.count({
      where: { companyId: id, status: { in: ['OPEN', 'PENDING'] } },
    }),
    pendientes,
  );

  anotar(
    'la actividad reciente tiene eventos',
    BASELINE.eventosDeActividad,
    actividad.length,
  );
  anotar(
    'todo actor de la actividad es una cuenta demo',
    actividad.length,
    actividad.filter((a) => a.actorName?.includes(PREFIJO)).length,
  );

  // ── Cero efectos externos ─────────────────────────────────────────────
  //
  // La parte que de verdad importa comprobar antes de enseñar nada: que esta
  // empresa no ha mandado —ni tiene por donde mandar— un solo mensaje a un
  // telefono de verdad.
  grupo = 'sin efectos externos';
  const [
    integraciones,
    plantillas,
    conWamid,
    conEnvio,
    conClaveExterna,
    ejecucionesAuto,
    ejecucionesBot,
    pruebasBot,
    sesionesChatbot,
    outboxTotal,
    outboxPendiente,
  ] = await Promise.all([
    prisma.whatsAppIntegration.count({ where: { companyId: id } }),
    prisma.whatsAppTemplate.count({ where: { companyId: id } }),
    prisma.message.count({
      where: { conversation: { companyId: id }, wamid: { not: null } },
    }),
    prisma.message.count({
      where: { conversation: { companyId: id }, sentAt: { not: null } },
    }),
    prisma.message.count({
      where: { conversation: { companyId: id }, externalKey: { not: null } },
    }),
    prisma.automationRun.count({ where: { automation: { companyId: id } } }),
    prisma.flowBotExecution.count({ where: { companyId: id } }),
    prisma.flowBotTestRun.count({ where: { companyId: id } }),
    prisma.chatbotSession.count({ where: { companyId: id } }),
    prisma.outboxEvent.count({ where: { companyId: id } }),
    prisma.outboxEvent.count({
      where: { companyId: id, status: { in: ['PENDING', 'PROCESSING'] } },
    }),
  ]);
  // Sin canal conectado no hay a donde enviar, pase lo que pase mas arriba.
  anotar('sin integración de WhatsApp', 0, integraciones);
  anotar('sin plantillas de WhatsApp', 0, plantillas);
  // `wamid` lo asigna Meta y `sentAt` lo pone el transporte: cualquiera de los
  // dos distinto de nulo significa que un mensaje SALIO. Que el baseline los
  // marque como DELIVERED es atrezo de pantalla y no deja ninguna de estas
  // huellas, que es justo lo que las hace la señal correcta.
  anotar('ningún mensaje con wamid de Meta', 0, conWamid);
  anotar('ningún mensaje con marca de envío', 0, conEnvio);
  anotar(
    'ningún mensaje con clave de idempotencia de envío',
    0,
    conClaveExterna,
  );
  anotar('cero ejecuciones de automatización', 0, ejecucionesAuto);
  anotar('cero ejecuciones de bot', 0, ejecucionesBot);
  anotar('cero pruebas de bot', 0, pruebasBot);
  anotar('cero sesiones de chatbot', 0, sesionesChatbot);
  anotar('outbox vacío', 0, outboxTotal);
  anotar('cero outbox pendiente', 0, outboxPendiente);

  const fallos = comprobaciones.filter((c) => !c.ok);
  return {
    companyId: id,
    slug: SLUG_DEMO,
    comprobaciones,
    fallos,
    ok: !fallos.length,
  };
}

function imprimir(informe: Informe): void {
  let grupo = '';
  for (const c of informe.comprobaciones) {
    if (c.grupo !== grupo) {
      grupo = c.grupo;
      console.log(`\n  ${grupo.toUpperCase()}`);
    }
    const marca = c.ok ? '  ok  ' : ' FALLA';
    const detalle = c.ok
      ? ''
      : `  → esperado ${JSON.stringify(c.esperado)}, obtenido ${JSON.stringify(c.obtenido)}`;
    console.log(`  ${marca}  ${c.nombre}${detalle}`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const informe = await verificar(prisma);
    console.log(`Verificación de la empresa demo "${informe.slug}"`);
    if (informe.companyId) console.log(`  companyId : ${informe.companyId}`);
    imprimir(informe);
    console.log('');
    if (informe.ok) {
      console.log(
        `Todo cuadra: ${informe.comprobaciones.length} comprobaciones en verde.`,
      );
      return;
    }
    console.log(
      `${informe.fallos.length} de ${informe.comprobaciones.length} comprobaciones NO cuadran.`,
    );
    console.log('Para dejarla en el baseline: npm run demo:restablecer');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
