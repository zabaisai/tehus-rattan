import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './common/config/env.validation';
import { THROTTLE_TTL_MS, THROTTLE_LIMITS } from './common/throttle/throttle.config';
import { PrismaModule } from './prisma/prisma.module';
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
import { ProductsModule } from './modules/products/products.module';
import { PlatformModule } from './modules/platform/platform.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InvitationCodesModule } from './modules/invitation-codes/invitation-codes.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { DeviceIdMiddleware } from './modules/sessions/device-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: THROTTLE_TTL_MS,
        limit: THROTTLE_LIMITS.default,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    SessionsModule,
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
    ProductsModule,
    PlatformModule,
    OnboardingModule,
    QuotesModule,
    InvitationCodesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global HTTP rate limiting. Individual routes tighten or skip it with
    // @Throttle / @SkipThrottle. Per-IP for every route (respecting the
    // `trust proxy = 1` set in main.ts, the single Caddy hop) EXCEPT
    // POST /auth/refresh, which is bucketed per device — see AppThrottlerGuard.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DeviceIdMiddleware).forRoutes('*');
  }
}
