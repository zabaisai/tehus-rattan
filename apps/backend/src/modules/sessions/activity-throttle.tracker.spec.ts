import { ActivityThrottleTracker } from './activity-throttle.tracker';
import { ACTIVITY_THROTTLE_MS } from './sessions.constants';

describe('ActivityThrottleTracker', () => {
  let tracker: ActivityThrottleTracker;
  let nowSpy: jest.SpyInstance;
  let currentTime: number;

  beforeEach(() => {
    tracker = new ActivityThrottleTracker();
    currentTime = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('allows the first touch for a session', () => {
    expect(tracker.shouldTouch('session-1')).toBe(true);
  });

  it('does not allow a second touch for the same session within the 5-minute window', () => {
    expect(tracker.shouldTouch('session-1')).toBe(true);

    currentTime += ACTIVITY_THROTTLE_MS - 1;
    expect(tracker.shouldTouch('session-1')).toBe(false);
  });

  it('allows a touch again once the throttle window has fully elapsed', () => {
    expect(tracker.shouldTouch('session-1')).toBe(true);

    currentTime += ACTIVITY_THROTTLE_MS + 1;
    expect(tracker.shouldTouch('session-1')).toBe(true);
  });

  it('tracks each session independently', () => {
    expect(tracker.shouldTouch('session-1')).toBe(true);
    // A different session is never blocked by another session's throttle.
    expect(tracker.shouldTouch('session-2')).toBe(true);
  });
});
