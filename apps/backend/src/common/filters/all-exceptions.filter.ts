import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Request, Response } from 'express';

// Global catch-all. Preserves the exact response shape Nest already produces for
// HttpExceptions (so validation errors, 401s, 403s, etc. are unchanged), but:
//  - for any UNHANDLED error it returns a generic 500 and NEVER leaks the
//    exception message or stack in the HTTP body (in any environment);
//  - it logs 5xx server-side with the stack + correlation id for diagnosis;
//  - it stamps the correlation id on the response header only (not the body),
//    so error payloads keep their existing structure.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.id ?? 'unknown';

    const isHttp = exception instanceof HttpException;
    // Non-HttpException errors from the Express layer (e.g. body-parser's
    // PayloadTooLargeError) carry their own 4xx status/statusCode — honor it
    // rather than masking a client error as a 500.
    const rawStatus = (exception as { status?: unknown; statusCode?: unknown })
      ?.status ?? (exception as { statusCode?: unknown })?.statusCode;
    const status = isHttp
      ? exception.getStatus()
      : typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500
        ? rawStatus
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      // Full stack to the server log (never to the client). Message/stack of an
      // unexpected error may reference internals — safe in logs, not in a body.
      this.logger.error(
        `${req.method} ${req.originalUrl?.split('?')[0]} -> ${status} [req:${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (!res.headersSent) {
      res.setHeader('X-Request-Id', requestId);
    }

    // Reproduce Nest's default HttpException body exactly; for everything else
    // emit a fixed generic 500 that reveals nothing about the failure.
    let body: Record<string, unknown> | string;
    if (isHttp) {
      const response = exception.getResponse();
      body =
        typeof response === 'string'
          ? { statusCode: status, message: response }
          : (response as Record<string, unknown>);
    } else if (status < 500) {
      // A non-HttpException client error (e.g. 413 entity.too.large): return
      // only the standard reason phrase, never the raw error message.
      body = { statusCode: status, message: STATUS_CODES[status] ?? 'Request error' };
    } else {
      body = { statusCode: status, message: 'Internal server error' };
    }

    res.status(status).json(body);
  }
}
