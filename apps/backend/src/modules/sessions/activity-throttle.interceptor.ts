import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { SessionsService } from './sessions.service';
import { ActivityThrottleTracker } from './activity-throttle.tracker';

// Global interceptor (see AppModule) — runs after every request completes.
// Only does anything when the JWT payload carries a `sid` (session id):
// tokens issued before this feature existed simply have no `sid` and this
// silently no-ops for them, so nothing about existing sessions/tests
// changes. Does not update Postgres on every request — ActivityThrottleTracker
// gates that down to at most once every 5 minutes per session, and the
// write itself is fire-and-forget so it can never slow down or fail the
// actual response.
@Injectable()
export class ActivityThrottleInterceptor implements NestInterceptor {
  constructor(
    private sessionsService: SessionsService,
    private tracker: ActivityThrottleTracker,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const req = context.switchToHttp().getRequest();
        const sessionId: string | undefined = req.user?.sid;
        if (!sessionId) return;
        if (!this.tracker.shouldTouch(sessionId)) return;

        this.sessionsService.touchActivity(sessionId).catch(() => {
          // Best-effort signal only — a missed activity ping must never
          // surface as an error on a request that already succeeded.
        });
      }),
    );
  }
}
