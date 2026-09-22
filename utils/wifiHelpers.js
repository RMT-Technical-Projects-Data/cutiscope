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

/** Adaptive interval while Wi-Fi picker is open (keep responsive like Android Settings). */
export function getAdaptiveScanInterval(scanSessionStartMs, hasFadingNetworks = false) {
  const elapsed = Date.now() - (scanSessionStartMs || Date.now());
  let baseInterval = 2000; // first ~60s: aggressive
  if (elapsed >= 180000) {
    baseInterval = 4500; // after 3 min
  } else if (elapsed >= 60000) {
    baseInterval = 3000; // 1–3 min
  }
  return hasFadingNetworks ? Math.min(baseInterval, 1500) : baseInterval;
}

/** Short backoff after scan failures — still stay responsive. */
export function getScanFailureBackoffMs(retryCount) {
  if (retryCount <= 0) return 2000;
  return Math.min(2000 * Math.pow(2, retryCount - 1), 6000);
}

/**
 * Merge a fresh scan with the previous list so newly appeared SSIDs show up
 * immediately and briefly-missed SSIDs don't flicker away.
 */
export function mergeWifiScanResults(previousNetworks, scannedNetworks, scanNow = Date.now()) {
  const latestScanMap = new Map();
  (scannedNetworks || []).forEach((network) => {
    const ssid = normalizeSSID(network?.SSID);
    if (!ssid || ssid === '<unknown ssid>' || ssid === '0x') return;
    const currentBest = latestScanMap.get(ssid);
    const level = network.level || -75;
    if (!currentBest || Math.abs(level) < Math.abs(currentBest.level || -100)) {
      latestScanMap.set(ssid, {
        ...network,
        SSID: network.SSID?.trim?.() ? network.SSID.trim() : ssid,
        BSSID: network.BSSID || `ssid_${ssid}_${scanNow}`,
        level,
        capabilities: network.capabilities || '',
        timestamp: scanNow,
        isFading: false,
        missCount: 0,
      });
    }
  });

  const merged = [];
  const seen = new Set(latestScanMap.keys());

  (previousNetworks || []).forEach((oldNet) => {
    const ssid = normalizeSSID(oldNet?.SSID);
    if (!ssid || seen.has(ssid)) return;
    const missCount = (oldNet.missCount || 0) + 1;
    const firstMissedAt = oldNet.firstMissedAt || scanNow;
    // One missed scan / ~2.5s — drop gone hotspots quickly without heavy flicker.
    if (missCount <= 1 && scanNow - firstMissedAt < 2500) {
      merged.push({
        ...oldNet,
        isFading: true,
        missCount,
        firstMissedAt,
      });
    }
  });

  latestScanMap.forEach((net) => merged.push(net));

  return merged.sort(
    (a, b) => Math.abs(a.level || -100) - Math.abs(b.level || -100)
  );
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
