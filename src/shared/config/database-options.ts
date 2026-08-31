import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function createDatabaseOptions(
  databaseUrl: string,
  nodeEnvironment: string,
  databaseSsl: boolean,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    autoLoadEntities: true,
    synchronize: false,
    migrationsRun: false,
    logging:
      nodeEnvironment === 'development'
        ? ['error', 'warn']
        : nodeEnvironment === 'test'
          ? false
          : ['error'],
    connectTimeoutMS: 5_000,
    retryAttempts: 3,
    retryDelay: 1_000,
    extra: {
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    },
    ssl: databaseSsl ? { rejectUnauthorized: true } : undefined,
  };
}
