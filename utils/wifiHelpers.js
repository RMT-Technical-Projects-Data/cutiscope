import AsyncStorage from '@react-native-async-storage/async-storage';

export function normalizeSSID(ssid) {
  if (!ssid) return '';
  const value = String(ssid).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

export function ssidsMatch(a, b) {
  return normalizeSSID(a) === normalizeSSID(b);
}

export function getPasswordForSSID(passwords, ssid) {
  const normalized = normalizeSSID(ssid);
  if (!normalized) return undefined;
  if (passwords[normalized] != null) return passwords[normalized];
  const matchedKey = Object.keys(passwords).find((key) => ssidsMatch(key, normalized));
  return matchedKey != null ? passwords[matchedKey] : undefined;
}

export function removeAllPasswordVariants(passwords, ssid) {
  const normalized = normalizeSSID(ssid);
  const updated = { ...passwords };
  Object.keys(updated).forEach((key) => {
    if (ssidsMatch(key, normalized)) {
      delete updated[key];
    }
  });
  return updated;
}

export function normalizePasswordMap(passwords) {
  const normalizedPasswords = {};
  Object.entries(passwords || {}).forEach(([ssid, password]) => {
    const key = normalizeSSID(ssid);
    if (key) normalizedPasswords[key] = password;
  });
  return normalizedPasswords;
}

/** Adaptive interval: 4s → 8s → 15s based on how long the scan session has been open. */
export function getAdaptiveScanInterval(scanSessionStartMs, hasFadingNetworks = false) {
  const elapsed = Date.now() - scanSessionStartMs;
  let baseInterval = 4000;
  if (elapsed >= 120000) {
    baseInterval = 15000;
  } else if (elapsed >= 30000) {
    baseInterval = 8000;
  }
  return hasFadingNetworks ? Math.min(baseInterval, 3000) : baseInterval;
}

/** Exponential backoff after scan failures: 4s → 8s → 16s (capped). */
export function getScanFailureBackoffMs(retryCount) {
  if (retryCount <= 0) return 4000;
  return Math.min(4000 * Math.pow(2, retryCount - 1), 16000);
}

export function getNetworkListFingerprint(networks) {
  return (networks || [])
    .map((n) => normalizeSSID(n.SSID))
    .filter(Boolean)
    .sort()
    .join('|');
}

export const WIFI_SAVED_NETWORKS_KEY = '@wifi_saved_networks';

export async function loadPersistedSavedNetworkSSIDs() {
  try {
    const raw = await AsyncStorage.getItem(WIFI_SAVED_NETWORKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(normalizeSSID).filter(Boolean))];
  } catch (error) {
    console.warn('Error loading saved network SSIDs:', error);
    return [];
  }
}

export async function persistSavedNetworkSSID(ssid) {
  const normalized = normalizeSSID(ssid);
  if (!normalized) return [];

  try {
    const existing = await loadPersistedSavedNetworkSSIDs();
    if (existing.some((entry) => ssidsMatch(entry, normalized))) {
      return existing;
    }
    const updated = [...existing, normalized];
    await AsyncStorage.setItem(WIFI_SAVED_NETWORKS_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.warn('Error persisting saved network SSID:', error);
    return [];
  }
}

export async function removePersistedSavedNetworkSSID(ssid) {
  const normalized = normalizeSSID(ssid);
  if (!normalized) return [];

  try {
    const existing = await loadPersistedSavedNetworkSSIDs();
    const updated = existing.filter((entry) => !ssidsMatch(entry, normalized));
    await AsyncStorage.setItem(WIFI_SAVED_NETWORKS_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.warn('Error removing saved network SSID:', error);
    return [];
  }
}
