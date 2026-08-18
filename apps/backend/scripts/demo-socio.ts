import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * BASELINE DE LA EMPRESA DEMO PARA UN POSIBLE SOCIO.
 *
 * Dos operaciones, las dos idempotentes y transaccionales:
 *
 *   aprovisionar() crea la empresa si no existe y deja los datos en el
 *                  baseline. Ejecutarlo dos veces no duplica nada.
 *   restaurar()    devuelve EXACTAMENTE al baseline los datos operativos de
 *                  esa empresa, conservando sus dos cuentas.
 *
 * COMO SE ELIGE LA EMPRESA, Y POR QUE ASI. Por `slug` + `isDemo`, nunca por el
 * nombre ni por un prefijo. Un prefijo es texto: alguien renombra la empresa y
 * el borrado deja de encontrarla —o peor, encuentra otra—. El `slug` es unico
 * en la base y `isDemo` es la marca que ademas activa el guardarrail.
 *
 * LO QUE ESTE FICHERO NO HACE NUNCA: borrar por prefijo, truncar tablas,
 * resetear la base ni tocar una fila cuyo `companyId` no sea el de la empresa
 * demo ya resuelta y verificada. Cada borrado va acotado por ese id.
 */

/**
 * Identificador ESTABLE de la empresa demo.
 *
 * Configurable por entorno para que las pruebas puedan crear su propio tenant
 * demo sin tocar el de la maquina: sin esto, una e2e y la demo real comparten
 * fila y la suite acaba borrando lo que alguien estaba enseñando.
 */
export const SLUG_DEMO = process.env.DEMO_SLUG?.trim() || 'demo-socio';
export const PREFIJO = 'DEMO_SOCIO_';
export const DOMINIO_DEMO = 'example.invalid';
const DOMINIO = DOMINIO_DEMO;

/** Rango de pruebas: numeros que no existen y nunca resolveran. */
export const TEL_DEMO = {
  empresa: '+573001990000',
  ana: '+573001990001',
  bruno: '+573001990002',
  carla: '+573001990003',
  diego: '+573001990004',
  elena: '+573001990005',
  archivado: '+573001990006',
};
const TEL = TEL_DEMO;

export interface CuentasDemo {
  adminEmail: string;
  adminPassword: string;
  agentEmail: string;
  agentPassword: string;
}

const MIN_PASSWORD = 8;

/**
 * Los dos CORREOS de la demo, sin pedir contraseñas.
 *
 * Se separo de `validarCuentas` porque restablecer necesita saber QUIENES son
 * las dos cuentas y no debe —ni puede— exigir las claves para averiguarlo: si
 * el comando de restablecer pidiera `DEMO_ADMIN_PASSWORD`, la forma natural de
 * ejecutarlo seria pasarsela, y a partir de ahi «restablecer» reescribiria la
 * contraseña de vez en cuando, que es exactamente lo que no debe pasar.
 */
export function correosDemo(env: NodeJS.ProcessEnv): {
  adminEmail: string;
  agentEmail: string;
} {
  return {
    adminEmail:
      env.DEMO_ADMIN_EMAIL?.trim().toLowerCase() || `admin.demo@${DOMINIO}`,
    agentEmail:
      env.DEMO_AGENT_EMAIL?.trim().toLowerCase() || `asesor.demo@${DOMINIO}`,
  };
}

export function validarCuentas(env: NodeJS.ProcessEnv): CuentasDemo {
  const faltan: string[] = [];
  if (!env.DEMO_ADMIN_PASSWORD) faltan.push('DEMO_ADMIN_PASSWORD');
  if (!env.DEMO_AGENT_PASSWORD) faltan.push('DEMO_AGENT_PASSWORD');
  if (faltan.length) {
    throw new Error(
      `Faltan variables: ${faltan.join(', ')}. Las contraseñas se pasan por ` +
        `entorno y nunca se escriben en el repositorio ni en la documentación.`,
    );
  }
  const adminPassword = env.DEMO_ADMIN_PASSWORD!;
  const agentPassword = env.DEMO_AGENT_PASSWORD!;
  if (
    adminPassword.length < MIN_PASSWORD ||
    agentPassword.length < MIN_PASSWORD
  ) {
    throw new Error(
      `Las contraseñas demo deben tener al menos ${MIN_PASSWORD} caracteres`,
    );
  }
  if (adminPassword === agentPassword) {
    // Son dos identidades independientes: compartir clave las convierte en una
    // sola cuenta con dos nombres, y entonces la matriz de permisos no se
    // puede enseñar.
    throw new Error('ADMIN y AGENT deben tener contraseñas distintas');
  }
  return { ...correosDemo(env), adminPassword, agentPassword };
}

