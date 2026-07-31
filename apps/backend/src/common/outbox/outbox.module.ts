import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxDispatcher } from './outbox.dispatcher';

/**
 * Outbox transaccional. Global porque cualquier módulo de negocio que escriba
 * un cambio esencial necesita registrar su evento en la misma transacción.
 */
@Global()
@Module({
  providers: [OutboxService, OutboxDispatcher],
  exports: [OutboxService],
})
export class OutboxModule {}
