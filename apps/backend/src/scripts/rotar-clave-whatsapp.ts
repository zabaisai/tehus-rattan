/**
 * Herramienta de rotación de `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
 *
 * Se ejecuta a mano contra el entorno ya configurado. NUNCA imprime el token
 * ni la clave: solo recuentos e identificadores de integración.
 *
 *   node dist/src/scripts/rotar-clave-whatsapp estado
 *   node dist/src/scripts/rotar-clave-whatsapp recifrar
 *   node dist/src/scripts/rotar-clave-whatsapp comprobar
 *
 * El procedimiento completo está en `docs/ROTACION-CLAVE-WHATSAPP.md`.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { TokenRotationService } from '../modules/whatsapp-integration/token-rotation.service';

const ORDENES = ['estado', 'recifrar', 'comprobar'] as const;

async function main() {
  const log = new Logger('RotacionClave');
  const orden = process.argv[2];

  if (!ORDENES.includes(orden as (typeof ORDENES)[number])) {
    log.error(`Uso: ${ORDENES.join(' | ')}`);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const rotacion = app.get(TokenRotationService);

  try {
    if (orden === 'estado') {
      const estado = await rotacion.estado();
      log.log(JSON.stringify(estado, null, 2));
      // Código de salida 1 si hay algo ilegible: así el script se encadena en
      // un procedimiento sin que un problema pase inadvertido.
      if (estado.ilegibles > 0) process.exitCode = 1;
    }

    if (orden === 'recifrar') {
      const resultado = await rotacion.recifrar();
      log.log(JSON.stringify(resultado, null, 2));
      if (resultado.fallidas > 0 || resultado.ilegibles > 0) {
        process.exitCode = 1;
      }
    }

    if (orden === 'comprobar') {
      const veredicto = await rotacion.sePuedeRetirarLaClaveAnterior();
      log.log(veredicto.motivo);
      if (!veredicto.seguro) process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // Solo el tipo de error: el mensaje de un fallo de cifrado puede arrastrar
  // material del propio token.
  new Logger('RotacionClave').error(
    `Falló la rotación [${error instanceof Error ? error.name : 'Error'}]`,
  );
  process.exitCode = 1;
});
