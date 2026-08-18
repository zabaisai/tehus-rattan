import { PrismaClient } from '@prisma/client';
import { SLUG_DEMO, empresaDemo, borrarDatosOperativos } from './demo-socio';
import { sembrarBaseline } from './demo-socio-baseline';
import { contar } from './demo-aprovisionar';

/**
 * RESTAURA la empresa demo a su baseline, y solo ella.
 *
 * Lo que hace: borra los datos OPERATIVOS de esa empresa y los vuelve a
 * sembrar. Lo que NO hace, y es lo que lo vuelve seguro:
 *
 *   · no acepta ningun argumento que diga a quien borrar — la empresa se
 *     resuelve por `slug` unico y se verifica que `isDemo` sea cierto;
 *   · no borra por prefijo de nombre: todos los `deleteMany` van acotados por
 *     el `companyId` ya resuelto;
 *   · no hace `TRUNCATE`, ni `migrate reset`, ni toca otra empresa;
 *   · CONSERVA las dos cuentas demo y la fila de la empresa;
 *   · no borra auditorias, ni las suyas.
 *
 * Si no existe la empresa demo, no crea nada: falla y remite a aprovisionar.
 * Restaurar algo que no se ha aprovisionado no tiene un resultado obvio, y
 * adivinarlo es como un comando de reinicio acaba creando datos.
 *
 * Uso:
 *   npm run demo:restaurar
 *
 * No necesita contraseñas: las cuentas no se tocan.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const empresa = await empresaDemo(prisma);
    if (!empresa) {
      throw new Error(
        `No existe ninguna empresa con slug "${SLUG_DEMO}". ` +
          `Ejecuta primero: npm run demo:aprovisionar`,
      );
    }

    const [admin, asesor] = await Promise.all([
      prisma.user.findFirst({
        where: { companyId: empresa.id, role: 'ADMIN' },
        select: { id: true, email: true },
      }),
      prisma.user.findFirst({
        where: { companyId: empresa.id, role: 'AGENT' },
        select: { id: true, email: true },
      }),
    ]);
    if (!admin || !asesor) {
      throw new Error(
        'La empresa demo no tiene sus dos cuentas (ADMIN y AGENT). ' +
          'Ejecuta: npm run demo:aprovisionar',
      );
    }

    const antes = await contar(prisma, empresa.id);

    await prisma.$transaction(async (tx) => {
      // Reverificacion dentro de la transaccion, por lo mismo que en el
      // aprovisionamiento: no se borra sobre una comprobacion de hace un rato.
      const dentro = await empresaDemo(tx);
      if (!dentro || dentro.id !== empresa.id) {
        throw new Error('La empresa demo cambió durante la restauración');
      }
      await borrarDatosOperativos(tx, dentro.id);
      await sembrarBaseline(tx, dentro.id, admin.id, asesor.id);
    });

    const despues = await contar(prisma, empresa.id);
    console.log('Empresa demo restaurada al baseline.');
    console.log(`  companyId : ${empresa.id}`);
    console.log('  antes     :', JSON.stringify(antes));
    console.log('  después   :', JSON.stringify(despues));
    console.log(`  cuentas conservadas: ${admin.email} · ${asesor.email}`);
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
