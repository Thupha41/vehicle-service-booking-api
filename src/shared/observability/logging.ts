import { randomUUID } from 'node:crypto';

import { context, trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';

interface RequestLike {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
  statusCode: number;
}

const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

/**
 * Standard sensitive patterns redacted across all structured logs.
 * Using wildcard notation (*.field) ensures all nested structures, DTOs,
 * and service logs are automatically protected without modifying this file.
 */
export const SENSITIVE_LOG_PATTERNS: readonly string[] = [
  // Auth & Security Headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',

  // Authentication & Secrets (wildcard)
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.privateKey',

  // PII - Personally Identifiable Information (wildcard)
  '*.email',
  '*.phone',
  '*.phoneNumber',
  '*.customerName',
  '*.fullName',
  '*.vin',
  '*.ssn',
  '*.creditCard',

  // Infrastructure & Config Secrets (wildcard)
  '*.databaseUrl',
  '*.dbUrl',
  '*.connectionString',
];

function getRequestId(request: RequestLike): string {
  const rawHeader = request.headers['x-request-id'];
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

export function createPinoLoggerOptions(
  environment: string,
  logLevel: string,
  serviceName: string,
  additionalRedactPaths: string[] = [],
): Params {
  return {
    assignResponse: true,
    pinoHttp: {
      level: environment === 'test' ? 'silent' : logLevel,
      genReqId: (request, response) => {
        const requestId = getRequestId(request as RequestLike);
        (response as ResponseLike).setHeader('x-request-id', requestId);
        return requestId;
      },
      autoLogging:
        environment === 'test'
          ? false
          : {
              ignore: (request) => request.url === '/health/live',
            },
      customProps: (request) => ({
        service: serviceName,
        environment,
        requestId: request.id,
        traceId: trace.getSpan(context.active())?.spanContext().traceId,
      }),
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) {
          return 'error';
        }
        if (response.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
      redact: {
        paths: [...SENSITIVE_LOG_PATTERNS, ...additionalRedactPaths],
        censor: '[REDACTED]',
      },
      transport:
        environment === 'development'
          ? {
              target: 'pino-pretty',
              options: { colorize: true, singleLine: true },
            }
          : undefined,
    },
  };
}
