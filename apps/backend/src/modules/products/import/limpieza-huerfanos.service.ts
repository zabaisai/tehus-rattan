import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { shouldRunScheduledJobs } from '../../../common/scheduling/scheduling.role';
import {
  ALMACENAMIENTO_DE_IMPORTACIONES,
  AlmacenamientoEnDirectorioCompartido,
} from './almacenamiento-importaciones';
// `import type` obligatorio: el tipo aparece en una firma decorada y con
// `emitDecoratorMetadata` TypeScript intentaria emitirlo como valor.
import type { AlmacenamientoDeImportaciones } from './almacenamiento-importaciones';

/**
 * EDAD MINIMA ANTES DE BORRAR UN ARCHIVO HUERFANO.
 *
 * Generosa a proposito. Una importacion que fallo puede reintentarse mientras
 * su archivo siga ahi, y borrar a las dos horas convertiria un fallo
 * recuperable en una subida perdida. Ocupar disco un dia mas es mas barato que
 * obligar a alguien a volver a subir un catalogo de 50 MB.
 */
const EDAD_MINIMA_MS = 24 * 60 * 60_000;

/**
 * Barre los archivos de importacion que ya no sirve a nadie.
 *
 * Habia una funcion que hacia esto y NO ESTABA CONECTADA A NADA: el barrido
 * existia en el codigo y no se ejecutaba nunca. Un worker que muere a mitad
 * dejaba su archivo en el volumen para siempre.
 *
 * Corre en el WORKER, no en el backend: backend y worker comparten imagen y
 * registrarian el mismo `@Cron`, y dos procesos barriendo el mismo directorio
 * a la vez es trabajo duplicado sin necesidad. `shouldRunScheduledJobs` ya
 * resuelve esa eleccion para todo el proyecto.
 */
@Injectable()
export class LimpiezaDeImportacionesService {
  private readonly logger = new Logger(LimpiezaDeImportacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(ALMACENAMIENTO_DE_IMPORTACIONES)
    private readonly almacenamiento: AlmacenamientoDeImportaciones = new AlmacenamientoEnDirectorioCompartido(),
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async barrer(): Promise<{ borrados: number; referenciasLimpiadas: number }> {
    if (!shouldRunScheduledJobs()) {
      return { borrados: 0, referenciasLimpiadas: 0 };
    }
    return this.ejecutar();
  }

  /**
   * Separado del `@Cron` para poder probarlo sin esperar a las cuatro de la
   * mañana ni depender de la variable que decide quien corre los programados.
   */
  async ejecutar(
    edadMinimaMs = EDAD_MINIMA_MS,
    ahora = Date.now(),
  ): Promise<{ borrados: number; referenciasLimpiadas: number }> {
    const { borrados } = await this.almacenamiento.limpiarHuerfanos(
      edadMinimaMs,
      ahora,
    );

    // Y AL REVES: filas que apuntan a un archivo que ya no esta.
    //
    // Dejar la referencia colgando hace que la pantalla ofrezca reintentar una
    // importacion cuyo archivo se barrio, y el reintento falle con un mensaje
    // que no explica nada. Se limpia la referencia, NO la fila: el historial de
    // que esa importacion existio se conserva.
    const terminadas = await this.prisma.productImport.findMany({
      where: {
        tempPath: { not: null },
        status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
      },
      select: { id: true, tempPath: true },
      take: 500,
    });

    let referenciasLimpiadas = 0;
    for (const imp of terminadas) {
      if (!imp.tempPath) continue;
      if (await this.almacenamiento.existe(imp.tempPath)) {
        // Terminada pero con archivo: lo borra y suelta la referencia.
        await this.almacenamiento.eliminar(imp.tempPath);
      }
      await this.prisma.productImport
        .update({ where: { id: imp.id }, data: { tempPath: null } })
        .catch(() => undefined);
      referenciasLimpiadas++;
    }

    if (borrados > 0 || referenciasLimpiadas > 0) {
      // Sin nombres de archivo originales ni contenido: un registro de limpieza
      // no es sitio para el catalogo de nadie.
      this.logger.log(
        `Limpieza de importaciones: ${borrados} archivos borrados, ${referenciasLimpiadas} referencias liberadas.`,
      );
    }

    return { borrados, referenciasLimpiadas };
  }
}
