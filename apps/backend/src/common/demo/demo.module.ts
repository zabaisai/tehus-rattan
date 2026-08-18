import { Global, Module } from '@nestjs/common';
import { ModoDemoService } from './modo-demo.service';

/**
 * Global a propósito: el guardarraíl de demo se comprueba en sitios que no
 * comparten módulo —WhatsApp, correo, integraciones, motor de Pulso—, y
 * hacer que cada uno lo importe convierte «olvidarse de importarlo» en
 * «efecto externo desde la empresa demo».
 */
@Global()
@Module({
  providers: [ModoDemoService],
  exports: [ModoDemoService],
})
export class DemoModule {}
