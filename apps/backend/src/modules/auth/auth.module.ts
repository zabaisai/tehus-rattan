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

@Module({
  imports: [
    UsersModule,
    SessionsModule,
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
        // Pin the algorithm on both ends (HS256, symmetric secret): an
        // explicit allowlist forecloses any algorithm-confusion attack.
        signOptions: { expiresIn: ACCESS_TOKEN_EXPIRES_IN, algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, CookieOriginGuard],
  exports: [AuthService],
})
export class AuthModule {}
