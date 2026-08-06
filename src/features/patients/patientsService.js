import axios from 'axios';
import Config from 'react-native-config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import authService from '../auth/authService';
import { consolidatePatientFoldersForPatient } from './patientFolderSync';

const BASE_URL = (Config.API_BASE_URL || 'http://35.154.32.201:4040').replace(/\/$/, '');
const PATIENTS_URL = `${BASE_URL}/api/patients`;
const PATIENTS_V2_URL = `${BASE_URL}/api/v2/patients`;
const AXIOS_TIMEOUT = 15000;

async function buildMobileApiHeaders(token) {
  const headers = { 'Content-Type': 'application/json', 'X-Client': 'mobile-app' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const serialNumber = await AsyncStorage.getItem('serial_number');
    if (serialNumber) headers['X-Device-ID'] = serialNumber;
  } catch (e) {
    console.warn('Failed to retrieve serial number for patient API headers:', e);
  }
  return headers;
}

/**
 * GET /api/patients/next-id – next available patient id for this clinician.
 * Returns { id: "001" }.
 */
export async function getNextPatientId() {
  const token = await authService.getToken();
  const headers = await buildMobileApiHeaders(token);
  const response = await axios.get(`${PATIENTS_URL}/next-id`, {
    timeout: AXIOS_TIMEOUT,
    headers,
    validateStatus: () => true,
  });
  if (response.status !== 200) {
    const msg = (response.data && response.data.message) || `Request failed (${response.status})`;
    throw new Error(msg);
  }
  const id = response.data && response.data.id != null ? String(response.data.id) : '001';
  return id;
}

/**
 * Fetch list of patients from backend (patients table).
 * Expects GET /api/patients to return { patients: [{ id, name }, ...] } or [{ id, name }, ...].
 */
export async function getPatients() {
  const token = await authService.getToken();
  const headers = await buildMobileApiHeaders(token);

  const response = await axios.get(PATIENTS_URL, {
    timeout: AXIOS_TIMEOUT,
    headers,
    validateStatus: () => true,
  });

  if (response.status === 404) {
    throw new Error('Patients API not found. Add GET /api/patients to your backend. See docs/BACKEND_PATIENTS_API.md');
  }
  if (response.status !== 200) {
    const msg = (response.data && response.data.message) || response.data?.error || `Request failed (${response.status})`;
    throw new Error(msg);
  }

  const data = response.data;
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.patients)) list = data.patients;
  else if (data && Array.isArray(data.rows)) list = data.rows;
  // Normalize to { id, name }
  return list
    .map((p) => ({
      id: String(p.id ?? p.patient_id ?? p.patientId ?? ''),
      name: String(p.name ?? p.patient_name ?? p.patientName ?? ''),
    }))
    .filter((p) => p.id || p.name)
    .sort(comparePatientIds);
}

/**
 * IDs are zero-padded strings ('001', '010', '100'), and some backends return
 * plain numbers. Compare numerically so 10 never sorts before 9.
 */
