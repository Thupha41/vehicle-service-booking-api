export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  DATABASE_SSL: boolean;
  LOG_LEVEL: string;
  CORS_ORIGINS: string;
  OTEL_ENABLED: boolean;
  OTEL_SERVICE_NAME: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function parseInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  throw new Error(`${name} must be either true or false`);
}

function parseString(value: unknown, fallback: string, name: string): string {
  if (value === undefined || value === '') {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }

  return value;
}

function validateDatabaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }

  return value;
}

export function validateEnvironment(
  raw: Record<string, unknown>,
): EnvironmentVariables & Record<string, unknown> {
  const nodeEnvironment = (raw.NODE_ENV ?? 'development') as string;
  if (!NODE_ENVIRONMENTS.includes(nodeEnvironment as NodeEnvironment)) {
    throw new Error(`NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  const logLevel = parseString(raw.LOG_LEVEL, 'info', 'LOG_LEVEL').toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`LOG_LEVEL is not supported: ${logLevel}`);
  }

  return {
    ...raw,
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PORT: parseInteger(raw.PORT, 3000, 'PORT', 1, 65_535),
    DATABASE_URL: validateDatabaseUrl(raw.DATABASE_URL),
    DATABASE_SSL: parseBoolean(raw.DATABASE_SSL, false, 'DATABASE_SSL'),
    LOG_LEVEL: logLevel,
    CORS_ORIGINS: parseString(raw.CORS_ORIGINS, 'http://localhost:3000', 'CORS_ORIGINS'),
    OTEL_ENABLED: parseBoolean(raw.OTEL_ENABLED, false, 'OTEL_ENABLED'),
    OTEL_SERVICE_NAME: parseString(
      raw.OTEL_SERVICE_NAME,
      'unified-service-scheduler',
      'OTEL_SERVICE_NAME',
    ),
    OTEL_EXPORTER_OTLP_ENDPOINT: parseString(
      raw.OTEL_EXPORTER_OTLP_ENDPOINT,
      'http://localhost:4318',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ),
    RATE_LIMIT_WINDOW_MS: parseInteger(
      raw.RATE_LIMIT_WINDOW_MS,
      60_000,
      'RATE_LIMIT_WINDOW_MS',
      1_000,
      3_600_000,
    ),
    RATE_LIMIT_MAX: parseInteger(raw.RATE_LIMIT_MAX, 100, 'RATE_LIMIT_MAX', 1, 100_000),
  };
}

export function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
