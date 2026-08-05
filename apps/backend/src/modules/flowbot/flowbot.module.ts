import { Module } from '@nestjs/common';
import { OutboxModule } from '../../common/outbox/outbox.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsAppIntegrationModule } from '../whatsapp-integration/whatsapp-integration.module';
import { TransporteWhatsAppFalso } from './engine/adapters/flowbot.whatsapp.fake-transport';
import { TransporteWhatsAppDryRun } from './engine/adapters/flowbot.whatsapp.dry-run-transport';
import { TransporteWhatsAppReal } from './engine/adapters/flowbot.whatsapp.transport';
import { GuardarrailesWhatsApp } from './engine/adapters/flowbot.whatsapp.guardarrailes';
import {
  ProveedorPlantillasFalso,
  RegistroPlantillas,
} from './engine/adapters/flowbot.whatsapp.plantillas';
import { FlowBotKillSwitchService } from './engine/flowbot.kill-switch.service';
import { MetricasEnvio } from './engine/flowbot.envio.metricas';
import { ContadorFrecuencia } from './engine/adapters/flowbot.whatsapp.frecuencia';
import { CircuitBreakerWhatsApp } from './engine/adapters/flowbot.whatsapp.breaker';
import { RegistroProveedoresIa } from './engine/adapters/flowbot.ia.provider';
import { FlowBotReferenciasService } from './graph/flowbot.referencias.service';
import { PlatformModule } from '../platform/platform.module';
import { FlowBotController } from './api/flowbot.controller';
import { FlowBotSupportGuard } from './api/flowbot-support.guard';
import { FlowBotAdminService } from './api/flowbot.admin.service';
import { FlowBotTriggersService } from './api/flowbot.triggers.service';
import { FlowBotExecutionsService } from './api/flowbot.executions.service';
import { FlowBotMetricsService } from './api/flowbot.metrics.service';
import { FlowBotSimulatorService } from './api/flowbot.simulator.service';
import { ProveedorIaFalso } from './engine/adapters/flowbot.ia.fake-provider';
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
    PlatformModule,
  ],
  controllers: [FlowBotAdminController, FlowBotController],
  providers: [
    // Singleton a proposito: las pruebas y la demostracion miran lo que se
    // habria enviado, y para eso tienen que compartir instancia con el motor.
    TransporteWhatsAppFalso,
    TransporteWhatsAppDryRun,
    TransporteWhatsAppReal,
    GuardarrailesWhatsApp,
    RegistroPlantillas,
    ProveedorPlantillasFalso,
    FlowBotKillSwitchService,
    MetricasEnvio,
    ContadorFrecuencia,
    CircuitBreakerWhatsApp,
    ProveedorIaFalso,
    { provide: RegistroProveedoresIa, useClass: RegistroProveedoresIa },
    FlowBotReferenciasService,
    FlowBotSupportGuard,
    FlowBotAdminService,
    FlowBotTriggersService,
    FlowBotExecutionsService,
    FlowBotMetricsService,
    FlowBotSimulatorService,
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
    TransporteWhatsAppDryRun,
    TransporteWhatsAppReal,
    GuardarrailesWhatsApp,
    RegistroPlantillas,
    ProveedorPlantillasFalso,
    FlowBotKillSwitchService,
    MetricasEnvio,
    ContadorFrecuencia,
    CircuitBreakerWhatsApp,
    ProveedorIaFalso,
    { provide: RegistroProveedoresIa, useClass: RegistroProveedoresIa },
    FlowBotReferenciasService,
    FlowBotSupportGuard,
    FlowBotAdminService,
    FlowBotTriggersService,
    FlowBotExecutionsService,
    FlowBotMetricsService,
    FlowBotSimulatorService,
    FlowBotQueueService,
    FlowBotSelectorService,
    FlowBotRunnerService,
    FlowBotEffectsFactory,
    FlowBotOutboxPublisher,
    FlowBotIntakeService,
    FlowBotReconcilerService,
    TransporteWhatsAppFalso,
    TransporteWhatsAppDryRun,
    TransporteWhatsAppReal,
    GuardarrailesWhatsApp,
    RegistroPlantillas,
    ProveedorPlantillasFalso,
    FlowBotKillSwitchService,
    MetricasEnvio,
    ContadorFrecuencia,
    CircuitBreakerWhatsApp,
    ProveedorIaFalso,
    FlowBotReferenciasService,
    FlowBotAdminService,
    FlowBotSimulatorService,
  ],
})
export class FlowBotModule {}
