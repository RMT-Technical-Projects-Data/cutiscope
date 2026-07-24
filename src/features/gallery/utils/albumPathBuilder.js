/**
 * Canonical album path layout (must match CapturePipelineModule.kt):
 * DCIM/Camera/{userId}/{patientId__PatientName}/{yyyy}/{dd-mm-yyyy}/Cutiscope_….jpg
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { CAMERA_DIR } from '../../../shared/utils/cameraAndStorageConstants';

export const sanitizeFolderName = (s) => {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/[\s/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim().slice(0, 80);
};

export const buildPatientSegment = (boxId, boxName) => {
  if (boxId == null || String(boxId).trim() === '') return 'Unassigned';
  return `${boxId}__${sanitizeFolderName(boxName || '')}`;
};

export const buildUserSegment = ({ userId, username } = {}) => {
  if (userId != null && String(userId).trim() !== '') return String(userId);
  return sanitizeFolderName(username || 'user') || 'user';
};

export const buildDateSegments = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const year = String(d.getFullYear());
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return {
    year,
    dateSegment: `${day}-${month}-${year}`,
  };
};

/** Absolute directory for a capture (Android DCIM / iOS Dermscope). */
export const buildAlbumDirectory = ({
  userId,
  username,
  boxId,
  boxName,
  date = new Date(),
  forGuest = false,
  guestDir = null,
} = {}) => {
  if (forGuest && guestDir) {
    return String(guestDir).replace(/^file:\/\//, '');
  }
  const userSegment = buildUserSegment({ userId, username });
  const patientSegment = buildPatientSegment(boxId, boxName);
  const { year, dateSegment } = buildDateSegments(date);
  if (Platform.OS === 'android') {
    return `${CAMERA_DIR}/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
  }
  return `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
};

/** Relative album path segments from user base: [patient, year, date]. */
export const buildAlbumPathSegments = ({ boxId, boxName, date = new Date() } = {}) => {
  const patientSegment = buildPatientSegment(boxId, boxName);
  const { year, dateSegment } = buildDateSegments(date);
  return [patientSegment, year, dateSegment];
};

/** User gallery root (patient albums live under this). */
export const buildUserGalleryBase = ({ userId, username, forGuest = false, guestDir = null } = {}) => {
  if (forGuest) {
    return guestDir ? String(guestDir).replace(/^file:\/\//, '') : null;
  }
  const userSegment = buildUserSegment({ userId, username });
  if (Platform.OS === 'android') {
    return `${CAMERA_DIR}/${userSegment}`;
  }
  return `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}`;
};

export default {
  sanitizeFolderName,
  buildPatientSegment,
  buildUserSegment,
  buildDateSegments,
  buildAlbumDirectory,
  buildAlbumPathSegments,
  buildUserGalleryBase,
};
