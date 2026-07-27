import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

// One structured line per request: method, path, status, duration, correlation
// id. Deliberately logs NO headers, cookies, or body — so Authorization, the
// refresh/device cookies, and tokens can never leak through the access log.
@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { method } = req;
    // req.route?.path keeps high-cardinality ids out; fall back to the path
    // (without query string) so tokens in a query can never be logged.
    const path = req.originalUrl?.split('?')[0] ?? req.url;
    const id = req.id ?? 'unknown';
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.log(
            `${method} ${path} ${res.statusCode} ${Date.now() - startedAt}ms [req:${id}]`,
          ),
        // Errors are logged (with status + stack) by the global exception
        // filter; don't double-log them here.
        error: () => undefined,
      }),
    );
  }
}
