import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Build the OpenAPI document from decorators. Shared by /docs and the export script.
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CVC API')
    .setDescription('CVC platform — Tìm nguồn hàng · Mua hộ · Bán giùm')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('/api/v1')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
