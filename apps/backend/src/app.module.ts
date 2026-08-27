import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { QueueModule } from './common/queue/queue.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { FlowBotModule } from './modules/flowbot/flowbot.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { WhatsAppHistoryModule } from './modules/whatsapp-history/whatsapp-history.module';
import { HealthModule } from './common/health/health.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpLoggerInterceptor } from './common/logging/http-logger.interceptor';
import { RequestIdMiddleware } from './common/logging/request-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './common/config/env.validation';
import {
  THROTTLE_TTL_MS,
  THROTTLE_LIMITS,
} from './common/throttle/throttle.config';
import { buildThrottlerStorage } from './common/throttle/throttler-storage.factory';
import { PrismaModule } from './prisma/prisma.module';
import { CaptchaModule } from './common/captcha/captcha.module';
import { DemoModule } from './common/demo/demo.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { NotesModule } from './modules/notes/notes.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SearchModule } from './modules/search/search.module';
import { ProductsModule } from './modules/products/products.module';
import { PlatformModule } from './modules/platform/platform.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InvitationCodesModule } from './modules/invitation-codes/invitation-codes.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { PasswordRecoveryModule } from './modules/auth/password-recovery/password-recovery.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DeviceIdMiddleware } from './modules/sessions/device-id.middleware';

@Module({
  imports: [
    // Global: el guardarrail de modo demo se comprueba en modulos que no se
    // conocen entre si. Que cada uno tuviera que importarlo convertiria un
    // olvido en un efecto externo desde la empresa de demostracion.
    DemoModule,
    // Antibot global (desacoplado): proveedor falso en local/tests, Turnstile
    // en producción. Opt-in vía CAPTCHA_ENABLED; guard fail-closed cuando activo.
    CaptchaModule,
    QueueModule,
    OutboxModule,
    RealtimeModule,
    HealthModule,
    ChatbotModule,
    FlowBotModule,
    CustomFieldsModule,
    ComplianceModule,
    WhatsAppHistoryModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Rate limiting. El store es Redis compartido en producción/dev (así N
    // réplicas comparten el cupo); en pruebas y con la cola apagada cae al store
    // en memoria por defecto. Ver throttler-storage.factory.ts.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: THROTTLE_TTL_MS,
          limit: THROTTLE_LIMITS.default,
        },
      ],
      storage: buildThrottlerStorage(process.env),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SessionsModule,
    NotificationsModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    ContactsModule,
    ConversationsModule,
    AutomationsModule,
    WhatsappModule,
    WebhookModule,
    PipelineModule,
    LeadsModule,
    TasksModule,
    NotesModule,
    AnalyticsModule,
    SearchModule,
    ProductsModule,
    PlatformModule,
    OnboardingModule,
    QuotesModule,
    InvitationCodesModule,
    PasswordRecoveryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global HTTP rate limiting. Individual routes tighten or skip it with
    // @Throttle / @SkipThrottle. Per-IP for every route (respecting the
    // `trust proxy = 1` set in main.ts, the single Caddy hop) EXCEPT
    // POST /auth/refresh, which is bucketed per device — see AppThrottlerGuard.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    // Consistent error shaping + never leaking a stack trace in a 500 body.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // One safe access-log line per request (no headers/cookies/body logged).
    { provide: APP_INTERCEPTOR, useClass: HttpLoggerInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // RequestIdMiddleware first so every downstream log line + the device-id
    // middleware run with a correlation id already attached to the request.
    consumer.apply(RequestIdMiddleware, DeviceIdMiddleware).forRoutes('*');
  }
}
