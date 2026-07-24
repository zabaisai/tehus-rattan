import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

const SIGNATURE_HEADER = 'x-hub-signature-256';
// Meta always sends "sha256=" followed by a 64-char lowercase hex HMAC digest.
const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/;

/**
 * Verifies the authenticity of incoming WhatsApp Cloud API webhook POSTs using
 * Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the EXACT raw request body
 * keyed with the Meta App Secret (NOT any company access token, and NOT the
 * GET-handshake verify token). Fail-closed: anything it cannot positively
 * verify is rejected before the payload is ever processed.
 *
 * Never logs the app secret, the full signature, tokens, or message contents.
 */
@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      // The webhook is reachable but not configured to verify signatures —
      // refuse rather than process unauthenticated payloads.
      this.logger.error(
        'Webhook rechazado: WHATSAPP_APP_SECRET no está configurado',
      );
      throw new ServiceUnavailableException(
        'Verificación de firma de webhook no configurada',
      );
    }

    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      this.logger.warn('Webhook rechazado: cuerpo crudo ausente');
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const headerValue = request.headers[SIGNATURE_HEADER];
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof header !== 'string' || header.length === 0) {
      this.logger.warn('Webhook rechazado: header de firma ausente');
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const match = SIGNATURE_FORMAT.exec(header.trim());
    if (!match) {
      // Wrong algorithm prefix, wrong length, or non-hex characters.
      this.logger.warn('Webhook rechazado: formato de firma inválido');
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const provided = Buffer.from(match[1], 'hex');
    const expected = createHmac('sha256', appSecret).update(rawBody).digest();

    // Length is guaranteed equal by the regex (both 32 bytes), but guard
    // anyway so timingSafeEqual never throws on mismatched lengths.
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.logger.warn('Webhook rechazado: firma no coincide');
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    return true;
  }
}