function comparePatientIds(a, b) {
  const digitsA = String(a.id).replace(/\D/g, '');
  const digitsB = String(b.id).replace(/\D/g, '');
  const numA = digitsA ? Number(digitsA) : NaN;
  const numB = digitsB ? Number(digitsB) : NaN;
  const aIsNum = Number.isFinite(numA);
  const bIsNum = Number.isFinite(numB);

  if (aIsNum && bIsNum && numA !== numB) return numA - numB;
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

/**
 * The create endpoint can answer with an id that GET /api/patients never uses for
 * the same patient (a row key rather than the clinician's patient number), which is
 * why a patient saved as 19 came back as 189. The list is the id every other screen
 * and the photo folders rely on, so the created patient is looked up there.
 */
async function resolveCreatedPatientId(responseId, createdName) {
  const fallback = String(responseId ?? '').trim();
  try {
    const list = await getPatients();
    if (!Array.isArray(list) || list.length === 0) return fallback;
    if (fallback && list.some((p) => String(p.id) === fallback)) return fallback;

    const nameKey = String(createdName ?? '').trim().toLowerCase();
    if (!nameKey) return fallback;
    const matches = list.filter(
      (p) => String(p.name ?? '').trim().toLowerCase() === nameKey
    );
    if (matches.length === 0) return fallback;
    // Ids ascend, so the newest duplicate name is the one just created.
    const newest = matches.reduce((best, p) => (comparePatientIds(p, best) > 0 ? p : best));
    return String(newest.id).trim();
  } catch (e) {
    console.warn('resolveCreatedPatientId failed:', e?.message || e);
    return fallback;
  }
}

/**
 * If the locally selected patient still exists on the server but its name (or
 * other display fields) changed on the web portal, return the fresh { id, name }.
 * Returns null when unchanged, missing selection, or fetch fails.
 */
export async function reconcileSelectedPatient(current) {
  if (!current?.id) return null;
  try {
    const list = await getPatients();
    const match = list.find((p) => String(p.id) === String(current.id));
    if (match) {
      if (String(match.name || '') === String(current.name || '')) return null;
      return { id: String(match.id), name: String(match.name || '') };
    }

    // Selections saved before create returned list ids hold an id the list does not
    // know. Recover it by name, but only when the name identifies one patient.
    const nameKey = String(current.name || '').trim().toLowerCase();
    if (!nameKey) return null;
    const byName = list.filter((p) => String(p.name || '').trim().toLowerCase() === nameKey);
    if (byName.length !== 1) return null;
    return { id: String(byName[0].id), name: String(byName[0].name || '') };
  } catch (e) {
    console.warn('reconcileSelectedPatient failed:', e?.message || e);
    return null;
  }
}

/**
 * Pull portal changes for the selected patient and merge any duplicate local folders
 * into the canonical `{id}__{name}` album (same behavior as web S3 folder rename).
 * Returns updated { id, name } when metadata changed, otherwise null.
 */
export async function applyPatientUpdateFromServer(current, { userId, username } = {}) {
  const updated = await reconcileSelectedPatient(current);
  const next = updated || current;
  if (next?.id && next?.name) {
    await consolidatePatientFoldersForPatient({
      userId,
      username,
      patientId: next.id,
      patientName: next.name,
    });
  }
  return updated;
}

/**
 * Create a patient in the backend (patients table).
 * Sends POST /api/patients with { name }. Backend assigns next id.
 * Optional { id } for backward compat; if omitted backend uses next available.
 */
export async function createPatient({ id, name, dob, gender, age, mr_no }) {
  const token = await authService.getToken();
  const headers = await buildMobileApiHeaders(token);
  const body = name != null && String(name).trim() ? { name: String(name).trim() } : {};
  if (id != null && String(id).trim()) body.id = String(id).trim();
  if (dob != null) {
    const trimmedDob = String(dob).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmedDob)) {
      const [d, m, y] = trimmedDob.split('/');
      body.dob = `${y}-${m}-${d}`;
    } else {
      body.dob = trimmedDob;
    }
  }
  if (gender != null) body.gender = String(gender).trim();
  // if (age != null) body.age = String(age).trim();
  if (mr_no != null) body.mr_no = String(mr_no).trim();

  const response = await axios.post(
    PATIENTS_V2_URL,
    body,
    { timeout: AXIOS_TIMEOUT, headers, validateStatus: () => true }
  );

  if (response.status === 201 || response.status === 200) {
    const resBody = response.data;
    const p = resBody?.patient || resBody;
    const createdName = String(
      p?.name ?? p?.patient_name ?? resBody?.name ?? resBody?.patient_name ?? name ?? ''
    ).trim();
    const responseId = String(
      p?.patient_number ??
      p?.patient_id ??
      p?.id ??
      resBody?.patient_number ??
      resBody?.patient_id ??
      resBody?.id ??
      id ??
      ''
    ).trim();
    return {
      id: await resolveCreatedPatientId(responseId, createdName),
      name: createdName,
    };
  }

  if (response.status === 404) {
    throw new Error('Patients API not found. Add POST /api/patients to your backend. See docs/BACKEND_PATIENTS_API.md');
  }

  const msg = (response.data && response.data.message) || response.data?.error || 'Could not create patient';
  throw new Error(msg);
}

/**
 * POST /api/patients/record-photo – record that the clinician captured a photo for a patient.
 * Updates patients.total_photos_clicked, last_clicked and clinician_patient. Fire-and-forget;
 * failures are logged but do not throw (so capture flow is not blocked).
 */
export async function recordPhotoCapture(patientNumber) {
  if (!patientNumber || !String(patientNumber).trim()) return;
  try {
    const token = await authService.getToken();
    if (!token) return;
    const headers = await buildMobileApiHeaders(token);
    await axios.post(
      `${PATIENTS_URL}/record-photo`,
      { patient_number: String(patientNumber).trim() },
      { timeout: AXIOS_TIMEOUT, headers, validateStatus: () => true }
    );
  } catch (err) {
    console.warn('Record photo capture failed:', err?.message || err);
  }
}
