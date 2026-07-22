import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    NativeModules,
    Dimensions,
    Modal,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

const PowerOffModal = ({ visible, onClose, onLock }) => {
    const { SystemPowerModule } = NativeModules;

    const handlePowerOff = () => {
        console.log('Powering off device...');
        if (SystemPowerModule) {
            SystemPowerModule.powerOff();
        }
    };

    const handleRestart = () => {
        console.log('Restarting device...');
        if (SystemPowerModule) {
            SystemPowerModule.restart();
        }
    };

    const handleLock = () => {
        console.log('Locking device (black screen overlay)...');
        // Do NOT really sleep the device: on this kiosk, a real lock lets Android
        // kill the process and crash on resume. Show a full black overlay instead.
        if (onLock) {
            onLock();
        } else {
            onClose?.();
        }
    };

    return (
        <Modal
            visible={!!visible}
            transparent
            animationType="none"
            statusBarTranslucent
            hardwareAccelerated
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <View style={styles.modalView}>
                    <Text style={styles.title}>Power Menu</Text>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handlePowerOff}
                        >
                            <View style={styles.iconContainer}>
                                <MaterialCommunityIcons name="power" size={34} color="#22B2A6" />
                            </View>
                            <Text style={styles.buttonLabel}>Power Off</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleRestart}
                        >
                            <View style={styles.iconContainer}>
                                <MaterialCommunityIcons name="restart" size={34} color="#22B2A6" />
                            </View>
                            <Text style={styles.buttonLabel}>Restart</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleLock}
                        >
                            <View style={styles.iconContainer}>
                                <MaterialCommunityIcons name="lock-outline" size={34} color="#22B2A6" />
                            </View>
                            <Text style={styles.buttonLabel}>Lock</Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.8)',
    },
    modalView: {
        width: width * 0.85,
        backgroundColor: '#1C1C1E',
        borderRadius: 20,
        padding: 30,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 40,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        marginBottom: 40,
    },
    actionButton: {
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 15,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 16,
        backgroundColor: '#41403D',
        borderWidth: 1.5,
        borderColor: '#333333',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 4,
    },
    buttonLabel: {
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'ProductSans-Regular',
        letterSpacing: 0.5,
    },
    cancelButton: {
        width: '100%',
        paddingVertical: 10,
        alignItems: 'center',
    },
    cancelText: {
        color: '#22B2A6',
        fontSize: 18,
        fontWeight: 'bold',
    },
});

export default PowerOffModal;