/** Resuelve la empresa demo y COMPRUEBA que lo es antes de devolverla. */
export async function empresaDemo(
  db: Prisma.TransactionClient | PrismaClient,
): Promise<{ id: string; isDemo: boolean } | null> {
  const empresa = await db.company.findUnique({
    where: { slug: SLUG_DEMO },
    select: { id: true, isDemo: true },
  });
  if (!empresa) return null;
  if (!empresa.isDemo) {
    // Cinturon y tirantes: si alguien creara a mano una empresa con este slug
    // sin la marca, no se toca. Nunca se borra algo que no se ha demostrado
    // que es la empresa demo.
    throw new Error(
      `La empresa con slug "${SLUG_DEMO}" existe pero NO está marcada como demo. ` +
        `No se toca nada.`,
    );
  }
  return empresa;
}

/** Crea la empresa y sus dos cuentas si faltan. No pisa nada existente. */
export async function asegurarEmpresaYCuentas(
  prisma: PrismaClient,
  cuentas: CuentasDemo,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const existente = await empresaDemo(tx);
    const empresaId = existente
      ? existente.id
      : (
          await tx.company.create({
            data: {
              // El mismo perfil que repone `restaurarPerfilEmpresa`. Escrito
              // una sola vez: si crear y restablecer tuvieran cada uno su
              // copia, una demo recien aprovisionada y otra recien
              // restablecida podrian no parecerse, y no habria forma de saber
              // cual de las dos es «el baseline».
              ...PERFIL_EMPRESA,
              slug: SLUG_DEMO,
              isDemo: true,
              status: 'ACTIVE',
              // El telefono de empresa es UNICO en toda la base. Solo lo toma el
              // tenant demo canonico; un tenant demo de pruebas (con su propio
              // slug) se queda sin el, que es cosmetico, en vez de chocar.
              ...(SLUG_DEMO === 'demo-socio' ? { phone: TEL.empresa } : {}),
            },
            select: { id: true },
          })
        ).id;

    const [hashAdmin, hashAgent] = await Promise.all([
      bcrypt.hash(cuentas.adminPassword, 10),
      bcrypt.hash(cuentas.agentPassword, 10),
    ]);

    // `upsert` por email: reejecutar actualiza la clave y no crea un segundo
    // usuario. El rol se fija siempre, para que nadie ascienda la cuenta demo
    // editandola a mano y se quede asi.
    await tx.user.upsert({
      where: { email: cuentas.adminEmail },
      create: {
        email: cuentas.adminEmail,
        name: `${PREFIJO}Administradora`,
        password: hashAdmin,
        role: 'ADMIN',
        companyId: empresaId,
      },
      update: { password: hashAdmin, role: 'ADMIN', companyId: empresaId },
    });
    await tx.user.upsert({
      where: { email: cuentas.agentEmail },
      create: {
        email: cuentas.agentEmail,
        name: `${PREFIJO}Asesor`,
        password: hashAgent,
        role: 'AGENT',
        companyId: empresaId,
      },
      update: { password: hashAgent, role: 'AGENT', companyId: empresaId },
    });

    return empresaId;
  });
}

/**
 * PERFIL DE LA EMPRESA DEMO. Fuente unica para crearla y para restablecerla.
 *
 * Estaba escrito solo dentro del `create`, asi que un restablecimiento no
 * tenia contra que comparar: si el socio entra como ADMIN y cambia el nombre
 * comercial, la ciudad o los colores —cosa que el producto le deja hacer, y
 * que ademas es de lo primero que alguien prueba— eso se quedaba puesto para
 * siempre. El baseline no puede depender de que nadie toque los ajustes.
 */
