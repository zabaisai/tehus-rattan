import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ImportacionDeProductosService } from './import/importacion.service';
import { ImportacionQueue } from './import/importacion.queue';
import { ImportacionProcessor } from './import/importacion.processor';
import { LimpiezaDeImportacionesService } from './import/limpieza-huerfanos.service';
import {
  ALMACENAMIENTO_DE_IMPORTACIONES,
  AlmacenamientoEnDirectorioCompartido,
} from './import/almacenamiento-importaciones';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ImportacionDeProductosService,
    ImportacionQueue,
    // El procesador solo CONSUME cuando el proceso es el worker; en el backend
    // se registra igual pero se queda quieto. Registrarlo condicionalmente
    // obligaria a dos módulos distintos para la misma funcionalidad.
    ImportacionProcessor,
    LimpiezaDeImportacionesService,
    // Un solo sitio decide dónde viven los archivos de importación. El día que
    // esto sea almacenamiento de objetos, se cambia aquí y el motor de
    // importación no se entera.
    {
      provide: ALMACENAMIENTO_DE_IMPORTACIONES,
      useClass: AlmacenamientoEnDirectorioCompartido,
    },
  ],
  exports: [ProductsService, ImportacionDeProductosService],
})
export class ProductsModule {}
