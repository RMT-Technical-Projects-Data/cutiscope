import RNFS from "react-native-fs";
import { Platform } from "react-native";
import { ensureGuestPhotosDir } from "../../gallery/guestPhotoStorage";
import CapturePipeline from "../../../shared/native/CapturePipeline";

const sanitizeFolderName = (s) => {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/[\s/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim().slice(0, 80);
};

export const saveImageLocallyOnly = async (sourcePath, fileName = null, options = {}) => {
  const { forGuest = false, skipScan = false, keepSource = false } = options;
  const effectiveBox = options.box !== undefined ? options.box : null;
  const effectiveUserData = options.ctxUserData !== undefined ? options.ctxUserData : null;

  // Fast path: single Kotlin mkdir/move/scan call.
  if (CapturePipeline.isAvailable()) {
    try {
      let guestDir = null;
      if (forGuest) {
        guestDir = await ensureGuestPhotosDir();
      }
      const result = await CapturePipeline.saveImage({
        sourcePath: String(sourcePath || '').replace(/^file:\/\//, ''),
        fileName: fileName || undefined,
        forGuest: !!forGuest,
        skipScan: !!skipScan,
        keepSource: !!keepSource,
        username: options.username || effectiveUserData?.username || 'user',
        userId: effectiveUserData?.id != null ? String(effectiveUserData.id) : undefined,
        boxId: effectiveBox?.id != null ? String(effectiveBox.id) : undefined,
        boxName: effectiveBox?.name || '',
        guestDir: guestDir || undefined,
      });
      return {
        success: true,
        path: result.path,
        fileName: result.fileName,
        localUrl: result.localUrl || `file://${result.path}`,
        size: result.size,
        modified: result.modified,
        directory: result.directory,
      };
    } catch (nativeErr) {
      console.warn('CapturePipeline.saveImage failed, falling back to RNFS:', nativeErr?.message || nativeErr);
    }
  }

  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const targetFileName = fileName || (effectiveBox?.id
      ? `Cutiscope_${effectiveBox.id}_${ts}.jpg`
      : `Cutiscope_${ts}.jpg`);

    let directoryPath;
    let targetPath;

    if (forGuest) {
      directoryPath = await ensureGuestPhotosDir();
    } else {
      const userSegment =
        effectiveUserData?.id != null
          ? String(effectiveUserData.id)
          : sanitizeFolderName(options.username || 'user');

      const year = String(now.getFullYear());
      const month = pad(now.getMonth() + 1);
      const day = pad(now.getDate());
      const dateSegment = `${day}-${month}-${year}`;

      const patientSegment = effectiveBox?.id
        ? `${effectiveBox.id}__${sanitizeFolderName(effectiveBox.name || '')}`
        : 'Unassigned';

      if (Platform.OS === 'android') {
        directoryPath = `${RNFS.ExternalStorageDirectoryPath}/DCIM/Camera/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
      } else {
        directoryPath = `${RNFS.DocumentDirectoryPath}/Dermscope/${userSegment}/${patientSegment}/${year}/${dateSegment}`;
      }

      await RNFS.mkdir(directoryPath);
    }

    targetPath = `${directoryPath}/${targetFileName}`;

    if (await RNFS.exists(targetPath)) {
      const uniqueSuffix = `_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      targetPath = targetPath.replace(/(\.[^.]+)$/, `${uniqueSuffix}$1`);
    }

    const sourceExists = await RNFS.exists(sourcePath);
    if (!sourceExists) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    if (keepSource) {
      await RNFS.copyFile(sourcePath, targetPath);
    } else {
      try {
        await RNFS.moveFile(sourcePath, targetPath);
      } catch (moveErr) {
        await RNFS.copyFile(sourcePath, targetPath);
      }

      try {
        const stillExists = await RNFS.exists(sourcePath);
        if (stillExists) {
          await RNFS.unlink(sourcePath);
        }
      } catch (_) { }
    }

    if (Platform.OS === 'android' && !forGuest && !skipScan) {
      try {
        await RNFS.scanFile(targetPath);
      } catch (scannerError) {
        console.log('Scanner error:', scannerError.message);
      }
    }

    const fileExists = await RNFS.exists(targetPath);
    if (!fileExists) {
      throw new Error(`File was not created at: ${targetPath}`);
    }

    const fileInfo = await RNFS.stat(targetPath);
    const savedName = targetPath.substring(targetPath.lastIndexOf('/') + 1);

    return {
      success: true,
      path: targetPath,
      fileName: savedName,
      localUrl: `file://${targetPath}`,
      size: fileInfo.size,
      modified: fileInfo.mtime,
      directory: directoryPath,
    };

  } catch (error) {
    console.error('Local save failed:', error);

    if (forGuest) {
      try {
        const fallbackDir = await ensureGuestPhotosDir();
        const fallbackPath = `${fallbackDir}/${fileName || `Cutiscope_${Date.now()}.jpg`}`;
        await RNFS.copyFile(sourcePath, fallbackPath);
        return {
          success: true,
          path: fallbackPath,
          fileName: fileName || `Cutiscope_${Date.now()}.jpg`,
          localUrl: `file://${fallbackPath}`,
          directory: fallbackDir,
          isCache: true,
        };
      } catch (guestFallbackErr) {
        console.error('Guest save fallback failed:', guestFallbackErr);
        throw new Error(`Could not save guest image: ${guestFallbackErr.message}`);
      }
    }

    try {
      const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures`;
      const picturesPath = `${picturesDir}/${fileName || `Cutiscope_${Date.now()}.jpg`}`;

      const picturesExists = await RNFS.exists(picturesDir);
      if (!picturesExists) {
        await RNFS.mkdir(picturesDir);
      }

      await RNFS.copyFile(sourcePath, picturesPath);

      if (Platform.OS === 'android') {
        await RNFS.scanFile(picturesPath);
      }

      return {
        success: true,
        path: picturesPath,
        fileName: fileName || picturesPath.split('/').pop(),
        localUrl: `file://${picturesPath}`,
        isFallback: true,
      };
    } catch (picturesError) {
      console.error('Pictures directory also failed:', picturesError);

      try {
        const fallbackDir = RNFS.CachesDirectoryPath;
        const fallbackPath = `${fallbackDir}/${fileName || `Cutiscope_${Date.now()}.jpg`}`;

        await RNFS.copyFile(sourcePath, fallbackPath);

        return {
          success: true,
          path: fallbackPath,
          fileName: fileName || fallbackPath.split('/').pop(),
          localUrl: `file://${fallbackPath}`,
          isCache: true,
        };
      } catch (fallbackError) {
        console.error('All save attempts failed:', fallbackError);
        throw new Error(`Could not save image: ${fallbackError.message}`);
      }
    }
  }
};
