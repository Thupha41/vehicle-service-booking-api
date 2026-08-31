import 'reflect-metadata';

import type { Express } from 'express';

import { registerTelemetryShutdown, startTelemetry } from './shared/observability/telemetry';

async function bootstrap(): Promise<void> {
  const telemetry = startTelemetry();
  const [
    { ConfigService },
    { NestFactory },
    { Logger },
    { default: helmet },
    { AppModule },
    { parseCorsOrigins },
    { configureCors },
    { createRateLimitMiddleware },
    { createValidationPipe },
    { configureSwagger },
  ] = await Promise.all([
    import('@nestjs/config'),
    import('@nestjs/core'),
    import('nestjs-pino'),
    import('helmet'),
    import('./app.module'),
    import('./shared/config/environment'),
    import('./shared/http/cors'),
    import('./shared/http/rate-limit'),
    import('./shared/http/validation-pipe'),
    import('./shared/http/swagger'),
  ]);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance() as Express;

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  express.use(helmet());
  configureCors(app, parseCorsOrigins(config.get<string>('CORS_ORIGINS')));
  express.use(createRateLimitMiddleware(config));
  app.useGlobalPipes(createValidationPipe());
  configureSwagger(app);

  if (config.getOrThrow<string>('NODE_ENV') === 'production') {
    express.set('trust proxy', 1);
  }

  registerTelemetryShutdown(telemetry);
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap();
