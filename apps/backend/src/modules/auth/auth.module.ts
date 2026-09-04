import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { CookieOriginGuard } from '../../common/guards/cookie-origin.guard';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ACCESS_TOKEN_EXPIRES_IN } from '../sessions/sessions.constants';
import { MailModule } from '../mail/mail.module';
import { PlatformAuditLogService } from '../platform/platform-audit-log.service';
import { DeviceVerificationConfig } from './device-verification/device-verification.config';
import { DeviceVerificationService } from './device-verification/device-verification.service';
import { TrustedDeviceService } from './device-verification/trusted-device.service';

@Module({
  imports: [
    UsersModule,
    SessionsModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        // Was 7d — now short-lived because JwtStrategy independently
        // enforces revocation via `sid` on every request (see
        // jwt.strategy.ts). This shorter window is a defense-in-depth
        // measure for token leakage, not the revocation mechanism itself.
        signOptions: { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    CookieOriginGuard,
    DeviceVerificationConfig,
    DeviceVerificationService,
    TrustedDeviceService,
    PlatformAuditLogService,
  ],
  // `TrustedDeviceService` se exporta para que la revocación de sesiones y el
  // restablecimiento de contraseña retiren también la confianza del
  // dispositivo en el mismo camino.
  exports: [AuthService, TrustedDeviceService, DeviceVerificationService],
})
export class AuthModule {}
