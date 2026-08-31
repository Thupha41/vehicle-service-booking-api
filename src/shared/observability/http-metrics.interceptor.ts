import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';

import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    const route = this.routeLabel(request);
    let errorStatus: number | undefined;

    this.metrics.requestStarted();

    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          errorStatus = error instanceof HttpException ? error.getStatus() : 500;
        },
      }),
      finalize(() => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        this.metrics.requestCompleted(
          request.method,
          route,
          errorStatus ?? response.statusCode,
          durationSeconds,
        );
      }),
    );
  }

  private routeLabel(request: Request): string {
    const routePath = (request as unknown as { route?: { path?: unknown } }).route?.path;
    if (typeof routePath !== 'string') {
      return 'unmatched';
    }

    return `${request.baseUrl}${routePath}` || '/';
  }
}
