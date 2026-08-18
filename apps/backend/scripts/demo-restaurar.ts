import { PrismaClient } from '@prisma/client';
import { SLUG_DEMO } from './demo-socio';
import { restablecer } from './demo-restablecer';
import { contar } from './demo-aprovisionar';

/**
 * ALIAS DE `demo:restablecer`. El nombre anterior del mismo comando.
 *
 * POR QUE NO SE HA BORRADO: esta escrito en el documento de estado y en las
 * notas de quien opera la demo. Un comando que un dia deja de existir se
 * descubre a las malas, y normalmente el dia que hay prisa.
 *
 * POR QUE NO TIENE LOGICA PROPIA, QUE ES LO IMPORTANTE: antes SI la tenia, una
 * copia casi igual de la de restablecer. «Casi» es el problema. Cuando el
 * borrado se amplio para llevarse tambien los bots, el chatbot, las
 * notificaciones y el perfil editado de la empresa, una de las dos copias se
 * habria quedado atras, y entonces «restaurar» y «restablecer» dejarian la
 * demo en dos estados distintos con el mismo nombre. Hay una implementacion y
 * esto la llama.
 *
 * Uso:
 *   npm run demo:restaurar     (equivalente a npm run demo:restablecer)
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(
      'Nota: «demo:restaurar» es ahora un alias de «demo:restablecer».',
    );
    const r = await restablecer(prisma);
    const resumen = await contar(prisma, r.companyId);

    console.log('Empresa demo restablecida al baseline.');
    console.log(`  slug      : ${SLUG_DEMO}`);
    console.log(`  companyId : ${r.companyId}`);
    console.log('  baseline  :', JSON.stringify(resumen));
    console.log('  cuentas conservadas: id, correo y contraseña intactos');

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

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
