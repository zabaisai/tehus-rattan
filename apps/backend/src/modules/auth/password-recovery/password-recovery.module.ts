import { Module } from '@nestjs/common';
import { MailModule } from '../../mail/mail.module';
import { SessionsModule } from '../../sessions/sessions.module';
import { PasswordRecoveryController } from './password-recovery.controller';
import {
  AdminPasswordRecoveryController,
  PlatformPasswordRecoveryController,
} from './admin-password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { PasswordResetTokenService } from './password-reset-token.service';

@Module({
  imports: [MailModule, SessionsModule],
  controllers: [
    PasswordRecoveryController,
    PlatformPasswordRecoveryController,
    AdminPasswordRecoveryController,
  ],
  providers: [PasswordRecoveryService, PasswordResetTokenService],
})
export class PasswordRecoveryModule {}
