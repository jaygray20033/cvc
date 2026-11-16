import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { QueueProcessor } from './queue/queue.processor';

// Background worker process (same image as api, different command, P2.19).
// Boots the Nest context without an HTTP listener: QueueProcessor's
// onModuleInit starts the BullMQ workers (same handler registry as the api
// container), then the process idles until SIGTERM.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.get(QueueProcessor); // workers start on module init

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void bootstrap();
