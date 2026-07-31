import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    id?: string;
  }
}

// Assigns a correlation id to every request (reusing a caller-supplied
// X-Request-Id when it is a sane length, else generating one) and echoes it in
// the response header so a client/log line can be tied to a server log line.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const supplied =
      typeof incoming === 'string' &&
      incoming.length > 0 &&
      incoming.length <= 200
        ? incoming
        : undefined;
    const id = supplied ?? randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
