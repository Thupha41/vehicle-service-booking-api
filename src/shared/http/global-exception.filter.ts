import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { buildErrorBody, resolveRequestId, type RequestWithId } from './error-body';

interface ErrorPayload {
  code?: unknown;
  errorCode?: unknown;
  message?: unknown;
  details?: unknown;
}

function defaultErrorCode(status: number): string {
  const label = HttpStatus[status];
  return typeof label === 'string' ? label : 'HTTP_ERROR';
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawPayload = isHttpException ? exception.getResponse() : undefined;
    const payload: ErrorPayload =
      typeof rawPayload === 'object' && rawPayload !== null
        ? (rawPayload as ErrorPayload)
        : { message: rawPayload };
    const requestId = resolveRequestId(request);
    const traceId = trace.getSpan(context.active())?.spanContext().traceId;
    const codeCandidate = payload.code ?? payload.errorCode;
    const code = typeof codeCandidate === 'string' ? codeCandidate : defaultErrorCode(status);
    const message =
      status >= 500
        ? 'An unexpected error occurred'
        : typeof payload.message === 'string'
          ? payload.message
          : Array.isArray(payload.message)
            ? payload.message.join(', ')
            : 'Request failed';

    const logContext = {
      err: exception,
      requestId,
      traceId,
      method: request.method,
      route: request.path,
      statusCode: status,
      errorCode: code,
    };

    if (status >= 500) {
      this.logger.error(logContext, 'Request failed');
    } else {
      this.logger.warn(logContext, 'Request rejected');
    }

    response.status(status).json(buildErrorBody(status, code, message, request, payload.details));
  }
}
