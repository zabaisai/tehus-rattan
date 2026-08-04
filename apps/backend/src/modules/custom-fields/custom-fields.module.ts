import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

/**
 * Campos personalizados.
 *
 * Se exporta el servicio porque lo usa el adaptador de CRM de FlowBot: un
 * nodo «establecer campo» escribe por el MISMO camino que la API, con las
 * mismas validaciones y el mismo historial. Tener dos rutas de escritura es
 * como acaban divergiendo las reglas hasta que un bot puede guardar lo que
 * un formulario rechaza.
 */
@Module({
  imports: [PlatformModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
