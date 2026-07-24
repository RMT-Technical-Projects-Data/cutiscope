import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import googleDriveService from '../../upload/googleDriveService';
import firebaseAuthService from '../../upload/firebaseAuthService';
import { registerAndEnqueue } from '../../upload/registerImageAndEnqueueUpload';
import CaptureQueue from '../captureJobQueue';

/**
 * Wires CaptureQueue configure/hydrate and the CAPTURE_PROCESSED upload listener.
 * Processor body stays on the screen via captureProcessorRef.
 */
export function useCapturePipeline({
  captureProcessorRef,
  isFocusedRef,
  continuousCaptureRef,
  isCapturingRef,
  lastCaptureTimeRef,
  CAPTURE_PROCESS_DEFER_MS,
}) {
  // Listen for fully processed captures and handle uploads independently of the queue
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('CAPTURE_PROCESSED', async ({ localResult, job }) => {
      const pathKey = localResult.path;
      const savedFileName = localResult.fileName;

      try { await AsyncStorage.setItem(`uploaded_${pathKey}`, 'pending'); } catch (_) { }

      try {
        await registerAndEnqueue({
          localPath: localResult.path,
          fileName: savedFileName,
          username: job.username,
          userData: job.userCtx,
          currentBox: job.boxCtx,
        });
      } catch (e) {
        console.warn('registerAndEnqueue failed:', e?.message || e);
      }

      (async () => {
        try {
          const accessToken = await firebaseAuthService.getValidAccessToken();
          if (accessToken) {
            await googleDriveService.uploadPhotoToDrive(
              accessToken, `file://${localResult.path}`, savedFileName
            );
            await AsyncStorage.setItem(`uploaded_${pathKey}`, 'true');
          } else {
            await AsyncStorage.setItem(`uploaded_${pathKey}`, 'pending');
          }
        } catch (e) {
          await AsyncStorage.setItem(`uploaded_${pathKey}`, 'failed');
        }
      })();
    });

    return () => subscription.remove();
  }, []);

  // Configure the CaptureQueue once: inject the processor (via ref) and the
  // shutter-priority gate, then restore any jobs left pending from last session.
  useEffect(() => {
    CaptureQueue.configure({
      processor: (job) =>
        captureProcessorRef.current ? captureProcessorRef.current(job) : Promise.resolve(),
      // Yield only while a takePhoto is in flight (or briefly after). Native
      // processing runs off the JS thread, so we drain between shots instead of
      // letting a 10–15 burst pile up until the user pauses.
      deferGate: () => {
        if (!isFocusedRef.current) return false;
        // Hold off while shooting / burst; process quickly afterward so every
        // gallery image gets its scale watermark without waiting on network.
        return (
          continuousCaptureRef.current ||
          isCapturingRef.current ||
          Date.now() - lastCaptureTimeRef.current < CAPTURE_PROCESS_DEFER_MS
        );
      },
      maxRetries: 4,
      // Drain watermark queue during longer bursts so unscaled images never pile up.
      forceProcessAfter: 8,
    });
    CaptureQueue.hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