export const PERFIL_EMPRESA = {
  name: `${PREFIJO}Muebles Aurora`,
  email: `contacto@${DOMINIO}`,
  city: 'Ciudad Demo',
  country: 'Colombia',
  businessType: 'Mobiliario',
  description:
    'Empresa de demostración de TAKTO. Todos sus datos son ficticios.',
} as const;

/**
 * Borra SOLO los datos operativos de la empresa demo, en orden de dependencia.
 *
 * Las CUENTAS no se tocan: el incremento pide que restablecer conserve las
 * identidades y regenere unicamente lo que se recorre. Tampoco se toca la fila
 * de la empresa.
 *
 * EL ORDEN NO ES ESTETICO. Varias claves ajenas son `Restrict`
 * —`FlowBotExecution.versionId`, `ChatbotSession.flowVersionId`—, asi que
 * borrar el padre antes que el hijo no deja datos huerfanos: revienta la
 * transaccion entera. Lo dependiente va primero, siempre.
 */
export async function borrarDatosOperativos(
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<void> {
  const dentro = { companyId: empresaId };

  // ── Motor de bots ─────────────────────────────────────────────────────
  //
  // Todo esto faltaba. Un socio con cuenta de ADMIN puede crear un bot,
  // publicarlo y probarlo: son pantallas del producto, no de la plataforma.
  // Quedaba fuera del borrado, de modo que el segundo recorrido de la demo
  // empezaba con los bots del primero.
  await tx.flowBotExecutionStep.deleteMany({ where: { execution: dentro } });
  await tx.flowBotWait.deleteMany({ where: dentro });
  await tx.flowBotMetric.deleteMany({ where: dentro });
  await tx.flowBotTestRun.deleteMany({ where: dentro });
  await tx.flowBotExecution.deleteMany({ where: dentro });
  await tx.flowBotTrigger.deleteMany({ where: { flowBot: dentro } });
  await tx.flowBotVersion.deleteMany({ where: { flowBot: dentro } });
  await tx.flowBot.deleteMany({ where: dentro });
  await tx.flowBotAiUsage.deleteMany({ where: dentro });
  await tx.flowBotCredential.deleteMany({ where: dentro });
  await tx.flowBotSettings.deleteMany({ where: dentro });

  await tx.chatbotSession.deleteMany({ where: dentro });
  await tx.chatbotFlowVersion.deleteMany({ where: { flow: dentro } });
  await tx.chatbotFlow.deleteMany({ where: dentro });

  // ── Conversaciones, oportunidades y su alrededor ──────────────────────
  await tx.message.deleteMany({ where: { conversation: dentro } });
  await tx.note.deleteMany({ where: dentro });
  await tx.taskSuggestion.deleteMany({ where: dentro });
  await tx.task.deleteMany({ where: dentro });
  await tx.quoteItem.deleteMany({ where: { quote: dentro } });
  await tx.quote.deleteMany({ where: dentro });
  await tx.leadProduct.deleteMany({ where: { lead: dentro } });
  await tx.leadStageHistory.deleteMany({ where: { lead: dentro } });
  await tx.conversationRead.deleteMany({ where: { conversation: dentro } });
  await tx.conversationHandoff.deleteMany({ where: dentro });
  await tx.conversation.deleteMany({ where: dentro });
  await tx.lead.deleteMany({ where: dentro });
  await tx.automationRun.deleteMany({ where: { automation: dentro } });
  await tx.automationVersion.deleteMany({ where: { automation: dentro } });
  await tx.automation.deleteMany({ where: dentro });

  // ── Campos propios y contactos ────────────────────────────────────────
  await tx.customFieldValueChange.deleteMany({ where: dentro });
  await tx.customFieldValue.deleteMany({ where: dentro });
  await tx.customFieldDefinition.deleteMany({ where: dentro });
  // Fusiones y descartes de duplicados: apuntan a contactos, y fusionar es
  // justo una de las cosas que se enseñan en la demo.
  await tx.contactMerge.deleteMany({ where: dentro });
  await tx.contactMergeDismissal.deleteMany({ where: dentro });
  await tx.contact.deleteMany({ where: dentro });

  // ── Catalogo y embudo ─────────────────────────────────────────────────
  await tx.productImport.deleteMany({ where: dentro });
  await tx.product.deleteMany({ where: dentro });
  // Antes que el embudo: `CompanyLeadSettings` apunta a etapas y a embudos, y
  // ademas es configuracion que el socio puede cambiar. Se retira entera para
  // que la empresa vuelva a sus valores por defecto.
  await tx.companyLeadSettings.deleteMany({ where: dentro });
  await tx.pipelineStage.deleteMany({ where: { pipeline: dentro } });
  await tx.pipeline.deleteMany({ where: dentro });

  // ── Avisos, solicitudes y canal ───────────────────────────────────────
  await tx.notification.deleteMany({ where: dentro });
  await tx.notificationPreference.deleteMany({ where: dentro });
  await tx.dataRequest.deleteMany({ where: dentro });
  await tx.invitationCode.deleteMany({ where: dentro });
  await tx.whatsAppTemplate.deleteMany({ where: dentro });
  await tx.whatsAppEmbeddedSignupState.deleteMany({ where: dentro });
  // La empresa demo NO tiene canal conectado y no debe tenerlo: es la mitad
  // fisica del guardarrail. Aunque `ModoDemoService` corta el envio, una
  // integracion viva ahi es una credencial guardada que nadie va a usar.
  await tx.whatsAppIntegration.deleteMany({ where: dentro });

  await tx.outboxEvent.deleteMany({ where: dentro });

  // LAS AUDITORIAS REALES NO SE BORRAN NUNCA, tampoco las de la empresa demo:
  // es la regla del proyecto y no tiene excepcion. Si alguien archiva un
  // contacto recorriendo la demo, ese registro se queda. Por lo mismo se
  // conservan `SupportSession`, `LoginEvent` y `UserSession`: son el rastro de
  // quien entro y desde donde, no datos operativos que se recorran.
  //
  // Lo unico que se retira es la actividad SEMBRADA por este baseline, que
  // lleva su propio `entityType` y no es el rastro de nada: es atrezo para
  // que el panel del Inicio tenga algo que enseñar. Regenerarla es lo que
  // hace que restablecer sea determinista en vez de ir acumulando.
  await tx.auditLog.deleteMany({
    where: { affectedCompanyId: empresaId, entityType: 'DEMO_SOCIO_BASELINE' },
  });
}

/**
 * Devuelve el PERFIL de la empresa a su estado aprobado.
 *
 * Los campos opcionales se ponen a `null` a proposito en vez de dejarlos como
 * esten: «restablecer» tiene que deshacer tambien lo que se añadio. Un logo
 * subido durante una demo o un pie de cotizacion escrito a mano seguirian
 * saliendo impresos en la siguiente si esto solo reescribiera lo que existe.
 *
 * `slug` no se toca —es la llave por la que se resuelve la empresa— y `phone`
 * solo en el tenant demo canonico, porque es UNICO en toda la base y un
 * tenant demo de pruebas no debe disputarselo.
 */
export async function restaurarPerfilEmpresa(
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<void> {
  await tx.company.update({
    where: { id: empresaId },
    data: {
      ...PERFIL_EMPRESA,
      // La marca se REAFIRMA en cada restablecimiento. Es lo que bloquea los
      // efectos externos: dejarla a merced de un `update` suelto seria dejar
      // el guardarrail a merced de un `update` suelto.
      isDemo: true,
      status: 'ACTIVE',
      ...(SLUG_DEMO === 'demo-socio' ? { phone: TEL.empresa } : {}),

      logoUrl: null,
      secondaryLogoUrl: null,
      primaryColor: null,
      accentColor: null,
      backgroundColor: null,
      website: null,
      settings: Prisma.DbNull,

      legalName: null,
      taxId: null,
      address: null,
      quoteFooter: null,

      timezone: 'America/Bogota',
      currency: 'COP',
      locale: 'es-CO',
      quoteRoundingDecimals: 0,
      defaultTaxRate: new Prisma.Decimal(0),
      taxIncluded: false,
      businessHours: Prisma.DbNull,

      autoAssignEnabled: true,
      responseSlaMinutes: null,
      retentionMonths: null,
      retentionPurgeEnabled: false,
    },
  });
}

export interface CuentaDemoResuelta {
  id: string;
  email: string;
  password: string;
  role: string;
}

/**
 * QUIENES son las dos cuentas de la demo, resistiendo que las hayan editado.
 *
 * Resolverlas solo por ROL —que es lo que hacia antes— parece obvio y se rompe
 * con el primer recorrido de verdad: el ADMIN de la demo PUEDE cambiar roles,
 * es una pantalla del producto y se enseña. En cuanto alguien asciende al
 * asesor, la empresa se queda sin ningun AGENT, el comando no encuentra su
 * segunda cuenta y falla justo el dia que hacia falta restablecer.
 *
 * El orden de los anclajes va del mas estable al mas debil:
 *
 *   1. EL CORREO. Es la identidad con la que se entra y lo que el operador
 *      tiene apuntado junto a la contraseña. Sobrevive a un cambio de rol y a
 *      un cambio de nombre.
 *   2. EL ROL. Si alguien cambio el correo, sirve mientras los roles esten
 *      donde deben.
 *   3. EL ORDEN DE CREACION. Ultimo recurso, con desempate por `id` para que
 *      sea determinista aunque las dos filas compartan `createdAt` —que es lo
 *      normal: se crean en la MISMA transaccion, y en PostgreSQL `now()` es la
 *      hora de inicio de la transaccion, identica para ambas—.
 *
 * Si no hay dos cuentas, falla: inventarse una es como un comando de reinicio
 * acaba creando accesos.
 */
export async function resolverCuentasDemo(
  db: Prisma.TransactionClient | PrismaClient,
  empresaId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ admin: CuentaDemoResuelta; asesor: CuentaDemoResuelta }> {
  const usuarios = await db.user.findMany({
    where: { companyId: empresaId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, email: true, password: true, role: true },
  });
  if (usuarios.length < 2) {
    throw new Error(
      `La empresa demo tiene ${usuarios.length} cuenta(s); necesita ADMIN y AGENT. ` +
        `Ejecuta: npm run demo:aprovisionar`,
    );
  }

  const { adminEmail, agentEmail } = correosDemo(env);
  const admin =
    usuarios.find((u) => u.email.toLowerCase() === adminEmail) ??
    usuarios.find((u) => u.role === 'ADMIN') ??
    usuarios[0];
  const restantes = usuarios.filter((u) => u.id !== admin.id);
  const asesor =
    restantes.find((u) => u.email.toLowerCase() === agentEmail) ??
    restantes.find((u) => u.role === 'AGENT') ??
    restantes[0];

  return { admin, asesor };
}

/**
 * Deja la empresa demo con EXACTAMENTE sus dos cuentas.
 *
 * El ADMIN de la demo puede invitar a mas gente: es una pantalla del producto
 * y se enseña. Sin esto, la tercera cuenta creada en un recorrido seguia
 * dentro en el siguiente, y «2 usuarios» dejaba de ser cierto.
 *
 * LO QUE NO TOCA, Y ES EL PUNTO: `password`, `email` e `id` de las dos cuentas
 * conservadas. La contraseña vigente es la que el operador tiene apuntada; un
 * restablecimiento que la cambiara dejaria la demo inaccesible justo cuando
 * hay alguien esperando para verla. El nombre y el rol si se reponen, porque
 * son parte de lo que se enseña y el propio ADMIN puede haberlos cambiado.
 */
export async function retirarUsuariosExtra(
  tx: Prisma.TransactionClient,
  empresaId: string,
  adminId: string,
  asesorId: string,
): Promise<number> {
  const sobrantes = await tx.user.findMany({
    where: { companyId: empresaId, id: { notIn: [adminId, asesorId] } },
    select: { id: true },
  });
  const ids = sobrantes.map((u) => u.id);

  if (ids.length) {
    // `InvitationCode.createdBy` es obligatorio y `Restrict`: sin retirar
    // antes los codigos que creo la cuenta sobrante, el borrado del usuario
    // tumba la transaccion entera.
    await tx.invitationCode.deleteMany({
      where: { createdByUserId: { in: ids } },
    });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  }

  await tx.user.update({
    where: { id: adminId },
    data: { name: `${PREFIJO}Administradora`, role: 'ADMIN' },
  });
  await tx.user.update({
    where: { id: asesorId },
    data: { name: `${PREFIJO}Asesor`, role: 'AGENT' },
  });

  return ids.length;
}
