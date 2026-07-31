import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { RELEASE_INFO } from './common/release/release.info';

/**
 * Punto de arranque del WORKER de la cola durable.
 *
 * Es un proceso separado del API a propósito: un job pesado no puede robarle
 * CPU al hilo que atiende los webhooks de Meta, que exigen un ack rápido.
 *
 * Arranca el mismo AppModule pero como contexto de aplicación, SIN servidor
 * HTTP: no escucha ningún puerto, no expone endpoints y no necesita CORS ni
 * cabeceras de seguridad. Compartir módulo garantiza que worker y API usen
 * exactamente los mismos servicios y el mismo cliente de Prisma, en vez de
 * dos implementaciones que puedan divergir.
 *
 * `enableShutdownHooks` es lo que permite que un job en vuelo termine cuando
 * llega SIGTERM, en lugar de morir a mitad y reintentarse duplicando efectos.
 */
async function bootstrapWorker() {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });

  app.enableShutdownHooks();

  logger.log(
    `Worker de cola iniciado (release ${RELEASE_INFO.sha}, built ${RELEASE_INFO.builtAt})`,
  );

  // El proceso queda vivo mientras los procesadores de BullMQ escuchen. No se
  // hace `app.close()` aquí: lo dispara la señal del contenedor.
  const cerrar = async (senal: string) => {
    logger.log(`Recibido ${senal}: cerrando worker y drenando trabajos`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void cerrar('SIGTERM'));
  process.on('SIGINT', () => void cerrar('SIGINT'));
}

bootstrapWorker().catch((err) => {
  new Logger('Worker').error('Fallo fatal al arrancar el worker', err as Error);
  process.exitCode = 1;
});
