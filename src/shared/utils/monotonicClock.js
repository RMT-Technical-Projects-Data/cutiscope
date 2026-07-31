/**
 * Elapsed-time source that does not move when the system clock is changed.
 *
 * Anything measuring a duration (session inactivity, countdowns) must use this
 * instead of Date.now(): setting the date forward from Settings jumps the wall
 * clock past any absolute deadline, which fired the logout prompt instantly.
 */
export function monotonicNow() {
  const perf = global.performance;
  if (perf && typeof perf.now === 'function') {
    const value = perf.now();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return Date.now();
}

export default monotonicNow;
