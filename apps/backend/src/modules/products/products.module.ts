import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ImportacionDeProductosService } from './import/importacion.service';
import { ImportacionQueue } from './import/importacion.queue';
import { ImportacionProcessor } from './import/importacion.processor';

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
  ],
  exports: [ProductsService, ImportacionDeProductosService],
})
export class ProductsModule {}
