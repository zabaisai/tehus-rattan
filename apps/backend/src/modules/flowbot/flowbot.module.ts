import { Module } from '@nestjs/common';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { FlowBotQueueService } from './engine/flowbot.queue';
import { FlowBotSelectorService } from './engine/flowbot.selector';
import { FlowBotRunnerService } from './engine/flowbot.runner';
import { FlowBotProcessor } from './engine/flowbot.processor';
import { FlowBotEffectsFactory } from './engine/flowbot.effects.factory';

/**
 * Modulo de FlowBot.
 *
 * El consumidor (`FlowBotProcessor`) se declara aqui pero solo abre la cola en
 * el proceso worker: `shouldConsumeQueue()` lo decide. Registrarlo en los dos
 * procesos haria que cada trabajo se procesara dos veces.
 */
@Module({
  imports: [OutboxModule],
  providers: [
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotProcessor,
  ],
  exports: [
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
  ],
})
export class FlowBotModule {}
