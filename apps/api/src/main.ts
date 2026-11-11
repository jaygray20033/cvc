import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { setupSwagger } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  // Business routes live under /api/v1; probes stay at the root for the proxy.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableCors({ origin: config.get<string>('app.appUrl'), credentials: true });
  setupSwagger(app);

  await app.listen(config.get<number>('app.port', 3000));
}

void bootstrap();
