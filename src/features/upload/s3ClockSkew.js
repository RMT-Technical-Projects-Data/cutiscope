/**
 * Detect / correct device clock skew that breaks TLS ("Chain validation failed")
 * and AWS SigV4. Prefer SystemTimeModule (root); otherwise pause uploads.
 */
import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import { showInAppToast } from '../../shared/utils/inAppToast';

export const CLOCK_SKEW_CODE = 'CLOCK_SKEW';
export const CLOCK_SKEW_EVENT = 'S3_CLOCK_SKEW';

/** Years before this are treated as frozen/wrong clocks on cutiscope devices. */
const MIN_VALID_YEAR = 2025;

/** Max acceptable skew vs network Date header (ms). */
const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

let pausedForSkew = false;
let lastToastAt = 0;

export class ClockSkewError extends Error {
  constructor(message = 'Device clock is incorrect; fix date/time before uploading') {
    super(message);
    this.name = 'ClockSkewError';
    this.code = CLOCK_SKEW_CODE;
  }
}

export function isClockSkewError(err) {
  if (!err) return false;
  if (err.code === CLOCK_SKEW_CODE || err.name === 'ClockSkewError') return true;
  const msg = String(err.message || err || '');
  return (
    msg.includes(CLOCK_SKEW_CODE) ||
    /RequestTimeTooSkewed/i.test(msg) ||
    /Chain validation failed/i.test(msg) ||
    /certificate.*(not yet valid|expired|chain)/i.test(msg)
  );
}

export function isUploadPausedForClockSkew() {
  return pausedForSkew;
}

export function clearClockSkewPause() {
  pausedForSkew = false;
}

function toastSkewOnce(message) {
  const now = Date.now();
  if (now - lastToastAt < 8000) return;
  lastToastAt = now;
  if (Platform.OS === 'android') {
    showInAppToast(message, { durationMs: 3500, position: 'center' });
  }
}

function deviceLooksSkewed(nowMs = Date.now()) {
  const year = new Date(nowMs).getFullYear();
  return year < MIN_VALID_YEAR || year > 2100;
}

/**
 * Best-effort network time. Prefer HTTP (works even when TLS is broken due to skew),
 * then HTTPS Date headers.
 * Returns epoch ms or null.
 */
async function fetchNetworkTimeMs() {
  const ts = Date.now();
  const httpUrls = [
    // Cleartext backends already allowed in network_security_config (with cache busting)
    `http://35.154.32.201:4040/?_t=${ts}`,
  ];
  for (const url of httpUrls) {
    try {
      const controller =
        typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), 3000)
        : null;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer);
      const dateHdr = res.headers?.get?.('date') || res.headers?.get?.('Date');
      if (dateHdr) {
        const ms = Date.parse(dateHdr);
        if (!Number.isNaN(ms) && new Date(ms).getFullYear() >= MIN_VALID_YEAR) return ms;
      }
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        const iso = json?.datetime || json?.utc_datetime || json?.currentDateTime;
        if (iso) {
          const ms = Date.parse(iso);
          if (!Number.isNaN(ms) && new Date(ms).getFullYear() >= MIN_VALID_YEAR) return ms;
        }
      } catch (_) {}
    } catch (_) {
      /* try next */
    }
  }

  const httpsUrls = [
    `https://s3.ap-south-1.amazonaws.com?_t=${ts}`,
    `https://www.google.com?_t=${ts}`,
  ];
  for (const url of httpsUrls) {
    try {
      const controller =
        typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), 3000)
        : null;
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer);
      const dateHdr = res.headers?.get?.('date') || res.headers?.get?.('Date');
      if (dateHdr) {
        const ms = Date.parse(dateHdr);
        if (!Number.isNaN(ms) && new Date(ms).getFullYear() >= MIN_VALID_YEAR) return ms;
      }
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

