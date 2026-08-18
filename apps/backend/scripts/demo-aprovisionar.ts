import { PrismaClient } from '@prisma/client';
import {
  SLUG_DEMO,
  validarCuentas,
  asegurarEmpresaYCuentas,
} from './demo-socio';
import { restablecer } from './demo-restablecer';

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

    // PRIMER PASO: la empresa y sus dos cuentas, con las claves del entorno.
    // Es lo unico que aprovisionar hace y restablecer no: aqui SI se fijan las
    // contraseñas, porque es el momento en que se crean.
    const empresaId = await asegurarEmpresaYCuentas(prisma, cuentas);

    // SEGUNDO PASO: exactamente el mismo camino que `demo:restablecer`.
    //
    // Antes esto tenia su propia copia del borrado y del sembrado, y una copia
    // se queda atras: aprovisionar y restablecer podian dejar la demo en dos
    // estados que se parecen pero no son iguales, y ninguno de los dos seria
    // «el baseline». Una implementacion, dos puertas de entrada.
    const r = await restablecer(prisma);
    if (r.companyId !== empresaId) {
      throw new Error('La empresa demo cambió durante el aprovisionamiento');
    }

    const resumen = await contar(prisma, empresaId);
    console.log('Empresa demo aprovisionada.');
    console.log(`  slug        : ${SLUG_DEMO}`);
    console.log(`  companyId   : ${empresaId}`);
    console.log(`  ADMIN       : ${cuentas.adminEmail}`);
    console.log(`  AGENT       : ${cuentas.agentEmail}`);
    console.log('  baseline    :', JSON.stringify(resumen));
    console.log(
      `  verificación: ${r.informe.comprobaciones.length - r.informe.fallos.length}/${r.informe.comprobaciones.length}`,
    );
    console.log('  (las contraseñas no se imprimen: salieron del entorno)');

    if (!r.informe.ok) {
      console.error('\nEl baseline NO quedó como debe:');
      for (const f of r.informe.fallos) {
        console.error(
          `  FALLA  ${f.nombre}  → esperado ${JSON.stringify(f.esperado)}, ` +
            `obtenido ${JSON.stringify(f.obtenido)}`,
        );
      }
      process.exitCode = 1;
    }
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
