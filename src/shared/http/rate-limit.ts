import type { ConfigService } from '@nestjs/config';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { buildErrorBody } from './error-body';

export function createRateLimitMiddleware(config: ConfigService): RequestHandler {
  return rateLimit({
    windowMs: config.getOrThrow<number>('RATE_LIMIT_WINDOW_MS'),
    limit: config.getOrThrow<number>('RATE_LIMIT_MAX'),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      res
        .status(429)
        .json(
          buildErrorBody(
            429,
            'RATE_LIMIT_EXCEEDED',
            'Too many requests; retry after the current rate-limit window',
            req,
          ),
        );
    },
  });
}
