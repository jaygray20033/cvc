import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { mountJobBoard } from './job-board';
import { setupSwagger } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  // Business routes live under /api/v1; probes stay at the root for the proxy.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.enableCors({ origin: config.get<string>('app.appUrl'), credentials: true });
  setupSwagger(app);
  // Bull-board UI (admin-only via bearer token) behind the API prefix.
  mountJobBoard(app);

  await app.listen(config.get<number>('app.port', 3000));
}

void bootstrap();
