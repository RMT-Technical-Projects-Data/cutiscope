import { useCallback, useEffect, useRef } from 'react';
import { Alert, Platform, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import CaptureQueue from '../captureJobQueue';
import { recordPhotoCapture } from '../../patients/patientsService';
import { prependGalleryPhoto, notifyGalleryPhotoUpdated, getGalleryOwnerKey, prependPendingCapture } from '../../gallery/gallerySnapshotCache';
import {
  buildAlbumDirectory,
  buildAlbumPathSegments,
  buildPatientSegment,
  buildUserGalleryBase,
  buildDateSegments,
} from '../../gallery/utils/albumPathBuilder';
import GalleryIndexer from '../../../shared/native/GalleryIndexer';
import { showInAppToast } from '../../../shared/utils/inAppToast';
import { UserMessages } from '../../../shared/utils/userMessages';
import { saveImageLocallyOnly } from '../capture/saveImageLocally';
import { processCaptureWithScale } from '../capture/processCaptureWithScale';
import CapturePipeline from '../../../shared/native/CapturePipeline';
import {
  startContinuousCapture as startContinuousCaptureLoop,
  stopContinuousCapture as stopContinuousCaptureLoop,
  takePhotoWithRetry,
} from '../capture/takePhotoAndEnqueue';
import { useCapturePipeline } from './useCapturePipeline';

/**
 * Capture shutter, queue processor, and continuous burst controls.
 */
export function useCameraCapture({
  cameraRef,
  device,
  isGuest,
  currentBox,
  bodyPart,
  userData,
  getUsername,
  zoomBtnValue,
  cameraError,
  isFocused,
  resetInactivityTimer,
  timeoutRef,
  captureProcessorRef,
  isFocusedRef,
  continuousCaptureRef,
  isCapturingRef,
  lastCaptureTimeRef,
  CAPTURE_PROCESS_DEFER_MS,
  latestCaptureSeqRef,
  setLatestPhotoUri,
  setOnCapturePress,
  setIsCapturing,
  hasStoragePermissionRef,
  requestStoragePermission,
  setCameraError,
}) {
  // ========== CAPTURE FUNCTION ==========
  // Near-zero debounce — only prevents accidental double-fires between loop ticks.
  const CAPTURE_THROTTLE_MS_GUEST = 0;
  const CAPTURE_THROTTLE_MS_LOGGED_IN = 0;

  // Set true to save raw + processed JPEG pairs for orientation/scale debugging.
  const DEBUG_SAVE_CAPTURE_PAIR = false;
  // Dermascope is fixed to the phone; ignore device tilt so we never rotate
  // landscape-left / landscape-right captures (that was inverting the image).
  const FORCE_PORTRAIT_NO_DEVICE_TILT_ROTATION = true;

  const saveDebugCaptureImage = async (sourcePath, label, debugTs, orientation = null) => {
    if (!DEBUG_SAVE_CAPTURE_PAIR) return null;
    try {
      const debugDir = Platform.OS === 'android'
        ? `${RNFS.ExternalStorageDirectoryPath}/Pictures/Cutiscope_Debug`
        : `${RNFS.DocumentDirectoryPath}/Cutiscope_Debug`;
      await RNFS.mkdir(debugDir);

      const cleanSource = sourcePath.startsWith('file://') ? sourcePath.slice(7) : sourcePath;
      const orientSuffix = orientation ? `_${orientation}` : '';
      const destPath = `${debugDir}/${debugTs}_${label}${orientSuffix}.jpg`;

      const sourceExists = await RNFS.exists(cleanSource);
      if (!sourceExists) {
        console.warn(`🔬 Debug save skipped (missing source): ${cleanSource}`);
        return null;
      }

      await RNFS.copyFile(cleanSource, destPath);

      if (Platform.OS === 'android') {
        try {
          await RNFS.scanFile(destPath);
        } catch (_) { }
      }

      console.log(`🔬 Debug capture saved: ${destPath}`);
      return destPath;
    } catch (err) {
      console.warn('🔬 Debug capture save failed:', err?.message || err);
      return null;
    }
  };

  // const processImage = async (uri, zoomVal = 1.0, patientName = '', part = '') => {
  //   try {
  //     console.log('🖼️ processImage: Starting Skia processing for', uri, 'Zoom:', zoomVal);

  //     const exists = await RNFS.exists(uri);
  //     if (!exists) {
  //       console.error('❌ processImage: Source file does not exist:', uri);
  //       return uri;
  //     }

  //     const data = await RNFS.readFile(uri, 'base64');
  //     const skData = Skia.Data.fromBase64(data);
  //     const image = Skia.Image.MakeImageFromEncoded(skData);

  //     if (!image) {
  //       console.error('❌ processImage: Failed to decode image with Skia');
  //       return uri;
  //     }

  //     // Calculate Color Matrix for White Balance
  //     const temp = DEFAULT_TEMPERATURE || 6500;
  //     const tint = DEFAULT_TINT || 0;

  //     // Simple approximation for Temperature and Tint
  //     // Temperature: scales Red and Blue
  //     // Tint: scales Green
  //     const tempRatio = temp / 6500;
  //     const rScale = tempRatio < 1 ? 1 : 1 / tempRatio;
  //     const bScale = tempRatio > 1 ? 1 : tempRatio;
  //     const gScale = 1.0 - (tint * 0.1);

  //     const matrix = [
  //       rScale, 0, 0, 0, 0,
  //       0, gScale, 0, 0, 0,
  //       0, 0, bScale, 0, 0,
  //       0, 0, 0, 1, 0,
  //     ];

  //     const originalW = image.width();
  //     const originalH = image.height();

  //     // Detect if the photo was captured in landscape sensor orientation
  //     const isLandscape = originalW > originalH;
  //     // Set target portrait dimensions
  //     const imgW = isLandscape ? originalH : originalW;
  //     const imgH = isLandscape ? originalW : originalH;

  //     const surface = Skia.Surface.MakeOffscreen(imgW, imgH);
  //     if (!surface) {
  //       console.error('❌ processImage: Failed to create Skia surface');
  //       return uri;
  //     }

  //     const canvas = surface.getCanvas();
  //     const paint = Skia.Paint();
  //     paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));

  //     if (isLandscape) {
  //       canvas.save();
  //       // Translate and rotate 90 degrees clockwise to fit the image perfectly within the portrait bounds
  //       canvas.translate(imgW, 0);
  //       canvas.rotate(90, 0, 0);
  //     }
  //     canvas.drawImage(image, 0, 0, paint);
  //     if (isLandscape) {
  //       canvas.restore();
  //     }

  //     // --- Draw Millimeter Scale Watermark ---
  //     try {
  //       console.log('📏 processImage: Drawing scale watermark...');
  //       const scaleX = imgW * 0.04;
  //       const scaleTop = imgH * 0.1;
  //       const scaleHeight = imgH * 0.8;

  //       const scalePaint = Skia.Paint();
  //       scalePaint.setColor(Skia.Color('#ffffff'));
  //       scalePaint.setStrokeWidth(Math.max(4, imgW / 300));
  //       scalePaint.setAntiAlias(true);

  //       canvas.drawLine(scaleX, scaleTop, scaleX, scaleTop + scaleHeight, scalePaint);

  //       const maxMm = 15.0 / zoomVal;

  //       let font = null;
  //       try {
  //         const typeface = Skia.FontMgr.System().matchFamilyStyle("sans-serif", FontStyle.Normal);
  //         font = Skia.Font(typeface, Math.max(30, imgH / 40));
  //       } catch (fontErr) {
  //         console.warn('⚠️ processImage: Font creation failed', fontErr);
  //       }

  //       const totalSteps = Math.floor(maxMm * 10);
  //       for (let step = 0; step <= totalSteps; step++) {
  //         const val = step / 10;
  //         const valRounded = Math.round(val * 10);
  //         const isMajor = valRounded % 10 === 0;
  //         const isMedium = valRounded % 10 === 5;

  //         const y = scaleTop + ((maxMm - val) / maxMm) * scaleHeight;

  //         let tickWidth = imgW * 0.015; // minor tick (0.1 mm)
  //         if (isMajor) {
  //           tickWidth = imgW * 0.04;   // major tick (1.0 mm)
  //         } else if (isMedium) {
  //           tickWidth = imgW * 0.027;  // medium tick (0.5 mm)
  //         }

  //         canvas.drawLine(scaleX, y, scaleX + tickWidth, y, scalePaint);

  //         if (isMajor && font) {
  //           const text = val.toFixed(0);
  //           const textX = scaleX + tickWidth + (imgW * 0.015);
  //           canvas.drawText(text, textX, y + (font.getSize() / 3), scalePaint, font);
  //         }
  //       }

  //       if (font) {
  //         canvas.drawText('mm', scaleX, scaleTop + scaleHeight + font.getSize() + 10, scalePaint, font);
  //       }
  //       console.log('✅ processImage: Scale watermark drawn successfully');
  //     } catch (scaleDrawErr) {
  //       console.error('❌ processImage: Scale watermark error:', scaleDrawErr);
  //     }

  //     // --- Draw Patient Info Box ---
  //     if (patientName || part) {
  //       try {
  //         console.log('📝 processImage: Drawing patient info box...');
  //         const label = [patientName, part].filter(Boolean).join(' | ');

  //         const fontSize = Math.max(40, imgW / 25);

  //         const textPaint = Skia.Paint();
  //         textPaint.setColor(Skia.Color('#ffffff'));
  //         textPaint.setAntiAlias(true);

  //         const typeface = Skia.FontMgr.System().matchFamilyStyle("sans-serif", FontStyle.Bold);
  //         const font = Skia.Font(typeface, fontSize);

  //         const textWidth = font.measureText(label).width;

  //         const paddingX = fontSize * 1.0;
  //         const paddingY = fontSize * 0.6;
  //         const boxWidth = textWidth + paddingX * 2;
  //         const boxHeight = fontSize + paddingY * 2;

  //         const boxX = (imgW - boxWidth) / 2;
  //         // const boxY = imgH * 0.12;
  //         const boxY = imgH - boxHeight - (imgH * 0.01);

  //         const boxPaint = Skia.Paint();
  //         boxPaint.setColor(Skia.Color('rgba(0, 0, 0, 0.6)'));
  //         boxPaint.setAntiAlias(true);

  //         canvas.drawRect({ x: boxX, y: boxY, width: boxWidth, height: boxHeight }, boxPaint);

  //         const textX = boxX + paddingX;
  //         const textY = boxY + boxHeight / 2 + fontSize * 0.35;

  //         canvas.drawText(label, textX, textY, textPaint, font);
  //         console.log('✅ processImage: Patient info box drawn successfully');
  //       } catch (infoDrawErr) {
  //         console.error('❌ processImage: Patient info box error:', infoDrawErr);
  //       }
  //     }

  //     const snapshot = surface.makeImageSnapshot();
  //     const encoded = snapshot.encodeToBase64(ImageFormat.JPEG, 90);
  //     const path = `${RNFS.TemporaryDirectoryPath}/processed_${Date.now()}.jpg`;
  //     await RNFS.writeFile(path, encoded, 'base64');
  //     console.log('✅ processImage: Done, path:', path);
  //     return path;
  //   } catch (err) {
  //     console.error('❌ Skia processImage error:', err);
  //     return uri;
  //   }
  // };

  // Move the camera's temp file into a queue-owned staging folder (a fast rename
  // on the same volume). The queue then owns this file until it is processed and
  // the single final photo is saved; keeps captured images safe across restarts.
  const stageRawForQueue = async (srcPath) => {
    try {
      // DocumentDirectory (not Caches) so staged raws survive an app-kill and can
      // be resumed by CaptureQueue.hydrate() on next launch.
      const dir = `${RNFS.DocumentDirectoryPath}/capture_queue`;
      const dirExists = await RNFS.exists(dir);
      if (!dirExists) {
        await RNFS.mkdir(dir);
      }
      const dest = `${dir}/raw_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      try {
        await RNFS.moveFile(srcPath, dest);
      } catch (moveErr) {
        await RNFS.copyFile(srcPath, dest);
        try { await RNFS.unlink(srcPath); } catch (_) { }
      }
      return dest;
    } catch (e) {
      console.warn('stageRawForQueue failed, using original temp path:', e?.message || e);
      return srcPath;
    }
  };

  // The per-job worker used by CaptureQueue. Kept in a ref (updated every render)
  // so the queue always runs against the freshest functions/state.
  // Gallery only receives watermarked images (scale baked in). Upload/network
  // never decide whether the scale is present on the stored file.
  captureProcessorRef.current = async (job) => {
    if (!job?.rawPath) {
      throw new Error('Capture job missing rawPath');
    }

    const rawExists = await RNFS.exists(job.rawPath);
    if (!rawExists && !(job.galleryPath && (await RNFS.exists(job.galleryPath)))) {
      throw new Error(`Staged raw missing: ${job.rawPath}`);
    }

    let sourceForProcess = job.rawPath;
    if (!(await RNFS.exists(sourceForProcess)) && job.galleryPath) {
      sourceForProcess = job.galleryPath;
    }

    let finalPath = null;
    let savedFileName = job.fileName;
    let savedDirectory = '';

    // Single native process+save when available (no galleryPath overwrite case).
    if (CapturePipeline.isAvailable() && !job.galleryPath) {
      let guestDir = null;
      if (job.isGuest) {
        try {
          const { ensureGuestPhotosDir } = require('../../gallery/guestPhotoStorage');
          guestDir = await ensureGuestPhotosDir();
        } catch (_) {}
      }
      const result = await CapturePipeline.processAndSave({
        sourcePath: sourceForProcess,
        zoom: job.zoom > 0 ? job.zoom : 1.0,
        patientName: job.patientName || '',
        bodyPart: job.bodyPart || '',
        orientation: job.orientation || 'portrait',
        fileName: job.fileName || undefined,
        forGuest: !!job.isGuest,
        skipScan: true,
        username: job.username || job.userCtx?.username || 'user',
        userId: job.userCtx?.id != null ? String(job.userCtx.id) : undefined,
        boxId: job.boxCtx?.id != null ? String(job.boxCtx.id) : undefined,
        boxName: job.boxCtx?.name || '',
        guestDir: guestDir || undefined,
      });
      finalPath = result.path;
      savedFileName = result.fileName;
      savedDirectory = result.directory;

      prependGalleryPhoto({
        path: `file://${finalPath}`,
        absolutePath: finalPath,
        name: savedFileName,
        directory: savedDirectory,
        timestamp: new Date(),
        mtime: new Date().toISOString(),
        uploadStatus: 'PENDING',
        hasScale: true,
        imageVersion: Date.now(),
        captureSeq: job.captureSeq,
        stagedPath: job.rawPath,
      }, getGalleryOwnerKey({
        isGuest: !!job.isGuest,
        userId: job.userCtx?.id,
        username: job.userCtx?.username,
      }));
      if (GalleryIndexer.isAvailable()) {
        GalleryIndexer.notifyPhotoSaved(finalPath).catch(() => {});
      }
    } else {
      const processedPath = await processCaptureWithScale(
        sourceForProcess,
        job.zoom > 0 ? job.zoom : 1.0,
        job.patientName || '',
        job.bodyPart || '',
        job.orientation || 'portrait'
      );
      const cleanProcessed = processedPath.startsWith('file://')
        ? processedPath.slice(7)
        : processedPath;

      if (!(await RNFS.exists(cleanProcessed))) {
        throw new Error(`Processed file missing: ${cleanProcessed}`);
      }

      if (job.galleryPath) {
        try {
          if (CapturePipeline.isAvailable()) {
            await CapturePipeline.replaceFile(cleanProcessed, job.galleryPath);
            finalPath = job.galleryPath.replace(/^file:\/\//, '');
          } else {
            await RNFS.copyFile(cleanProcessed, job.galleryPath);
            finalPath = job.galleryPath;
          }
        } catch (replaceErr) {
          console.warn('In-place replace failed, saving as new file:', replaceErr?.message || replaceErr);
          const localResult = await saveImageLocallyOnly(cleanProcessed, job.fileName, {
            forGuest: job.isGuest,
            box: job.boxCtx,
            ctxUserData: job.userCtx,
            skipScan: true,
          });
          finalPath = localResult.path;
          savedFileName = localResult.fileName;
          savedDirectory = localResult.directory;
        }
        notifyGalleryPhotoUpdated(finalPath);
      } else {
        const localResult = await saveImageLocallyOnly(cleanProcessed, job.fileName, {
          forGuest: job.isGuest,
          box: job.boxCtx,
          ctxUserData: job.userCtx,
          skipScan: true,
        });
        finalPath = localResult.path;
        savedFileName = localResult.fileName;
        savedDirectory = localResult.directory;

        prependGalleryPhoto({
          path: `file://${finalPath}`,
          absolutePath: finalPath,
          name: savedFileName,
          directory: savedDirectory,
          timestamp: new Date(),
          mtime: new Date().toISOString(),
          uploadStatus: 'PENDING',
          hasScale: true,
          imageVersion: Date.now(),
          captureSeq: job.captureSeq,
          stagedPath: job.rawPath,
        }, getGalleryOwnerKey({
          isGuest: !!job.isGuest,
          userId: job.userCtx?.id,
          username: job.userCtx?.username,
        }));
        if (GalleryIndexer.isAvailable()) {
          GalleryIndexer.notifyPhotoSaved(finalPath).catch(() => {});
        }
      }

      if (cleanProcessed !== job.rawPath && cleanProcessed !== finalPath) {
        try { if (await RNFS.exists(cleanProcessed)) await RNFS.unlink(cleanProcessed); } catch (_) { }
      }
    }

    if (!finalPath) {
      throw new Error('No gallery path after watermark processing');
    }

    if (Platform.OS === 'android' && !job.isGuest) {
      RNFS.scanFile(finalPath).catch(() => {});
    }

    // Always promote camera corner thumb to newest finalized shot.
    const seq = job.captureSeq || 0;
    setLatestPhotoUri((prev) => {
      const prevSeq = prev?.captureSeq || 0;
      if (seq > 0 && seq < prevSeq) return prev;
      return {
        path: finalPath,
        captureSeq: Math.max(seq, prevSeq, latestCaptureSeqRef.current || 0),
        mtime: Date.now(),
      };
    });

    try {
      if (job.rawPath && job.rawPath !== finalPath && (await RNFS.exists(job.rawPath))) {
        await RNFS.unlink(job.rawPath);
      }
    } catch (_) { }

    if (!job.isGuest) {
      DeviceEventEmitter.emit('CAPTURE_PROCESSED', {
        localResult: {
          path: finalPath,
          fileName: savedFileName || finalPath.split('/').pop(),
        },
        job,
      });
    }
  };

  // Keep the focus ref in sync so the queue's deferGate can read it.
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useCapturePipeline({
    captureProcessorRef,
    isFocusedRef,
    continuousCaptureRef,
    isCapturingRef,
    lastCaptureTimeRef,
    CAPTURE_PROCESS_DEFER_MS,
  });

  const handleCapturePress = async () => {
    resetInactivityTimer();
    // resetInactivityTimer();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // For logged-in users: require a selected patient box before capturing.
    // Guests can always capture without selecting a patient.
    if (!isGuest && !currentBox?.id) {
      if (Platform.OS === 'android') {
        showInAppToast('Please select a patient to capture image', { durationMs: 2000, position: 'center' });
      }
      return false;
    }

    // Also require a selected body part
    if (!isGuest && !bodyPart) {
      if (Platform.OS === 'android') {
        showInAppToast('Please select Patients body part to capture image', { durationMs: 2000, position: 'center' });
      }
      return false;
    }

    const now = Date.now();
    const throttleMs = isGuest ? CAPTURE_THROTTLE_MS_GUEST : CAPTURE_THROTTLE_MS_LOGGED_IN;
    if (isCapturingRef.current || (now - lastCaptureTimeRef.current < throttleMs)) {
      return false;
    }

    isCapturingRef.current = true;
    lastCaptureTimeRef.current = now;

    if (cameraRef.current && device) {
      try {
        setIsCapturing(true);

        // Only hit the native permission API until it's granted once; after that
        // reuse the cached result so the shutter path stays fast.
        let hasStoragePermission = hasStoragePermissionRef.current;
        if (!hasStoragePermission) {
          hasStoragePermission = await requestStoragePermission();
          hasStoragePermissionRef.current = hasStoragePermission;
        }
        if (!hasStoragePermission) {
          Alert.alert(
            'Storage Permission Required',
            'Please grant storage permission to save images.',
            [{ text: 'OK' }]
          );
          setIsCapturing(false);
          isCapturingRef.current = false; // Reset lock early
          resetInactivityTimer(); // Restart timer
          return false;
        }

        const photo = await takePhotoWithRetry(cameraRef, {
          // 'speed' returns from the shutter as fast as possible (no multi-frame
          // HDR fusion) — best for rapid, continuous capture. Still a full-
          // resolution image. Bump to 'balanced'/'quality' if more processing is
          // acceptable at the cost of shutter lag.
          qualityPrioritization: 'speed',
          flash: 'off',
          enableShutterSound: false,
        });

        // Unlock shutter immediately after the camera returns — staging, gallery
        // copy, and queue work must not delay the next tap / continuous shot.
        setIsCapturing(false);
        isCapturingRef.current = false;

        console.log('📸 takePhoto orientation:', photo.orientation, 'path:', photo.path);

        const rawPhotoPath = photo.path.startsWith('file://') ? photo.path.slice(7) : photo.path;

        const stamp = new Date();
        const pad = num => num.toString().padStart(2, '0');
        const year = stamp.getFullYear();
        const month = pad(stamp.getMonth() + 1);
        const day = pad(stamp.getDate());
        const hours = pad(stamp.getHours());
        const minutes = pad(stamp.getMinutes());
        const seconds = pad(stamp.getSeconds());
        const ms = String(stamp.getMilliseconds()).padStart(3, '0');

        const captureSeq = ++latestCaptureSeqRef.current;
        const fileName = currentBox?.id
          ? `Cutiscope_${currentBox.id}_${year}${month}${day}_${hours}${minutes}${seconds}${ms}_${captureSeq}.jpg`
          : `Cutiscope_${year}${month}${day}_${hours}${minutes}${seconds}${ms}_${captureSeq}.jpg`;

        // Snapshot UI context now — background work must not depend on later selection changes.
        const boxSnap = currentBox ? { id: currentBox.id, name: currentBox.name } : null;
        const userSnap = userData ? { id: userData.id, username: userData.username } : null;
        const guestSnap = isGuest;
        const zoomSnap = zoomBtnValue;
        const bodyPartSnap = bodyPart;
        // Dermascope + UI are portrait-locked. Never pass device-tilt orientations
        // (landscape-left/right) into processing — that was inverting captures.
        const orientationSnap = FORCE_PORTRAIT_NO_DEVICE_TILT_ROTATION
          ? 'portrait'
          : photo.orientation;
        const usernameSnap = isGuest ? '' : getUsername();

        if (!guestSnap) {
          if (boxSnap?.id) recordPhotoCapture(boxSnap.id);
          // Avoid toast spam during continuous hold — only ping on single / first shots.
          if (Platform.OS === 'android' && !continuousCaptureRef.current) {
            showInAppToast('Saved', { position: 'aboveCapture', durationMs: 600 });
          }
        }

        // Stage raw + enqueue watermark. Gallery gets a pending album hint immediately
        // so Camera → Gallery never shows "No photos found" during burst.
        // Camera thumb updates on every click (staged), then upgrades to final DCIM.
        (async () => {
          const ownerKey = getGalleryOwnerKey({
            isGuest: guestSnap,
            userId: userSnap?.id,
            username: userSnap?.username,
          });
          const albumSegments = guestSnap
            ? []
            : buildAlbumPathSegments({
                boxId: boxSnap?.id,
                boxName: boxSnap?.name,
                date: stamp,
              });
          const directory = guestSnap
            ? ''
            : buildAlbumDirectory({
                userId: userSnap?.id,
                username: userSnap?.username || usernameSnap,
                boxId: boxSnap?.id,
                boxName: boxSnap?.name,
                date: stamp,
              });
          const userBase = guestSnap
            ? null
            : buildUserGalleryBase({
                userId: userSnap?.id,
                username: userSnap?.username || usernameSnap,
              });
          const { year, dateSegment } = buildDateSegments(stamp);
          const patientSegment = buildPatientSegment(boxSnap?.id, boxSnap?.name);

          const bumpThumb = (path) => {
            if (!path) return;
            if (captureSeq < latestCaptureSeqRef.current) return;
            setLatestPhotoUri({
              path: String(path).replace(/^file:\/\//, ''),
              captureSeq,
              mtime: Date.now(),
            });
          };

          // Instant thumb from camera temp (before staging) so burst always shows latest click.
          bumpThumb(rawPhotoPath);

          const registerPending = (stagedPath) => {
            if (guestSnap) return;
            prependPendingCapture(
              {
                captureSeq,
                fileName,
                stagedPath,
                directory,
                patientSegment,
                year,
                dateSegment,
                albumSegments,
                userBase,
              },
              ownerKey
            );
          };

          try {
            const stagedPath = await stageRawForQueue(rawPhotoPath);
            bumpThumb(stagedPath);
            registerPending(stagedPath);

            CaptureQueue.enqueue({
              rawPath: stagedPath,
              fileName,
              isGuest: guestSnap,
              captureSeq,
              zoom: zoomSnap,
              patientName: boxSnap?.name || '',
              bodyPart: bodyPartSnap,
              orientation: orientationSnap,
              username: usernameSnap,
              boxCtx: boxSnap,
              userCtx: userSnap,
            });
          } catch (bgErr) {
            console.error('Stage / enqueue failed:', bgErr);
            try {
              const stagedPath = await stageRawForQueue(rawPhotoPath);
              bumpThumb(stagedPath);
              registerPending(stagedPath);
              CaptureQueue.enqueue({
                rawPath: stagedPath,
                fileName,
                isGuest: guestSnap,
                captureSeq,
                zoom: zoomSnap,
                patientName: boxSnap?.name || '',
                bodyPart: bodyPartSnap,
                orientation: orientationSnap,
                username: usernameSnap,
                boxCtx: boxSnap,
                userCtx: userSnap,
              });
            } catch (fallbackErr) {
              console.error('Capture fallback also failed:', fallbackErr);
            }
          }
        })();

        return true;
      } catch (error) {
        console.error('Failed to take picture:', error);
        if (Platform.OS === 'android') {
          showInAppToast(UserMessages.captureFailed, { durationMs: 2000, position: 'bottom' });
        } else {
          Alert.alert('Error', UserMessages.captureFailed);
        }
        return false;
      } finally {
        // Keep pressed visual during continuous hold; only unlock shutter lock.
        setIsCapturing(false);
        isCapturingRef.current = false;
        if (!continuousCaptureRef.current) {
          setOnCapturePress(false);
        }
        resetInactivityTimer();
      }
    } else {
      console.log(`[WakeUpDebug] [${Date.now()}] takePicture fallback: Camera not ready or device not available. Setting error.`);
      console.error('Camera not ready or device not available');
      setCameraError(UserMessages.cameraNotReady);
      isCapturingRef.current = false; // Reset lock
      resetInactivityTimer();
      return false;
    }
  };

  // Hold capture button = continuous burst with zero UI delay.
  // Image processing stays deferred for CAPTURE_PROCESS_DEFER_MS (3s) after last shot.
  const handleCapturePressRef = useRef(handleCapturePress);
  handleCapturePressRef.current = handleCapturePress;

  const stopContinuousCapture = useCallback(() => {
    stopContinuousCaptureLoop({ continuousCaptureRef, setOnCapturePress });
  }, []);

  const startContinuousCapture = useCallback(() => {
    startContinuousCaptureLoop({
      cameraError,
      continuousCaptureRef,
      handleCapturePressRef,
      setOnCapturePress,
    });
  }, [cameraError]);

  // Stop burst if user leaves camera / screen blurs.
  useEffect(() => {
    if (!isFocused) {
      continuousCaptureRef.current = false;
      setOnCapturePress(false);
    }
  }, [isFocused]);


  return {
    handleCapturePress,
    startContinuousCapture,
    stopContinuousCapture,
    handleCapturePressRef,
  };
}
