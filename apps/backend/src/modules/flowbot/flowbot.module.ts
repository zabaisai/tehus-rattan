import { Module } from '@nestjs/common';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { FlowBotQueueService } from './engine/flowbot.queue';
import { FlowBotSelectorService } from './engine/flowbot.selector';
import { FlowBotRunnerService } from './engine/flowbot.runner';
import { FlowBotProcessor } from './engine/flowbot.processor';
import { FlowBotEffectsFactory } from './engine/flowbot.effects.factory';
import { FlowBotOutboxPublisher } from './engine/flowbot.outbox';

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
  imports: [OutboxModule],
  providers: [
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotOutboxPublisher,
    FlowBotProcessor,
  ],
  exports: [
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotOutboxPublisher,
  ],
})
export class FlowBotModule {}
