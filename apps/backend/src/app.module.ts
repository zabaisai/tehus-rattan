import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
