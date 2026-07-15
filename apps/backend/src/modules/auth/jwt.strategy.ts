import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: any) {
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId,
      // Only present on tokens minted by a real /auth/login after this
      // feature shipped — undefined for anything issued before, or by
      // register/onboarding, which never breaks anything reading it since
      // ActivityThrottleInterceptor treats an absent sid as "nothing to do".
      sid: payload.sid,
    };
  }
}
