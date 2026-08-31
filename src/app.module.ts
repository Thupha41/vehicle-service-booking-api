import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { AppointmentsModule } from './modules/appointments/appointments.module';
import { HealthModule } from './modules/health/health.module';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { createDatabaseOptions } from './shared/config/database-options';
import { validateEnvironment } from './shared/config/environment';
import { GlobalExceptionFilter } from './shared/http/global-exception.filter';
import { HttpMetricsInterceptor } from './shared/observability/http-metrics.interceptor';
import { createPinoLoggerOptions } from './shared/observability/logging';
import { ObservabilityModule } from './shared/observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPinoLoggerOptions(
          config.getOrThrow<string>('NODE_ENV'),
          config.getOrThrow<string>('LOG_LEVEL'),
          config.getOrThrow<string>('OTEL_SERVICE_NAME'),
        ),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createDatabaseOptions(
          config.getOrThrow<string>('DATABASE_URL'),
          config.getOrThrow<string>('NODE_ENV'),
          config.getOrThrow<boolean>('DATABASE_SSL'),
        ),
    }),
    ObservabilityModule,
    HealthModule,
    ReferenceDataModule,
    VehiclesModule,
    ResourcesModule,
    AppointmentsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class AppModule {}
