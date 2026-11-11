import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

// Export openapi.json without starting an HTTP server (pnpm gen:api / CI drift check).
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildOpenApiDocument(app);
  const out = join(process.cwd(), 'openapi.json');
  await writeFile(out, JSON.stringify(document, null, 2));
  await app.close();
}

void exportOpenApi();
