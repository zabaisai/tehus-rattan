import { PrismaClient } from '@prisma/client';
import {
  SLUG_DEMO,
  validarCuentas,
  asegurarEmpresaYCuentas,
  empresaDemo,
  borrarDatosOperativos,
} from './demo-socio';
import { sembrarBaseline } from './demo-socio-baseline';

/**
 * APROVISIONA la empresa demo y la deja en el baseline.
 *
 * Idempotente: ejecutarlo dos veces no duplica nada. La empresa y las dos
 * cuentas se aseguran con `upsert`; los datos operativos se regeneran, que es
 * lo que hace que el resultado sea siempre el mismo.
 *
 * Transaccional: si algo falla a mitad, no queda una demo a medio sembrar.
 *
 * Uso:
 *   DEMO_ADMIN_PASSWORD=... DEMO_AGENT_PASSWORD=... \
 *     npm run demo:aprovisionar
 *
 * Las contraseñas SOLO entran por entorno. Este script no las imprime nunca.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const cuentas = validarCuentas(process.env);

    const empresaId = await asegurarEmpresaYCuentas(prisma, cuentas);

    const admin = await prisma.user.findUnique({
      where: { email: cuentas.adminEmail },
      select: { id: true },
    });
    const asesor = await prisma.user.findUnique({
      where: { email: cuentas.agentEmail },
      select: { id: true },
    });
    if (!admin || !asesor)
      throw new Error('No se pudieron resolver las cuentas demo');

    await prisma.$transaction(async (tx) => {
      // Se vuelve a comprobar DENTRO de la transaccion: entre el `asegurar` y
      // este punto nadie deberia haber tocado la marca, pero borrar es lo que
      // no se hace sobre una suposicion.
      const empresa = await empresaDemo(tx);
      if (!empresa || empresa.id !== empresaId) {
        throw new Error('La empresa demo cambió durante el aprovisionamiento');
      }
      await borrarDatosOperativos(tx, empresa.id);
      await sembrarBaseline(tx, empresa.id, admin.id, asesor.id);
    });

    const resumen = await contar(prisma, empresaId);
    console.log('Empresa demo aprovisionada.');
    console.log(`  slug        : ${SLUG_DEMO}`);
    console.log(`  companyId   : ${empresaId}`);
    console.log(`  ADMIN       : ${cuentas.adminEmail}`);
    console.log(`  AGENT       : ${cuentas.agentEmail}`);
    console.log('  baseline    :', JSON.stringify(resumen));
    console.log('  (las contraseñas no se imprimen: salieron del entorno)');
  } finally {
    await prisma.$disconnect();
  }
}

export async function contar(prisma: PrismaClient, companyId: string) {
  const [
    contactos,
    archivados,
    conversaciones,
    mensajes,
    oportunidades,
    tareas,
    productos,
    cotizaciones,
    automatizaciones,
    ejecucionesAutomatizacion,
    usuarios,
  ] = await Promise.all([
    prisma.contact.count({ where: { companyId, archivedAt: null } }),
    prisma.contact.count({ where: { companyId, archivedAt: { not: null } } }),
    prisma.conversation.count({ where: { companyId } }),
    prisma.message.count({ where: { conversation: { companyId } } }),
    prisma.lead.count({ where: { companyId } }),
    prisma.task.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.quote.count({ where: { companyId } }),
    prisma.automation.count({ where: { companyId } }),
    prisma.automationRun.count({ where: { automation: { companyId } } }),
    prisma.user.count({ where: { companyId } }),
  ]);
  return {
    contactosActivos: contactos,
    contactosArchivados: archivados,
    conversaciones,
    mensajes,
    oportunidades,
    tareas,
    productos,
    cotizaciones,
    automatizaciones,
    ejecucionesAutomatizacion,
    usuarios,
  };
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
