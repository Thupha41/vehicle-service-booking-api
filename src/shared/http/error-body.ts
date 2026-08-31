import { context, trace } from '@opentelemetry/api';
import type { Request } from 'express';

/**
 * Express `Request` shape shared by every call site that builds an error
 * response body: the global exception filter (via Nest's `ArgumentsHost`)
 * and the rate-limit middleware (via `express-rate-limit`'s `handler`
 * option). Both hand this function the same underlying Express `Request`.
 *
 * `pino-http` (used by `nestjs-pino`) globally augments
 * `http.IncomingMessage` — and therefore Express's `Request` — with a
 * required `id: string | number | object` property, so no local narrowing
 * is needed here.
 */
export type RequestWithId = Request;

/**
 * Resolves the correlation ID for a request the same way across every
 * error-response call site: prefer the `id` pino-http assigned (coercing a
 * numeric ID to a string), fall back to the `x-request-id` header, and
 * finally to `'unknown'` if neither is present.
 */
export function resolveRequestId(request: RequestWithId): string {
  const { id } = request;

  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  if (typeof id === 'number') {
    return String(id);
  }

  return request.header('x-request-id') ?? 'unknown';
}

export interface ErrorResponseBody {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
  traceId?: string;
  timestamp: string;
  path: string;
}

/**
 * Builds the standard error response envelope used across the API:
 * `statusCode`, `error.code`, `error.message`, an optional `error.details`,
 * `requestId`, an optional `traceId`, `timestamp`, and `path`.
 *
 * `details` is only included when `status < 500` — 5xx responses never leak
 * `details` to the client, regardless of what is passed in, to avoid
 * exposing internal exception detail for unexpected errors.
 */
export function buildErrorBody(
  status: number,
  code: string,
  message: string,
  request: RequestWithId,
  details?: unknown,
): ErrorResponseBody {
  const requestId = resolveRequestId(request);
  const traceId = trace.getSpan(context.active())?.spanContext().traceId;

  return {
    statusCode: status,
    error: {
      code,
      message,
      ...(status < 500 && details !== undefined ? { details } : {}),
    },
    requestId,
    ...(traceId === undefined ? {} : { traceId }),
    timestamp: new Date().toISOString(),
    path: request.originalUrl,
  };
}
