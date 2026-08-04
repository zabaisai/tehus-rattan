import { Module } from '@nestjs/common';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';
import { TransporteWhatsAppFalso } from './engine/adapters/flowbot.whatsapp.fake-transport';
import { FlowBotQueueService } from './engine/flowbot.queue';
import { FlowBotSelectorService } from './engine/flowbot.selector';
import { FlowBotRunnerService } from './engine/flowbot.runner';
import { FlowBotProcessor } from './engine/flowbot.processor';
import { FlowBotEffectsFactory } from './engine/flowbot.effects.factory';
import { FlowBotOutboxPublisher } from './engine/flowbot.outbox';
import { FlowBotIntakeService } from './engine/flowbot.intake';
import { FlowBotReconcilerService } from './engine/flowbot.reconciler';
import { FlowBotAdminController } from './flowbot-admin.controller';

/**
 * Modulo de FlowBot.
 *
 * El consumidor (`FlowBotProcessor`) se declara aqui pero solo abre la cola en
 * el proceso worker: `shouldConsumeQueue()` lo decide. Registrarlo en los dos
 * procesos haria que cada trabajo se procesara dos veces.
 *
 * El publicador (`FlowBotOutboxPublisher`) SI corre en los dos: es lo que
 * convierte los eventos del outbox en trabajos de cola, y si solo corriera en
 * el worker, un worker caido dejaria los eventos acumulandose sin que nadie los
 * despachara. Es seguro porque el despachador reclama con SKIP LOCKED.
 */
@Module({
  imports: [
    OutboxModule,
    CustomFieldsModule,
    ConversationsModule,
    WhatsAppIntegrationModule,
  ],
  controllers: [FlowBotAdminController],
  providers: [
    // Singleton a proposito: las pruebas y la demostracion miran lo que se
    // habria enviado, y para eso tienen que compartir instancia con el motor.
    TransporteWhatsAppFalso,
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotOutboxPublisher,
    FlowBotIntakeService,
    FlowBotReconcilerService,
    FlowBotProcessor,
  ],
  exports: [
    // Singleton a proposito: las pruebas y la demostracion miran lo que se
    // habria enviado, y para eso tienen que compartir instancia con el motor.
    TransporteWhatsAppFalso,
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotOutboxPublisher,
    FlowBotIntakeService,
    FlowBotReconcilerService,
    TransporteWhatsAppFalso,
  ],
})
export class FlowBotModule {}
