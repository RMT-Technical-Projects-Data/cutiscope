import { Dimensions } from 'react-native';

export const { width, height: screenHeight } = Dimensions.get('window');
export const HORIZONTAL_PADDING = 16;
export const ALBUM_GAP = 10;
export const ALBUM_CARD_SIZE = Math.floor(
  (width - HORIZONTAL_PADDING * 2 - ALBUM_GAP) / 2
);
export const THUMBNAIL_SIZE = Math.floor(
  (width - HORIZONTAL_PADDING * 2 - 6 * 2) / 3 - 6
);

export const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const PRIMARY_BACKGROUND = '#000000';
export const PRIMARY_TEXT = '#FFFFFF';
export const SECONDARY_TEXT = '#AAAAAA';
export const ACCENT_TEAL = '#22B2A6';

export const normalizePhotoPath = (photo) => {
  if (!photo) return '';
  if (typeof photo === 'string') {
    return photo.replace(/^file:\/\//, '').split('?')[0];
  }
  return (
    photo.absolutePath ||
    String(photo.path || '').replace(/^file:\/\//, '')
  ).split('?')[0];
};

/** True when this photo has finished uploading (status or legacy AsyncStorage flag). */
export const isPhotoUploaded = (photo) => {
  if (!photo) return false;
  if (photo.uploadStatus === 'UPLOADED') return true;
  return false;
};

/** Friendly title for the current gallery path segment (matches album tile labels). */
export const formatAlbumPathTitle = (albumPath = [], albumItems = []) => {
  if (!albumPath?.length) return 'Gallery';
  const lastId = albumPath[albumPath.length - 1];
  const fromItems = (albumItems || []).find((f) => f.id === lastId);
  if (fromItems) return fromItems.nameLabel || fromItems.idLabel || lastId;

  if (/^\d{4}$/.test(lastId)) return lastId;
  if (/^\d{2}$/.test(lastId)) {
    const month = Number.parseInt(lastId, 10);
    if (month >= 1 && month <= 12) return MONTH_NAMES[month];
  }
  if (lastId?.startsWith('W')) return `Week ${lastId.slice(1)}`;
  if (lastId?.includes('__')) {
    const [idPart, namePart] = lastId.split('__');
    return namePart ? namePart.replace(/_/g, ' ') : idPart || lastId;
  }
  return lastId || 'Gallery';
};

export const DELETED_FILES_KEY = 'deleted_gallery_files_v2';
