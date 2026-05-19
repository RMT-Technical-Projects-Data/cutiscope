import Config from 'react-native-config';
import DeviceInfo from 'react-native-device-info';

const checkUpdate = async () => {
    try {
        // Fallback to PC IP for Wi-Fi debugging
        const baseUrl = Config.API_BASE_URL || "http://35.154.32.201:4040";
        const response = await fetch(`${baseUrl}/api/admin/apk-version`);

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const remoteData = await response.json();
        const currentVersionName = DeviceInfo.getVersion(); // e.g., "1.0" or "3"
        const remoteVersionName = remoteData.version;       // e.g., "3"

        console.log(`Checking Update (String): App "${currentVersionName}" vs Server "${remoteVersionName}"`);

        const compareVersions = (v1, v2) => {
            const p1 = v1.toString().split('.').map(Number);
            const p2 = v2.toString().split('.').map(Number);
            const len = Math.max(p1.length, p2.length);

            for (let i = 0; i < len; i++) {
                const num1 = p1[i] || 0;
                const num2 = p2[i] || 0;
                if (num1 > num2) return 1;
                if (num1 < num2) return -1;
            }
            return 0;
        };

        // If Remote > Current
        if (compareVersions(remoteVersionName, currentVersionName) > 0) {
            return {
                isAvailable: true,
                forceUpdate: remoteData.forceUpdate,
                versionName: remoteData.version,
                releaseNotes: remoteData.releaseNotes,
                downloadUrl: remoteData.url
            };
        }
        return { isAvailable: false };

    } catch (error) {
        console.error('Update check failed:', error);
        return { isAvailable: false, error };
    }
};

export default { checkUpdate };
