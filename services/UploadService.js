import RNFS from 'react-native-fs';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import { SERVER_URL, DEVICE_ID, CHUNK_SIZE } from '../utils/Constants';
import { checkNetworkConnection } from '../utils/Helpers';

class UploadService {
  static async uploadImage(filePath, fileName, onProgress) {
    try {
      // Check network connection
      const isConnected = await checkNetworkConnection(NetInfo);
      if (!isConnected) {
        throw new Error('No Wi-Fi connection');
      }

      // Read file as base64
      const base64Image = await RNFS.readFile(filePath, 'base64');
      const totalChunks = Math.ceil(base64Image.length / CHUNK_SIZE);

      // Upload in chunks
      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64Image.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const isLastChunk = i === totalChunks - 1;

        const jsonPayload = {
          fileName,
          imgData: chunk,
          deviceID: DEVICE_ID,
          end: isLastChunk ? 'true' : 'false',
        };

        const response = await fetch(SERVER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jsonPayload),
        });

        if (!response.ok) {
          const serverResponse = await response.text();
          throw new Error(`Upload failed: ${serverResponse}`);
        }

        console.log(`Chunk ${i + 1} of ${totalChunks} sent successfully`);

        // Call progress callback if provided
        if (onProgress) {
          onProgress((i + 1) / totalChunks);
        }
      }

      return { success: true, message: 'Upload completed successfully' };
    } catch (error) {
      console.error('Upload error:', error);
      return { success: false, error: error.message };
    }
  }

  static async uploadMultipleImages(filePaths, onProgress, onImageComplete) {
    const results = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);

      const result = await this.uploadImage(filePath, fileName, (progress) => {
        if (onProgress) {
          onProgress(i, progress, filePaths.length);
        }
      });

      results.push(result);

      if (onImageComplete) {
        onImageComplete(i, result);
      }

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  }
}

export default UploadService;