async function trySetSystemTime(targetMs) {
  const { SystemTimeModule } = NativeModules;
  if (!SystemTimeModule?.setTime) return false;
  try {
    if (typeof SystemTimeModule.setTimeAsync === 'function') {
      // Re-enable NTP after correction so auto_time=0 does not freeze a wrong clock again.
      const ok = await SystemTimeModule.setTimeAsync(targetMs, true);
      return !!ok;
    }
    SystemTimeModule.setTime(targetMs);
    await new Promise((r) => setTimeout(r, 400));
    return !deviceLooksSkewed(Date.now());
  } catch (e) {
    console.warn('SystemTimeModule.setTime failed:', e?.message || e);
    return false;
  }
}

/**
 * Ensure device clock is sane for TLS + SigV4 before any S3 put.
 * Fast path: If the local device clock year is already valid (>= 2025) and not paused,
 * it returns true immediately without blocking uploads.
 *
 * @param {boolean} forceCheck - Set true to force network time verification.
 * @throws {ClockSkewError} when skew cannot be corrected
 */
export async function ensureS3ClockOk(forceCheck = false) {
  const localMs = Date.now();

  // Fast path: If not forced, not currently paused, and year looks sane (>= 2025), proceed immediately
  if (!forceCheck && !pausedForSkew && !deviceLooksSkewed(localMs)) {
    return true;
  }

  console.log('🕒 Checking clock sanity for S3 signing:', new Date(localMs).toISOString());

  let networkMs = null;
  try {
    networkMs = await fetchNetworkTimeMs();
  } catch (_) {}

  let skewed = deviceLooksSkewed(localMs);
  if (networkMs != null) {
    const delta = Math.abs(localMs - networkMs);
    if (delta > MAX_SKEW_MS) {
      skewed = true;
      console.warn(
        `🕒 Clock skew vs network: ${(delta / 3600000).toFixed(1)}h (device=${new Date(localMs).toISOString()}, net=${new Date(networkMs).toISOString()})`
      );
    }
  }

  if (!skewed) {
    if (pausedForSkew) {
      pausedForSkew = false;
      DeviceEventEmitter.emit(CLOCK_SKEW_EVENT, { ok: true });
    }
    return true;
  }

  if (networkMs == null) {
    pausedForSkew = true;
    DeviceEventEmitter.emit(CLOCK_SKEW_EVENT, {
      ok: false,
      deviceIso: new Date(localMs).toISOString(),
    });
    toastSkewOnce('Device date/time is wrong. Fix it in Settings, then uploads will resume.');
    throw new ClockSkewError(
      `Device clock incorrect (${new Date(localMs).toISOString()}). Connect to Wi‑Fi or fix date/time in Settings.`
    );
  }

  console.warn('🕒 Attempting SystemTimeModule clock correction…');
  const synced = await trySetSystemTime(networkMs);
  await new Promise((r) => setTimeout(r, 300));

  const afterMs = Date.now();
  const stillSkewed =
    deviceLooksSkewed(afterMs) || Math.abs(afterMs - networkMs) > MAX_SKEW_MS;

  if (!stillSkewed) {
    console.log('✅ Device clock corrected:', new Date(afterMs).toISOString());
    pausedForSkew = false;
    DeviceEventEmitter.emit(CLOCK_SKEW_EVENT, { ok: true });
    return true;
  }

  pausedForSkew = true;
  DeviceEventEmitter.emit(CLOCK_SKEW_EVENT, {
    ok: false,
    deviceIso: new Date(afterMs).toISOString(),
  });
  toastSkewOnce(
    synced
      ? 'Could not fix device time. Open Settings → set correct date/time.'
      : 'Device date/time is wrong. Fix it in Settings, then uploads will resume.'
  );
  throw new ClockSkewError(
    `Device clock incorrect (${new Date(afterMs).toISOString()}). Fix date/time before uploading.`
  );
}

export default {
  ensureS3ClockOk,
  isClockSkewError,
  isUploadPausedForClockSkew,
  clearClockSkewPause,
  ClockSkewError,
  CLOCK_SKEW_CODE,
  CLOCK_SKEW_EVENT,
};
