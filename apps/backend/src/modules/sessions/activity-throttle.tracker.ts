import { Injectable } from '@nestjs/common';
import { ACTIVITY_THROTTLE_MS } from './sessions.constants';

// In-process, per-instance gate: "has this session already been touched in
// the last 5 minutes?" A plain Map is enough here — the cost of an
// under-throttled write on a horizontally-scaled deployment (each instance
// keeping its own map) is at most a few extra UPDATEs, never incorrect
// behavior, so this intentionally isn't backed by Redis or the database.
@Injectable()
export class ActivityThrottleTracker {
  private lastTouchedAt = new Map<string, number>();

  shouldTouch(sessionId: string): boolean {
    const now = Date.now();
    const last = this.lastTouchedAt.get(sessionId);

    if (last !== undefined && now - last < ACTIVITY_THROTTLE_MS) {
      return false;
    }

    this.lastTouchedAt.set(sessionId, now);
    return true;
  }
}
