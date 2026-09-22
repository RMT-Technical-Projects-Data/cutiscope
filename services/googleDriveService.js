const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const googleDriveService = {
  /**
   * Helper to find a folder by name within a parent (or root)
   */
  getFolderInParent: async (accessToken, folderName, parentId = 'root') => {
    try {
      const query = encodeURIComponent(`name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`);
      const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${query}&fields=files(id, name)`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
      return null;
    } catch (error) {
      console.error(`Error finding folder ${folderName}:`, error);
      return null;
    }
  },

  /**
   * Helper to create a folder or return it if it already exists
   */
  getOrCreateFolder: async (accessToken, folderName, parentId = 'root') => {
    try {
      // 1. Check if folder exists
      const existingId = await googleDriveService.getFolderInParent(accessToken, folderName, parentId);
      if (existingId) return existingId;

      // 2. Create it if it doesn't
      console.log(`Creating folder: ${folderName} in ${parentId}`);
      const url = `${GOOGLE_DRIVE_API_BASE}/files`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      });

      const data = await response.json();
      return data.id;
    } catch (error) {
      console.error(`Error creating folder ${folderName}:`, error);
      throw error;
    }
  },

  /**
   * Upload a photo to a specific folder structure: CutiScope / Month Year / Photo
   */
  uploadPhotoToDrive: async (accessToken, photoUri, fileName) => {
    try {
      console.log('🚀 Starting Google Drive upload process...', { fileName });

      // --- STEP 0: Get or Create Folder Path ---
      // 1. Root folder "CutiScope"
      const mainFolderId = await googleDriveService.getOrCreateFolder(accessToken, 'CutiScope');

      // 2. Subfolder "Month Year" (e.g., "February 2026")
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const now = new Date();
      const monthYearName = `${months[now.getMonth()]} ${now.getFullYear()}`;
      const targetFolderId = await googleDriveService.getOrCreateFolder(accessToken, monthYearName, mainFolderId);

      console.log(`Target Folder ID for upload (${monthYearName}):`, targetFolderId);

      // --- STEP 1: Create resumable upload session ---
      const metadata = {
        name: fileName,
        mimeType: 'image/jpeg',
        parents: [targetFolderId],
      };

      const sessionResponse = await fetch(`${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=resumable`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(metadata),
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        throw new Error(`Failed to create upload session: ${sessionResponse.status} ${errorText}`);
      }

      const uploadUrl = sessionResponse.headers.get('Location');
      if (!uploadUrl) {
        throw new Error('No upload location returned from Google Drive');
      }

      console.log('✅ Upload session created, transferring binary data...');

      // --- STEP 2: Upload the binary file ---
      // We use XMLHttpRequest here to send binary content directly from the local file URI
      // which is more reliable in React Native than fetch with blobs.
      return new Promise((resolve, reject) => {
        const uploadXhr = new XMLHttpRequest();
        uploadXhr.open('PUT', uploadUrl, true);
        uploadXhr.setRequestHeader('Content-Type', 'image/jpeg');
        // Do NOT set Authorization header here as the session URL already contains authorization

        uploadXhr.onload = () => {
          if (uploadXhr.status >= 200 && uploadXhr.status < 300) {
            console.log('🎉 Final Google Drive upload success!');
            resolve(true);
          } else {
            console.error('❌ Binary upload failed:', uploadXhr.status, uploadXhr.responseText);
            reject(new Error(`Binary upload failed: ${uploadXhr.status} ${uploadXhr.responseText}`));
          }
        };

        uploadXhr.onerror = (e) => {
          console.error('❌ Network request failed during binary upload:', e);
          reject(new Error('Network request failed during binary upload'));
        };

        uploadXhr.ontimeout = () => reject(new Error('Binary upload timeout'));

        // MAGIC: Passing an object with uri property to .send() 
        // triggers React Native's native file upload logic.
        uploadXhr.send({ uri: photoUri });
      });

    } catch (error) {
      console.error('❌ Error in Google Drive upload workflow:', error);
      throw error;
    }
  },
};

export default googleDriveService;
