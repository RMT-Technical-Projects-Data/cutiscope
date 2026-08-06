import RNFS from 'react-native-fs';
import { DeviceEventEmitter } from 'react-native';
import {
  buildPatientSegment,
  buildUserGalleryBase,
} from '../gallery/utils/albumPathBuilder';
import {
  GALLERY_PENDING_CHANGED,
  renamePatientFoldersInSnapshot,
} from '../gallery/gallerySnapshotCache';
import { remapPatientFolderPaths } from '../upload/localImageDatabase';
import { remapQueuedFilePaths } from '../upload/optimisedUploadQueue';

const patientNumberFromFolderName = (folderName) => {
  const raw = String(folderName || '').includes('__')
    ? String(folderName).split('__')[0]
    : String(folderName || '');
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : NaN;
};

const folderMatchesPatientId = (folderName, patientId) => {
  const folderNum = patientNumberFromFolderName(folderName);
  const targetNum = Number(String(patientId ?? '').replace(/\D/g, ''));
  return Number.isFinite(folderNum) && Number.isFinite(targetNum) && folderNum === targetNum;
};

const mergeDirectoryContents = async (sourceDir, destDir) => {
  const sourceExists = await RNFS.exists(sourceDir);
  if (!sourceExists) return;

  const destExists = await RNFS.exists(destDir);
  if (!destExists) {
    await RNFS.moveFile(sourceDir, destDir);
    return;
  }

  const items = await RNFS.readDir(sourceDir);
  for (const item of items) {
    const destPath = `${destDir}/${item.name}`;
    if (item.isDirectory()) {
      const childDestExists = await RNFS.exists(destPath);
      if (childDestExists) {
        await mergeDirectoryContents(item.path, destPath);
      } else {
        await RNFS.moveFile(item.path, destPath);
      }
    } else if (!(await RNFS.exists(destPath))) {
      await RNFS.moveFile(item.path, destPath);
    }
  }

  try {
    const remaining = await RNFS.readDir(sourceDir);
    if (remaining.length === 0) {
      await RNFS.unlink(sourceDir);
    }
  } catch (_) {
    // Best-effort cleanup of an empty source folder.
  }
};

const notifyGalleryFoldersChanged = () => {
  try {
    DeviceEventEmitter.emit(GALLERY_PENDING_CHANGED, { foldersConsolidated: true });
  } catch (_) {
    // Non-fatal — gallery will refresh on next open.
  }
};

/**
 * Merge all on-device album folders for one patient into the canonical
 * `{patientId}__{sanitizedName}` folder (matches web portal S3 rename behavior).
 */
export async function consolidatePatientFoldersForPatient({
  userId,
  username,
  patientId,
  patientName,
}) {
  if (!patientId || String(patientId).trim() === '') {
    return { consolidated: false, mergedFolders: [] };
  }

  const userBase = buildUserGalleryBase({ userId, username });
  if (!userBase || !(await RNFS.exists(userBase))) {
    return { consolidated: false, mergedFolders: [] };
  }

  const targetSegment = buildPatientSegment(patientId, patientName);
  const targetPath = `${userBase}/${targetSegment}`;
  const list = await RNFS.readDir(userBase);
  const matching = list.filter(
    (item) =>
      item.isDirectory() &&
      folderMatchesPatientId(item.name, patientId) &&
      item.name !== targetSegment
  );

  if (matching.length === 0) {
    return { consolidated: false, targetSegment, mergedFolders: [] };
  }

  const mergedFolders = [];
  for (const folder of matching) {
    try {
      await mergeDirectoryContents(folder.path, targetPath);
      mergedFolders.push(folder.name);
    } catch (err) {
      console.warn(
        'Patient folder consolidate failed:',
        folder.name,
        '→',
        targetSegment,
        err?.message || err
      );
    }
  }

  if (mergedFolders.length > 0) {
    const { pathMap } = await remapPatientFolderPaths({
      oldSegments: mergedFolders,
      newSegment: targetSegment,
      patientId,
      patientName,
    });
    remapQueuedFilePaths(pathMap);
    renamePatientFoldersInSnapshot(mergedFolders, targetSegment);
    notifyGalleryFoldersChanged();
    console.log(
      'Consolidated patient folders:',
      patientId,
      mergedFolders.join(', '),
      '→',
      targetSegment
    );
  }

  return {
    consolidated: mergedFolders.length > 0,
    targetSegment,
    mergedFolders,
  };
};

/**
 * When multiple patient folders share the same id on disk, merge each group
 * into the name from the server list (or the newest folder if missing).
 */
export async function consolidateDuplicatePatientFolders({
  userId,
  username,
  patients = [],
}) {
  const userBase = buildUserGalleryBase({ userId, username });
  if (!userBase || !(await RNFS.exists(userBase))) {
    return { groupsMerged: 0 };
  }

  const list = await RNFS.readDir(userBase);
  const dirs = list.filter((item) => item.isDirectory());
  const byPatientId = new Map();

  for (const dir of dirs) {
    const num = patientNumberFromFolderName(dir.name);
    if (!Number.isFinite(num)) continue;
    const key = String(num);
    if (!byPatientId.has(key)) byPatientId.set(key, []);
    byPatientId.get(key).push(dir);
  }

  let groupsMerged = 0;
  for (const [idKey, folderDirs] of byPatientId.entries()) {
    if (folderDirs.length <= 1) continue;

    const serverPatient = (patients || []).find(
      (p) => String(p.id).replace(/\D/g, '') === idKey
    );
    const patientId = serverPatient?.id ?? folderDirs[0].name.split('__')[0] ?? idKey;
    let patientName = serverPatient?.name;

    if (!patientName) {
      const newest = folderDirs.reduce((best, dir) =>
        new Date(dir.mtime).getTime() > new Date(best.mtime).getTime() ? dir : best
      );
      const namePart = newest.name.includes('__')
        ? newest.name.split('__').slice(1).join('__')
        : '';
      patientName = namePart.replace(/_/g, ' ');
    }

    const result = await consolidatePatientFoldersForPatient({
      userId,
      username,
      patientId,
      patientName,
    });
    if (result.consolidated) groupsMerged += 1;
  }

  return { groupsMerged };
}

export default {
  consolidatePatientFoldersForPatient,
  consolidateDuplicatePatientFolders,
  folderMatchesPatientId,
  patientNumberFromFolderName,
};
