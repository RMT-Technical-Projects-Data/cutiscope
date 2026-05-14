import axios from 'axios';
import Config from 'react-native-config';
import authService from './authService';

const BASE_URL = (Config.API_BASE_URL || 'http://192.168.50.144:3009').replace(/\/$/, '');
const PATIENTS_URL = `${BASE_URL}/api/patients`;
const PATIENTS_V2_URL = `${BASE_URL}/api/v2/patients`;
const AXIOS_TIMEOUT = 15000;

/**
 * GET /api/patients/next-id – next available patient id for this clinician.
 * Returns { id: "001" }.
 */
export async function getNextPatientId() {
  const token = await authService.getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

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
  return list.map((p) => ({
    id: String(p.id ?? p.patient_id ?? p.patientId ?? ''),
    name: String(p.name ?? p.patient_name ?? p.patientName ?? ''),
  })).filter((p) => p.id || p.name);
}

/**
 * Create a patient in the backend (patients table).
 * Sends POST /api/patients with { name }. Backend assigns next id.
 * Optional { id } for backward compat; if omitted backend uses next available.
 */
export async function createPatient({ id, name, dob, gender, age, mr_no }) {
  const token = await authService.getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = name != null && String(name).trim() ? { name: String(name).trim() } : {};
  if (id != null && String(id).trim()) body.id = String(id).trim();
  if (dob != null) body.dob = String(dob).trim();
  if (gender != null) body.gender = String(gender).trim();
  if (age != null) body.age = String(age).trim();
  if (mr_no != null) body.mr_no = String(mr_no).trim();

  const response = await axios.post(
    PATIENTS_V2_URL,
    body,
    { timeout: AXIOS_TIMEOUT, headers, validateStatus: () => true }
  );

  if (response.status === 201 || response.status === 200) {
    const resBody = response.data;
    const p = resBody?.patient || resBody;
    if (p && (p.id != null || p.patient_id != null)) {
      return {
        id: String(p.id ?? p.patient_id).trim(),
        name: String(p.name ?? p.patient_name ?? name ?? '').trim(),
      };
    }
    if (resBody && (resBody.id != null || resBody.name != null)) {
      return {
        id: String(resBody.id ?? resBody.patient_id ?? '').trim(),
        name: String(resBody.name ?? resBody.patient_name ?? name ?? '').trim(),
      };
    }
    return { id: (id != null ? String(id) : '').trim(), name: String(name || '').trim() };
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
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await axios.post(
      `${PATIENTS_URL}/record-photo`,
      { patient_number: String(patientNumber).trim() },
      { timeout: AXIOS_TIMEOUT, headers, validateStatus: () => true }
    );
  } catch (err) {
    console.warn('Record photo capture failed:', err?.message || err);
  }
}
