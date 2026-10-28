import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleUpdateChecks, UPDATE_CHECK_INTERVAL_MS } from './updateSchedule';

const MINUTE = 60_000;

function setup(online = true) {
  const registration = { update: vi.fn(async () => undefined) };
  const env = { online, events: new EventTarget() };
  const stop = scheduleUpdateChecks(registration, { isOnline: () => env.online, events: env.events });
  return { registration, env, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleUpdateChecks', () => {
  it('checks every 60 minutes', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(60 * MINUTE);
    const { registration } = setup();
    vi.advanceTimersByTime(59 * MINUTE + 59_000);
    expect(registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * MINUTE);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('skips the hourly check while offline, and resumes when back online', () => {
    const { registration, env } = setup(false);
    vi.advanceTimersByTime(60 * MINUTE);
    expect(registration.update).not.toHaveBeenCalled();
    env.online = true;
    vi.advanceTimersByTime(60 * MINUTE);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('checks immediately on each online event', () => {
    const { registration, env } = setup(false);
    env.online = true;
    env.events.dispatchEvent(new Event('online'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    env.events.dispatchEvent(new Event('online'));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('survives a failed check and tries again at the next one', async () => {
    // A rejection nobody handles would fail the whole run: Vitest reports unhandled rejections as errors.
    const registration = { update: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) };
    const events = new EventTarget();
    scheduleUpdateChecks(registration, { isOnline: () => true, events });
    events.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it('stops checking once cancelled', () => {
    const { registration, env, stop } = setup();
    stop();
    vi.advanceTimersByTime(3 * 60 * MINUTE);
    env.events.dispatchEvent(new Event('online'));
    expect(registration.update).not.toHaveBeenCalled();
  });
});
