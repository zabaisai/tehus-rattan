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
  return {
    adminEmail:
      env.DEMO_ADMIN_EMAIL?.trim().toLowerCase() || `admin.demo@${DOMINIO}`,
    agentEmail:
      env.DEMO_AGENT_EMAIL?.trim().toLowerCase() || `asesor.demo@${DOMINIO}`,
    adminPassword,
    agentPassword,
  };
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
              name: `${PREFIJO}Muebles Aurora`,
              slug: SLUG_DEMO,
              isDemo: true,
              status: 'ACTIVE',
              phone: TEL.empresa,
              email: `contacto@${DOMINIO}`,
              city: 'Ciudad Demo',
              country: 'Colombia',
              businessType: 'Mobiliario',
              description:
                'Empresa de demostración de TAKTO. Todos sus datos son ficticios.',
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
 * Borra SOLO los datos operativos de la empresa demo, en orden de dependencia.
 *
 * Las CUENTAS no se tocan: el incremento pide que restaurar conserve las
 * identidades y regenere unicamente lo que se recorre. Tampoco se toca la fila
 * de la empresa.
 */
export async function borrarDatosOperativos(
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<void> {
  const dentro = { companyId: empresaId };

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
  await tx.customFieldValue.deleteMany({ where: dentro });
  await tx.customFieldDefinition.deleteMany({ where: dentro });
  await tx.contact.deleteMany({ where: dentro });
  await tx.product.deleteMany({ where: dentro });
  await tx.pipelineStage.deleteMany({ where: { pipeline: dentro } });
  await tx.pipeline.deleteMany({ where: dentro });
  await tx.outboxEvent.deleteMany({ where: dentro });

  // Las AUDITORIAS no se borran nunca, ni siquiera las de la empresa demo:
  // es la regla del proyecto y no tiene excepcion aqui.
}
