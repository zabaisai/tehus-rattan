import { NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  ClassSerializerInterceptor,
  Logger,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { applySecurityHeaders } from './common/security/security.setup';
import { buildCorsOptions } from './common/security/cors.options';
import { RELEASE_INFO } from './common/release/release.info';

// Explicit body-size ceilings. Small by default — the only large uploads are
// multipart (product import / logo), which are bounded separately by their own
// Multer fileSize limits, not by these JSON/urlencoded parsers.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? '1mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT ?? '1mb';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // rawBody: true makes Nest's built-in body parser keep the exact bytes it
  // received on req.rawBody (a Buffer), which WhatsAppSignatureGuard needs to
  // verify Meta's X-Hub-Signature-256 against the untouched payload.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: false,
  });

  // Bound the JSON/urlencoded parsers so a huge body cannot exhaust memory.
  // rawBody capture is preserved (Nest buffers it in the parser's verify hook).
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: URLENCODED_BODY_LIMIT, extended: true });

  // Behind the Caddy reverse proxy, Express only sees plain HTTP from the
  // proxy. Trust the single hop so req.protocol / req.ip reflect the real
  // client (used by absolute image URLs and the per-IP throttler).
  app.set('trust proxy', 1);

  // Only ever reads the deviceId/refresh-token cookies this app sets (both
  // httpOnly) — never used to parse the auth JWT (Authorization: Bearer only).
  app.use(cookieParser());

  // Security headers (Helmet + Permissions-Policy). HSTS is intentionally left
  // to Caddy (the TLS edge); the frontend owns its own nonce-based CSP.
  applySecurityHeaders(app);

  app.setGlobalPrefix('api');
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.enableCors(buildCorsOptions(process.env));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Flush in-flight requests and disconnect Prisma cleanly on SIGTERM/SIGINT
  // (container stop / redeploy) instead of dropping connections abruptly.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3001;
  await app.listen(port);

  // Release identity goes to the startup log only (never the public health
  // body). Safe to log — it is a git SHA/timestamp, not a secret.
  logger.log(
    `Backend listening on port ${port} (release ${RELEASE_INFO.sha}, built ${RELEASE_INFO.builtAt})`,
  );
}
bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Fatal bootstrap error', err as Error);
  process.exitCode = 1;
});
