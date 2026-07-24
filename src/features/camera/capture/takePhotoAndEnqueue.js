export async function takePhotoWithRetry(cameraRef, options, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await cameraRef.current.takePhoto(options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || '');
      const retryable =
        /busy|timeout|timed out|session|capture|closed|pending|rejected|failed/i.test(message) ||
        attempt < maxAttempts;
      console.warn(`takePhoto attempt ${attempt}/${maxAttempts} failed:`, message);
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
    }
  }
  throw lastError;
}

export function startContinuousCapture({
  cameraError,
  continuousCaptureRef,
  handleCapturePressRef,
  setOnCapturePress,
}) {
  if (continuousCaptureRef.current || cameraError) return;
  continuousCaptureRef.current = true;
  setOnCapturePress(true);

  (async () => {
    while (continuousCaptureRef.current) {
      const ok = await handleCapturePressRef.current();
      if (!continuousCaptureRef.current) break;
      if (!ok) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    setOnCapturePress(false);
  })();
}

export function stopContinuousCapture({ continuousCaptureRef, setOnCapturePress }) {
  continuousCaptureRef.current = false;
  setOnCapturePress(false);
}
