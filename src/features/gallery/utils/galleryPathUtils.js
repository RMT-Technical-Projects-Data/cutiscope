import { Dimensions } from 'react-native';

export const { width, height: screenHeight } = Dimensions.get('window');
export const HORIZONTAL_PADDING = 16;
export const ALBUM_GAP = 10;
export const ALBUM_CARD_SIZE = Math.floor(
  (width - HORIZONTAL_PADDING * 2 - ALBUM_GAP) / 2
);
export const THUMBNAIL_SIZE = width / 3 - 6;

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

export const DELETED_FILES_KEY = 'deleted_gallery_files_v2';
