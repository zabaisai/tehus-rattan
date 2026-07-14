import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind the Caddy reverse proxy in staging/production, Express only sees
  // requests arriving over plain HTTP from the proxy itself. Without this,
  // req.protocol reports "http" even for HTTPS visitors, which corrupts the
  // absolute URLs built for imported product images (see
  // ProductsImportService.saveEmbeddedImage).
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Backend corriendo en http://localhost:${port}/api`);
}
bootstrap().catch(console.error);
