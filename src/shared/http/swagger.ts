import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Unified Service Scheduler API')
    .setDescription(
      'Scenario A REST API for checking vehicle-service availability and atomically booking appointments.',
    )
    .setVersion('1.0.0')
    .addServer('/')
    .addTag('Availability', 'Check technician and service-bay availability')
    .addTag('Appointments', 'Book, retrieve, and cancel appointments')
    .addTag('Health', 'Liveness and database readiness probes')
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}

export function configureSwagger(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: false,
    },
  });

  return document;
}
