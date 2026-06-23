import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator, NativeModules } from 'react-native';


const UpdateModal = ({ isVisible, updateInfo, onClose }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    if (!updateInfo) return null;

    const { forceUpdate, versionName, releaseNotes, downloadUrl, downloadComplete, progress } = updateInfo;

    const handleUpdate = async () => {
        if (Platform.OS === 'android') {
            if (!downloadUrl) {
                Alert.alert("Update Error", "No download URL available. Please try again later.");
                return;
            }
            setIsDownloading(true);
            try {
                await NativeModules.AppUpdateModule.downloadUpdate(downloadUrl);
                // Download has been enqueued — the native BroadcastReceiver
                // will emit "onUpdateDownloaded" when it finishes,
                // which App.js handles by setting downloadComplete = true.
            } catch (err) {
                console.error("Download Error:", err);
                setIsDownloading(false);
                Alert.alert("Update failed", "We couldn't start the download. Please check your connection and try again.");
            }
        }
    };

    const handleInstall = async () => {
        try {
            await NativeModules.AppUpdateModule.installUpdate();
        } catch (err) {
            console.error("Install Error:", err);
            Alert.alert("Install failed", "Couldn't open the installer. Please check your Downloads folder for the update file.");
        }
    };

    // Determine current state
    const isDownloaded = downloadComplete === true;

    return (
        <Modal
            visible={isVisible}
            transparent={true}
            animationType="fade"
            onRequestClose={() => {
                if (!forceUpdate && onClose && !isDownloading) onClose();
            }}
        >
            <View style={styles.centeredView}>
                <View style={styles.modalView}>
                    <Text style={styles.title}>New Update Available!</Text>
                    <Text style={styles.version}>Version {versionName}</Text>

                    <Text style={styles.sectionTitle}>What's New:</Text>
                    <ScrollView style={styles.notesContainer}>
                        <Text style={styles.notes}>{releaseNotes || "Performance improvements and bug fixes."}</Text>
                    </ScrollView>

                    {isDownloaded ? (
                        /* ── State 3: Download complete ── */
                        <View style={styles.downloadedContainer}>
                            <Text style={styles.downloadedText}>✅ Update downloaded!</Text>
                            <TouchableOpacity style={styles.installButton} onPress={handleInstall}>
                                <Text style={styles.buttonText}>Install & Restart</Text>
                            </TouchableOpacity>
                        </View>
                    ) : isDownloading ? (
                        /* ── State 2: Downloading ── */
                        <View style={styles.progressContainer}>
                            <View style={styles.progressBarBackground}>
                                <View style={[styles.progressBarFill, { width: `${progress || 0}%` }]} />
                            </View>
                            <Text style={styles.progressText}>Downloading update... {progress || 0}%</Text>
                        </View>
                    ) : (
                        /* ── State 1: Ready to update ── */
                        forceUpdate ? (
                            <TouchableOpacity style={styles.installButton} onPress={handleUpdate}>
                                <Text style={styles.buttonText}>Update Now</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={styles.buttonRow}>
                                <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                                    <Text style={styles.cancelText}>Later</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.saveBtn} onPress={handleUpdate}>
                                    <Text style={styles.saveText}>Update Now</Text>
                                </TouchableOpacity>
                            </View>
                        )
                    )}
                </View>
            </View>
        </Modal >
    );
};

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: 'rgba(0,0,0,0.6)'
    },
    modalView: {
        width: 300,
        backgroundColor: '#1c1c1e',
        borderRadius: 12,
        padding: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    title: {
        color: '#fff',
        fontSize: 18,
        fontFamily: 'ProductSans-Bold',
        marginBottom: 5,
        textAlign: 'center'
    },
    version: {
        fontSize: 14,
        color: '#999',
        fontFamily: 'ProductSans-Regular',
        marginBottom: 15,
        textAlign: 'center'
    },
    sectionTitle: {
        alignSelf: 'flex-start',
        fontSize: 15,
        fontFamily: 'ProductSans-Bold',
        marginBottom: 8,
        color: '#fff'
    },
    notesContainer: {
        width: '100%',
        maxHeight: 150,
        marginBottom: 20,
    },
    notes: {
        fontSize: 14,
        color: '#ccc',
        fontFamily: 'ProductSans-Regular',
        lineHeight: 20
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        width: '100%',
        marginTop: 10
    },
    cancelBtn: {
        padding: 10
    },
    cancelText: {
        color: '#22B2A6',
        fontSize: 16,
        fontFamily: 'ProductSans-Regular'
    },
    saveBtn: {
        padding: 10,
        backgroundColor: '#22B2A6',
        borderRadius: 8,
        paddingHorizontal: 15
    },
    saveText: {
        color: '#000',
        fontSize: 16,
        fontFamily: 'ProductSans-Bold'
    },
    progressContainer: {
        width: '100%',
        alignItems: 'center',
        marginVertical: 15
    },
    progressBarBackground: {
        width: '100%',
        height: 8,
        backgroundColor: '#2c2c2e',
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 12
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#22B2A6',
    },
    progressText: {
        fontSize: 14,
        color: '#22B2A6',
        fontFamily: 'ProductSans-Bold',
        textAlign: 'center'
    },
    downloadedContainer: {
        width: '100%',
        alignItems: 'center',
    },
    downloadedText: {
        fontSize: 16,
        color: '#22B2A6',
        fontFamily: 'ProductSans-Bold',
        marginBottom: 15,
        textAlign: 'center'
    },
    installButton: {
        backgroundColor: '#22B2A6',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 20,
        alignItems: 'center',
        width: '100%'
    },
    buttonText: {
        color: '#000',
        fontSize: 16,
        fontFamily: 'ProductSans-Bold'
    },
});

export default UpdateModal;
