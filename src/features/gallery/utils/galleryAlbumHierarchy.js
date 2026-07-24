import { MONTH_NAMES } from './galleryPathUtils';

const baseItem = (directory, type, nameLabel = directory.name) => ({
  id: directory.name,
  idLabel: directory.name,
  nameLabel,
  count: 0,
  cover: null,
  type,
  _coverDir: directory.path,
});

export const buildPatientAlbumItems = (directories) => directories
  .filter((directory) => {
    const name = directory?.name || '';
    // Enforce album-wise tree: patientId__Name or Unassigned only under user base.
    return name === 'Unassigned' || name.includes('__') || /^\d+$/.test(name);
  })
  .map((directory) => {
    const [idPart, namePart] = directory.name.split('__');
    return {
      ...baseItem(
        directory,
        'album',
        directory.name.includes('__') && namePart ? namePart.replace(/_/g, ' ') : ''
      ),
      idLabel: directory.name.includes('__') ? idPart || directory.name : directory.name,
    };
  })
  .sort((a, b) => (a.nameLabel || a.idLabel).localeCompare(b.nameLabel || b.idLabel));

export const buildYearAlbumItems = (directories) => directories
  .filter((directory) => /^\d{4}$/.test(directory?.name || ''))
  .sort((a, b) => b.name.localeCompare(a.name))
  .map((directory) => baseItem(directory, 'year'));

export const buildMonthAlbumItems = (directories) => directories
  .map((directory) => {
    const isDateFolder = /^\d{2}-\d{2}-\d{4}$/.test(directory.name);
    const isMonthFolder = /^\d{2}$/.test(directory.name);
    const month = Number.parseInt(directory.name, 10);
    return baseItem(
      directory,
      isDateFolder ? 'date' : isMonthFolder ? 'month' : 'folder',
      isMonthFolder && month >= 1 && month <= 12 ? MONTH_NAMES[month] : directory.name
    );
  })
  .sort((a, b) => {
    if (a.type === 'date' && b.type === 'date') {
      const [dayA, monthA, yearA] = a.id.split('-').map(Number);
      const [dayB, monthB, yearB] = b.id.split('-').map(Number);
      return new Date(yearB, monthB - 1, dayB) - new Date(yearA, monthA - 1, dayA);
    }
    return b.id.localeCompare(a.id);
  });

export const buildWeekAlbumItems = (directories) => directories
  .map((directory) => baseItem(
    directory,
    'week',
    directory.name.startsWith('W') ? `Week ${directory.name.slice(1)}` : directory.name
  ))
  .sort((a, b) => a.id.localeCompare(b.id));
