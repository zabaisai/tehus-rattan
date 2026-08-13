import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsEliminacionService } from './contacts-eliminacion.service';
import { PerfilComercialService } from './perfil-comercial.service';
import { ContactsController } from './contacts.controller';
import { FusionContactosController } from './fusion/fusion.controller';
import { FusionContactosService } from './fusion/fusion.service';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';

@Module({
  // `ContactsController` primero: tiene `GET :id`, y las rutas de la fusión
  // están escritas con dos segmentos justamente para que ese orden no importe.
  controllers: [ContactsController, FusionContactosController],
  providers: [
    ContactsService,
    ContactsEliminacionService,
    PerfilComercialService,
    FusionContactosService,
    PlatformAuditLogService,
  ],
  exports: [ContactsService, FusionContactosService],
})
export class ContactsModule {}
