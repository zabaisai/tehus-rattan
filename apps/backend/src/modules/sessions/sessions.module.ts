import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SessionsService } from './sessions.service';
import { ActivityThrottleTracker } from './activity-throttle.tracker';
import { ActivityThrottleInterceptor } from './activity-throttle.interceptor';
import { SessionCleanupService } from './session-cleanup.service';

@Module({
  providers: [
    SessionsService,
    ActivityThrottleTracker,
    SessionCleanupService,
    { provide: APP_INTERCEPTOR, useClass: ActivityThrottleInterceptor },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
