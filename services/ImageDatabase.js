/**
 * Local image registry: each image carries its own identity (userId, patientId, createdAt).
 * Used for correct S3 path building and upload status — NOT dependent on current UI selection.
 * Persisted as JSON in app document directory (can be replaced with SQLite later).
 */

import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

const REGISTRY_FILENAME = 'dermaScope_image_registry.json';
const UPLOAD_STATUS = {
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  FAILED: 'FAILED',
  UPLOADED: 'UPLOADED',
};

let cache = null; // { images: [] }
let cacheDirty = false;

const getRegistryPath = () =>
  `${Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.DocumentDirectoryPath}/${REGISTRY_FILENAME}`;

const loadRegistry = async () => {
  if (cache && !cacheDirty) return cache;
  try {
    const path = getRegistryPath();
    const exists = await RNFS.exists(path);
    if (!exists) {
      cache = { version: 1, images: [] };
      return cache;
    }
    const raw = await RNFS.readFile(path, 'utf8');
    const data = JSON.parse(raw);
    cache = Array.isArray(data.images) ? data : { version: 1, images: data.images || [] };
    if (!cache.images) cache.images = [];
    cacheDirty = false;
    return cache;
  } catch (e) {
    console.warn('ImageDatabase: loadRegistry failed', e);
    cache = { version: 1, images: [] };
    return cache;
  }
};

const saveRegistry = async () => {
  if (!cache) return;
  try {
    const path = getRegistryPath();
    await RNFS.writeFile(path, JSON.stringify(cache), 'utf8');
    cacheDirty = false;
  } catch (e) {
    console.error('ImageDatabase: saveRegistry failed', e);
  }
};

const normalizePath = (p) => (p && p.replace(/^file:\/\//, '')) || '';

/**
 * Generate short unique id for image (used in S3 path).
 */
export const generateImageId = () => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}_${r}`.replace(/\./g, '');
};

/**
 * Save a new image record (call when photo is captured).
 * @param {Object} params
 * @param {string} params.id - Unique id (use generateImageId())
 * @param {string} params.userId - Logged-in user id
 * @param {string} params.patientId - Selected patient id at capture time
 * @param {string} [params.patientName] - Patient name (optional)
 * @param {string} params.filePath - Local file path
 * @param {string} params.createdAt - ISO date string
 * @param {string} [params.uploadStatus] - Default PENDING
 * @param {string} [params.awsUrl] - Set when upload succeeds
 */
export const saveImage = async (params) => {
  const reg = await loadRegistry();
  const record = {
    id: params.id,
    userId: String(params.userId || ''),
    userName: params.userName != null ? String(params.userName) : '',
    patientId: String(params.patientId || ''),
    patientName: params.patientName != null ? String(params.patientName) : '',
    filePath: normalizePath(params.filePath),
    createdAt: params.createdAt || new Date().toISOString(),
    uploadStatus: params.uploadStatus || UPLOAD_STATUS.PENDING,
    awsUrl: params.awsUrl || null,
  };
  const existing = reg.images.findIndex((i) => i.id === record.id || normalizePath(i.filePath) === record.filePath);
  if (existing >= 0) reg.images[existing] = record;
  else reg.images.push(record);
  cacheDirty = true;
  await saveRegistry();
  return record;
};

/**
 * Get image by id.
 */
export const getImage = async (id) => {
  const reg = await loadRegistry();
  return reg.images.find((i) => i.id === id) || null;
};

/**
 * Get image by file path (normalized).
 */
export const getImageByFilePath = async (filePath) => {
  const reg = await loadRegistry();
  const clean = normalizePath(filePath);
  return reg.images.find((i) => normalizePath(i.filePath) === clean) || null;
};

/**
 * Get all images for a patient.
 */
export const getImagesByPatient = async (patientId) => {
  const reg = await loadRegistry();
  return reg.images.filter((i) => i.patientId === String(patientId));
};

/**
 * Get images that are PENDING or FAILED (for retry).
 */
export const getImagesPendingUpload = async () => {
  const reg = await loadRegistry();
  return reg.images.filter((i) => i.uploadStatus === UPLOAD_STATUS.PENDING || i.uploadStatus === UPLOAD_STATUS.FAILED);
};

/**
 * Update upload status (and optionally awsUrl) for an image.
 */
export const updateUploadStatus = async (id, uploadStatus, awsUrl = null) => {
  const reg = await loadRegistry();
  const idx = reg.images.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  reg.images[idx].uploadStatus = uploadStatus;
  if (awsUrl != null) reg.images[idx].awsUrl = awsUrl;
  cacheDirty = true;
  await saveRegistry();
  return reg.images[idx];
};

/**
 * Update upload status by file path (for queue that only has path).
 */
export const updateUploadStatusByFilePath = async (filePath, uploadStatus, awsUrl = null) => {
  const reg = await loadRegistry();
  const clean = normalizePath(filePath);
  const idx = reg.images.findIndex((i) => normalizePath(i.filePath) === clean);
  if (idx < 0) return null;
  reg.images[idx].uploadStatus = uploadStatus;
  if (awsUrl != null) reg.images[idx].awsUrl = awsUrl;
  cacheDirty = true;
  await saveRegistry();
  return reg.images[idx];
};

/**
 * Mark image as deleted (optional: remove from registry when file is deleted).
 */
export const removeImageByFilePath = async (filePath) => {
  const reg = await loadRegistry();
  const clean = normalizePath(filePath);
  reg.images = reg.images.filter((i) => normalizePath(i.filePath) !== clean);
  cacheDirty = true;
  await saveRegistry();
};

/**
 * Batch-remove many images in a single registry rewrite. Much faster than
 * calling removeImageByFilePath in a loop (which rewrites the whole JSON file
 * once per image).
 */
export const removeImagesByFilePaths = async (filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;
  const reg = await loadRegistry();
  const cleanSet = new Set(filePaths.map(normalizePath));
  reg.images = reg.images.filter((i) => !cleanSet.has(normalizePath(i.filePath)));
  cacheDirty = true;
  await saveRegistry();
};

/**
 * Get a map of file path -> uploadStatus for batch UI (e.g. gallery).
 */
export const getUploadStatusMap = async () => {
  const reg = await loadRegistry();
  const map = {};
  reg.images.forEach((i) => {
    map[normalizePath(i.filePath)] = i.uploadStatus;
  });
  return map;
};

export { UPLOAD_STATUS };

export default {
  generateImageId,
  saveImage,
  getImage,
  getImageByFilePath,
  getImagesByPatient,
  getImagesPendingUpload,
  updateUploadStatus,
  updateUploadStatusByFilePath,
  removeImageByFilePath,
  removeImagesByFilePaths,
  getUploadStatusMap,
  UPLOAD_STATUS,
};
