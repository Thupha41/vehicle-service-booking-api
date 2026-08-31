import 'reflect-metadata';

import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL');
  }

  return value;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl(),
  synchronize: false,
  migrationsRun: false,
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  entities: [join(__dirname, '../../modules/**/*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
