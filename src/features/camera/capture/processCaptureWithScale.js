import { NativeModules } from "react-native";

export const processCaptureWithScale = async (uri, zoomVal = 1.0, patientName = '', part = '', orientation = null) => {
    console.log('🖼️ processImage: Offloading to Native Module for', uri);

    const { ImageProcessorModule } = NativeModules;
    if (!ImageProcessorModule) {
      throw new Error('ImageProcessorModule not found');
    }

    const processedUri = await ImageProcessorModule.processImageAsync(
      uri,
      zoomVal,
      patientName,
      part,
      orientation
    );

    if (!processedUri) {
      throw new Error('processImage returned empty result');
    }

    const cleanIn = uri.startsWith('file://') ? uri.slice(7) : uri;
    const cleanOut = processedUri.startsWith('file://') ? processedUri.slice(7) : processedUri;
    // Reject silent "return original" behavior — gallery must get a watermarked file.
    if (cleanOut === cleanIn) {
      throw new Error('processImage did not produce a watermarked output');
    }

    return processedUri;
  };

