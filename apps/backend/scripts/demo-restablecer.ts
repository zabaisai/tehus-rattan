import { PrismaClient } from '@prisma/client';
import {
  SLUG_DEMO,
  empresaDemo,
  resolverCuentasDemo,
  borrarDatosOperativos,
  restaurarPerfilEmpresa,
  retirarUsuariosExtra,
} from './demo-socio';
import { sembrarBaseline } from './demo-socio-baseline';
import { verificar, Informe } from './demo-verificar';

/**
 * RESTABLECE la empresa demo a su baseline aprobado, y solo ella.
 *
 * Es el comando que se ejecuta entre una demo y la siguiente. Da igual lo que
 * haya hecho el socio en la anterior —crear contactos, editar la ficha de la
 * empresa, archivar media bandeja, mover oportunidades de etapa, invitar a un
 * compañero, dejar un bot a medio construir—: al terminar esto, lo que hay es
 * exactamente el baseline.
 *
 * COMO SE ELIGE A QUIEN TOCAR, Y POR QUE NO SE PUEDE ELEGIR MAL. No acepta
 * ningun argumento que diga a quien borrar. La empresa se resuelve por su
 * `slug` UNICO y se exige que `isDemo` sea cierto; si existe una empresa con
 * ese slug sin la marca, esto NO TOCA NADA y falla. Todos los borrados van
 * acotados por el `companyId` ya resuelto y verificado: no hay un solo
 * `deleteMany` por prefijo de nombre, ni `TRUNCATE`, ni `migrate reset`. Las
 * empresas `PREVIEW_BRANDING_`, `QA_MERGE_`, `QA_INBOX_` y `QA_CONTACTS_`
 * —que son eso, prefijos de NOMBRE— quedan fuera por construccion, no porque
 * se las excluya en una lista que alguien tendria que acordarse de ampliar.
 *
 * EN UNA SOLA TRANSACCION. Borrar y sembrar por separado deja una ventana en
 * la que la demo esta vacia; si el proceso muere justo ahi, lo que queda no es
 * ni lo viejo ni el baseline. O se aplica entero o no se aplica.
 *
 * LAS CONTRASEÑAS NO SE TOCAN. Ni se leen para reescribirlas, ni se piden por
 * entorno: `retirarUsuariosExtra` conserva `id`, `email` y `password` de las
 * dos cuentas. Ademas se COMPRUEBA despues, comparando el hash de antes con el
 * de despues, porque «no deberia haberlas tocado» y «no las toco» no son la
 * misma afirmacion.
 *
 * CERO EFECTOS EXTERNOS. Este fichero importa PrismaClient y nada mas: no
 * levanta la aplicacion Nest, no abre Redis, no encola en BullMQ, no
 * instancia el transporte de WhatsApp ni el de correo. No hay ninguna ruta
 * por la que pueda salir un mensaje, un correo o un webhook. Y la empresa
 * queda con `isDemo` reafirmado, que es lo que corta los envios tambien
 * DESPUES, cuando la aplicacion vuelva a leerla.
 *
 * TERMINA VERIFICANDO. Restablecer y despues decir «hecho» sin mirar es la
 * forma habitual de descubrir el problema delante del socio. Al final se
 * ejecuta el verificador de solo lectura y, si algo no cuadra, el comando
 * falla con la lista de lo que no cuadra.
 *
 * Uso:
 *   npm run demo:restablecer
 */

export interface ResultadoRestablecer {
  companyId: string;
  adminId: string;
  asesorId: string;
  usuariosRetirados: number;
  informe: Informe;
}

export async function restablecer(
  prisma: PrismaClient,
): Promise<ResultadoRestablecer> {
  const empresa = await empresaDemo(prisma);
  if (!empresa) {
    throw new Error(
      `No existe ninguna empresa con slug "${SLUG_DEMO}". ` +
        `Ejecuta primero: npm run demo:aprovisionar`,
    );
  }

  // Por correo primero, por rol despues, por antigüedad como ultimo recurso:
  // el socio pudo haberse cambiado el rol durante el recorrido, y esa edicion
  // no puede dejar la demo sin forma de volver a su sitio.
  const { admin, asesor } = await resolverCuentasDemo(prisma, empresa.id);

  let usuariosRetirados = 0;
  await prisma.$transaction(async (tx) => {
    // Se REVERIFICA dentro de la transaccion. Entre la comprobacion de arriba
    // y este punto nadie deberia haber quitado la marca, pero borrar no se
    // hace sobre una comprobacion de hace un rato.
    const dentro = await empresaDemo(tx);
    if (!dentro || dentro.id !== empresa.id) {
      throw new Error('La empresa demo cambió durante el restablecimiento');
    }

    await borrarDatosOperativos(tx, dentro.id);
    // Despues del borrado: las filas que apuntaban a una cuenta sobrante ya no
    // existen, asi que retirarla no tropieza con una clave ajena.
    usuariosRetirados = await retirarUsuariosExtra(
      tx,
      dentro.id,
      admin.id,
      asesor.id,
    );
    await restaurarPerfilEmpresa(tx, dentro.id);
    await sembrarBaseline(tx, dentro.id, admin.id, asesor.id);
  });

  // La comprobacion que convierte la promesa en un hecho. Se comparan los
  // HASHES, nunca las contraseñas, que este proceso no conoce ni necesita.
  const despues = await prisma.user.findMany({
    where: { id: { in: [admin.id, asesor.id] } },
    select: { id: true, email: true, password: true, role: true },
  });
  for (const anterior of [admin, asesor]) {
    const ahora = despues.find((u) => u.id === anterior.id);
    if (!ahora) {
      throw new Error(
        `El restablecimiento perdió la cuenta ${anterior.email}. ` +
          `Es un fallo del comando, no del baseline.`,
      );
    }
    if (
      ahora.password !== anterior.password ||
      ahora.email !== anterior.email
    ) {
      throw new Error(
        `El restablecimiento cambió las credenciales de ${anterior.email}. ` +
          `Es un fallo del comando, no del baseline.`,
      );
    }
  }

  const informe = await verificar(prisma);
  return {
    companyId: empresa.id,
    adminId: admin.id,
    asesorId: asesor.id,
    usuariosRetirados,
    informe,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await restablecer(prisma);
    console.log('Empresa demo restablecida al baseline.');
    console.log(`  slug            : ${SLUG_DEMO}`);
    console.log(`  companyId       : ${r.companyId}`);
    console.log(`  cuentas         : conservadas (id, correo y contraseña)`);
    if (r.usuariosRetirados) {
      console.log(`  cuentas de más  : ${r.usuariosRetirados} retirada(s)`);
    }
    console.log(
      `  verificación    : ${r.informe.comprobaciones.length - r.informe.fallos.length}/${r.informe.comprobaciones.length}`,
    );

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
