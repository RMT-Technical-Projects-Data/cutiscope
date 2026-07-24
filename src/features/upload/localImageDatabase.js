/**
 * Local image registry: each image carries its own identity (userId, patientId, createdAt).
 * Android prefers durable SQLite via UploadQueueModule; JSON file remains the fallback.
 */

import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import UploadQueueNative from '../../shared/native/UploadQueueNative';

const REGISTRY_FILENAME = 'dermaScope_image_registry.json';
const UPLOAD_STATUS = {
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  FAILED: 'FAILED',
  UPLOADED: 'UPLOADED',
};

let cache = null;
let cacheDirty = false;

const getRegistryPath = () =>
  `${Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.DocumentDirectoryPath}/${REGISTRY_FILENAME}`;

const normalizePath = (p) => (p && p.replace(/^file:\/\//, '')) || '';

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

export const generateImageId = () => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}_${r}`.replace(/\./g, '');
};

export const saveImage = async (params) => {
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

  if (UploadQueueNative.isAvailable()) {
    try {
      await UploadQueueNative.upsertImage(record);
    } catch (e) {
      console.warn('UploadQueueNative.upsertImage failed, using JSON:', e?.message || e);
    }
  }

  const reg = await loadRegistry();
  const existing = reg.images.findIndex((i) => i.id === record.id || normalizePath(i.filePath) === record.filePath);
  if (existing >= 0) reg.images[existing] = record;
  else reg.images.push(record);
  cacheDirty = true;
  await saveRegistry();
  return record;
};

export const getImage = async (id) => {
  const reg = await loadRegistry();
  return reg.images.find((i) => i.id === id) || null;
};

export const getImageByFilePath = async (filePath) => {
  if (UploadQueueNative.isAvailable()) {
    try {
      const row = await UploadQueueNative.getImageByFilePath(filePath);
      if (row) return row;
    } catch (_) {}
  }
  const reg = await loadRegistry();
  const clean = normalizePath(filePath);
  return reg.images.find((i) => normalizePath(i.filePath) === clean) || null;
};

export const getImagesByPatient = async (patientId) => {
  const reg = await loadRegistry();
  return reg.images.filter((i) => i.patientId === String(patientId));
};

export const getImagesPendingUpload = async () => {
  if (UploadQueueNative.isAvailable()) {
    try {
      const rows = await UploadQueueNative.getPendingImages();
      if (Array.isArray(rows) && rows.length) return rows;
    } catch (_) {}
  }
  const reg = await loadRegistry();
  return reg.images.filter((i) => i.uploadStatus === UPLOAD_STATUS.PENDING || i.uploadStatus === UPLOAD_STATUS.FAILED);
};

export const updateUploadStatus = async (id, uploadStatus, awsUrl = null) => {
  const reg = await loadRegistry();
  const idx = reg.images.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  reg.images[idx].uploadStatus = uploadStatus;
  if (awsUrl != null) reg.images[idx].awsUrl = awsUrl;
  cacheDirty = true;
  await saveRegistry();
  if (UploadQueueNative.isAvailable()) {
    try {
      await UploadQueueNative.updateStatus(reg.images[idx].filePath, uploadStatus, awsUrl);
    } catch (_) {}
  }
  return reg.images[idx];
};

export const updateUploadStatusByFilePath = async (filePath, uploadStatus, awsUrl = null) => {
  if (UploadQueueNative.isAvailable()) {
    try {
      await UploadQueueNative.updateStatus(filePath, uploadStatus, awsUrl);
    } catch (_) {}
  }
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

export const removeImageByFilePath = async (filePath) => {
  if (UploadQueueNative.isAvailable()) {
    try {
      await UploadQueueNative.removeByFilePath(filePath);
    } catch (_) {}
  }
  const reg = await loadRegistry();
  const clean = normalizePath(filePath);
  reg.images = reg.images.filter((i) => normalizePath(i.filePath) !== clean);
  cacheDirty = true;
  await saveRegistry();
};

export const removeImagesByFilePaths = async (filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;
  if (UploadQueueNative.isAvailable()) {
    try {
      await UploadQueueNative.removeByFilePaths(filePaths);
    } catch (_) {}
  }
  const reg = await loadRegistry();
  const cleanSet = new Set(filePaths.map(normalizePath));
  reg.images = reg.images.filter((i) => !cleanSet.has(normalizePath(i.filePath)));
  cacheDirty = true;
  await saveRegistry();
};

export const getUploadStatusMap = async () => {
  if (UploadQueueNative.isAvailable()) {
    try {
      const map = await UploadQueueNative.getUploadStatusMap();
      if (map && typeof map === 'object') return map;
    } catch (_) {}
  }
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
