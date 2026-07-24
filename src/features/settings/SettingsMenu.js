import { View, Text, Modal, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native'
import React, { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage';
import WifiSettingsModal from '../wifi/WiFiSettingsModal';
import BluetoothSettingsModal from '../bluetooth/BluetoothSettingsModal';
import { deleteGuestPhotos } from '../gallery/guestPhotoStorage';
import DateTimePickerModal from './DateTimePickerModal';
import ConfirmationModal from '../../shared/ui/ConfirmationModal';
import { ScreenHeader } from '../../shared/ui';
import { changeTime } from '../../shared/ui/CustomStatusBar';
import { useAuth } from '../auth/authSessionContext';
import { useNavigation } from '@react-navigation/native';
import { UserMessages } from '../../shared/utils/userMessages';
import CustomKeyboard from '../../shared/ui/CustomKeyboard';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    SESSION_TIMEOUT_OPTIONS,
    getSessionTimeoutMinutes,
    setSessionTimeoutMinutes,
} from './sessionTimeoutSettings';

/** Matches App CustomStatusBar height so overlays sit below it. */
const APP_STATUS_BAR_HEIGHT = 62;

const SettingsMenu = () => {
    const [isPressed, setIsPressed] = useState(null);
    const [wifiMenuVisible, setWifiMenuVisible] = useState(false);
    const [bluetoothMenuVisible, setBluetoothMenuVisible] = useState(false);
    const [dateAndTimeMenuVisible, setDateAndTimeVisible] = useState(false);
    const [inactivityMenuVisible, setInactivityMenuVisible] = useState(false);
    const [inactivityMinutes, setInactivityMinutes] = useState(DEFAULT_SESSION_TIMEOUT_MINUTES);
    const [serialNumber, setSerialNumber] = useState('Loading...');
    const [userEmail, setUserEmail] = useState('');
    const [userName, setUserName] = useState('');

    // Fetch serial number and profile on mount
    useEffect(() => {
        const fetchSerialNumberAndEmail = async () => {
            try {
                const value = await AsyncStorage.getItem('serial_number');
                setSerialNumber(value || 'Not Set');
            } catch (e) {
                console.error('Error fetching serial number:', e);
                setSerialNumber('Error');
            }

            try {
                const email = await AsyncStorage.getItem('userEmail');
                setUserEmail(email || '');
            } catch (e) {
                console.error('Error fetching user email:', e);
                setUserEmail('');
            }

            try {
                const name = await AsyncStorage.getItem('username');
                setUserName(name || '');
            } catch (e) {
                console.error('Error fetching username:', e);
                setUserName('');
            }
        };

        fetchSerialNumberAndEmail();
        getSessionTimeoutMinutes().then(setInactivityMinutes);
    }, []);

    // Confirmation Modal State (for actions like logout/exit)
    const [confirmModalVisible, setConfirmModalVisible] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState({
        title: '',
        message: '',
        confirmText: '',
        isDestructive: false,
        onConfirm: () => { },
    });

    // Result Modal State (for success/error feedback)
    const [resultModalVisible, setResultModalVisible] = useState(false);
    const [resultConfig, setResultConfig] = useState({
        title: '',
        message: '',
        isDestructive: false,
    });

    const showResult = (title, message, isDestructive = false) => {
        setResultConfig({ title, message, isDestructive });
        setResultModalVisible(true);
    };

    const { isGuest, signOut, exitGuestMode, isLoading } = useAuth();
    const navigation = useNavigation();
    const onClose = () => navigation.goBack();

    const handlePressWifi = () => {
        setWifiMenuVisible(true);
    };

    const handlePressBluetooth = () => {
        setBluetoothMenuVisible(true);
    };

    const handlePressDateandTime = () => {
        setDateAndTimeVisible(true);
    };

    const handleInactivityTimerChange = async (minutes) => {
        try {
            const saved = await setSessionTimeoutMinutes(minutes);
            setInactivityMinutes(saved);
            setInactivityMenuVisible(false);
        } catch (error) {
            console.error('Failed to save inactivity timer:', error);
            showResult('Error', 'Could not update the inactivity timer.', true);
        }
    };

    const handleExitGuestMode = () => {
        setConfirmConfig({
            title: 'Exit',
            message: 'Do you want to exit?',
            confirmText: 'Exit',
            isDestructive: true,
            onConfirm: async () => {
                setConfirmModalVisible(false);
                // Delete photos / clear queues BEFORE leaving so nothing reappears.
                try {
                    await exitGuestMode();
                } catch (e) {
                    console.warn('exitGuestMode failed:', e);
                    await deleteGuestPhotos();
                }
                onClose();
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Welcome' }],
                });
            }
        });
        setConfirmModalVisible(true);
    };

    const handleLogout = () => {
        setConfirmConfig({
            title: 'Logout',
            message: 'Are you sure you want to logout?',
            confirmText: 'Logout',
            isDestructive: true,
            onConfirm: async () => {
                setConfirmModalVisible(false);
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Welcome' }],
                });
                try {
                    await signOut();
                } catch (error) {
                    Alert.alert('Sign out', UserMessages.logoutFailed);
                }
            }
        });
        setConfirmModalVisible(true);
    };

    const handleConfirmDate = (date, updateType) => {
        setDateAndTimeVisible(false);

        if (date) {
            const timestamp = date.getTime();
            changeTime(date);

            try {
                const { SystemTimeModule } = require('react-native').NativeModules;
                if (SystemTimeModule) {
                    SystemTimeModule.setTime(timestamp);
                    let message = 'System time updated.';
                    if (updateType === 'date') message = 'Date has been updated successfully.';
                    else if (updateType === 'time') message = 'Time has been updated successfully.';
                    else if (updateType === 'auto') message = 'Date & Time updated successfully.';
                    showResult('Done', message);
                } else {
                    console.error('SystemTimeModule not found');
                    showResult('Error', 'SystemTimeModule native module is not linked.', true);
                }
            } catch (error) {
                console.error('Error setting time:', error);
                showResult('Error', 'Failed to set system time. Ensure device is rooted.', true);
            }
        }
    };

    // Wi‑Fi / Bluetooth / DateTime / Inactivity replace Settings entirely (full screen).
    // Do not hide only the header — that shifts the avatar to the top.
    const subScreenOpen =
        wifiMenuVisible || bluetoothMenuVisible || dateAndTimeMenuVisible || inactivityMenuVisible;

    return (
        <>
            <View style={styles.fullScreenBackground}>
                <View style={styles.modalContainer}>
                    {!subScreenOpen && (
                    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent} showsVerticalScrollIndicator={false}>

                        <ScreenHeader title="Settings" onBack={onClose} />

                        {/* Profile section – avatar, name, email (logged-in only) */}
                        {!isGuest && (
                            <View style={styles.profileSection}>
                                <View style={styles.avatarCircle}>
                                    <Text style={styles.avatarText}>
                                        {(userName || userEmail || 'U').charAt(0).toUpperCase()}
                                    </Text>
                                </View>
                                <Text style={styles.profileName} numberOfLines={1}>
                                    {userName || 'User'}
                                </Text>
                            </View>
                        )}

                        {/* Divider before settings */}
                        {!isGuest && <View style={styles.profileDivider} />}

                        {/* WiFi & Date/Time settings - only for logged-in clinicians */}
                        {!isGuest && (
                            <>
                                {/* WiFi Menu Item */}
                                <TouchableOpacity
                                    style={[styles.menuItem, isPressed === 'Connections' && styles.menuItemPressed]}
                                    onPress={handlePressWifi}
                                    onPressIn={() => setIsPressed('Connections')}
                                    onPressOut={() => setIsPressed(null)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.iconContainer}>
                                        <Image source={require('../../../assets/icon_wifi.png')} style={styles.icon} />
                                    </View>
                                    <View style={styles.menuText}>
                                        <Text style={styles.menuTitle}>WiFi Network</Text>
                                        <Text style={styles.menuSubText}>Select & manage wireless connections</Text>
                                    </View>
                                    <View style={styles.arrowContainer}>
                                        <Text style={styles.arrow}>›</Text>
                                    </View>
                                </TouchableOpacity>

                                {/* Bluetooth Menu Item */}
                                <TouchableOpacity
                                    style={[styles.menuItem, isPressed === 'Bluetooth' && styles.menuItemPressed]}
                                    onPress={handlePressBluetooth}
                                    onPressIn={() => setIsPressed('Bluetooth')}
                                    onPressOut={() => setIsPressed(null)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.iconContainer}>
                                        <MaterialCommunityIcons name="bluetooth" size={24} color="#22B2A6" />
                                    </View>
                                    <View style={styles.menuText}>
                                        <Text style={styles.menuTitle}>Bluetooth</Text>
                                        <Text style={styles.menuSubText}>Manage Bluetooth connection</Text>
                                    </View>
                                    <View style={styles.arrowContainer}>
                                        <Text style={styles.arrow}>›</Text>
                                    </View>
                                </TouchableOpacity>

                                {/* Date & Time Menu Item */}
                                <TouchableOpacity
                                    style={[styles.menuItem, isPressed === 'Date&Time' && styles.menuItemPressed]}
                                    onPress={handlePressDateandTime}
                                    onPressIn={() => setIsPressed('Date&Time')}
                                    onPressOut={() => setIsPressed(null)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.iconContainer}>
                                        <Image source={require('../../../assets/icon_date&time.png')} style={styles.icon} />
                                    </View>
                                    <View style={styles.menuText}>
                                        <Text style={styles.menuTitle}>Date & Time</Text>
                                        <Text style={styles.menuSubText}>Adjust system clock and settings</Text>
                                    </View>
                                    <View style={styles.arrowContainer}>
                                        <Text style={styles.arrow}>›</Text>
                                    </View>
                                </TouchableOpacity>

                                {/* Session inactivity timer */}
                                <TouchableOpacity
                                    style={[styles.menuItem, isPressed === 'InactivityTimer' && styles.menuItemPressed]}
                                    onPress={() => setInactivityMenuVisible(true)}
                                    onPressIn={() => setIsPressed('InactivityTimer')}
                                    onPressOut={() => setIsPressed(null)}
                                    activeOpacity={0.8}
                                >
                                    <View style={styles.iconContainer}>
                                        <MaterialCommunityIcons name="timer-outline" size={24} color="#22B2A6" />
                                    </View>
                                    <View style={styles.menuText}>
                                        <Text style={styles.menuTitle}>Inactivity Timer</Text>
                                        <Text style={styles.menuSubText}>
                                            After {inactivityMinutes} min idle, show 10s logout warning
                                        </Text>
                                    </View>
                                    <View style={styles.timeoutValueContainer}>
                                        <Text style={styles.timeoutValue}>{inactivityMinutes} min</Text>
                                        <Text style={styles.arrow}>›</Text>
                                    </View>
                                </TouchableOpacity>
                            </>
                        )}

                        {/* Serial Number Display */}
                        <View style={styles.serialNumberItem}>
                            <View style={styles.iconContainer}>
                                <Image source={require('../../../assets/info.png')} style={styles.icon} />
                            </View>
                            <View style={styles.menuText}>
                                <Text style={styles.menuTitle}>Serial Number</Text>
                                <Text style={styles.serialNumberText}>{serialNumber}</Text>
                            </View>
                        </View>

                        {/* Divider */}
                        <View style={styles.divider} />

                        {/* Exit Guest Mode Menu Item - Only show if user is in guest mode */}
                        {isGuest && !isLoading && (
                            <TouchableOpacity
                                style={[styles.menuItem, styles.exitGuestMenuItem, isPressed === 'ExitGuest' && styles.menuItemPressed]}
                                onPress={handleExitGuestMode}
                                onPressIn={() => setIsPressed('ExitGuest')}
                                onPressOut={() => setIsPressed(null)}
                                activeOpacity={0.8}
                            >
                                <View style={[styles.iconContainer, styles.exitGuestIconContainer]}>
                                    <Image source={require('../../../assets/icon_power.png')} style={[styles.icon, styles.exitGuestIcon]} />
                                </View>
                                <View style={styles.menuText}>
                                    <Text style={[styles.menuTitle, styles.exitGuestText]}>Exit Guest Mode</Text>
                                    <Text style={[styles.menuSubText, styles.exitGuestSubText]}>Go to login screen</Text>
                                </View>
                                <View style={styles.arrowContainer}>
                                    <Text style={[styles.arrow, styles.exitGuestArrow]}>›</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {/* Logout Menu Item - Only show if user is logged in */}
                        {!isGuest && !isLoading && (
                            <>
                                <TouchableOpacity
                                    style={[styles.menuItem, styles.logoutMenuItem, isPressed === 'Logout' && styles.menuItemPressed]}
                                    onPress={handleLogout}
                                    onPressIn={() => setIsPressed('Logout')}
                                    onPressOut={() => setIsPressed(null)}
                                    activeOpacity={0.8}
                                >
                                    <View style={[styles.iconContainer, styles.logoutIconContainer]}>
                                        <Image source={require('../../../assets/icon_power.png')} style={[styles.icon, styles.logoutIcon]} />
                                    </View>
                                    <View style={styles.menuText}>
                                        <Text style={[styles.menuTitle, styles.logoutText]}>Logout</Text>
                                        <Text style={[styles.menuSubText, styles.logoutSubText]}>
                                            Sign out from your account
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            </>
                        )}

                        {/* On-screen keyboard for kiosk/settings modal */}
                        <CustomKeyboard />
                    </ScrollView>
                    )}

                    {/* Full-screen sub-screens — outside ScrollView so they cover Settings completely */}
                    <WifiSettingsModal
                        visible={wifiMenuVisible}
                        onClose={() => setWifiMenuVisible(false)}
                        inline
                    />

                    <BluetoothSettingsModal
                        visible={bluetoothMenuVisible}
                        onClose={() => setBluetoothMenuVisible(false)}
                    />

                    <DateTimePickerModal
                        visible={dateAndTimeMenuVisible}
                        onClose={() => setDateAndTimeVisible(false)}
                        onConfirm={handleConfirmDate}
                    />

                    <Modal
                        visible={inactivityMenuVisible}
                        transparent
                        animationType="slide"
                        statusBarTranslucent
                        onRequestClose={() => setInactivityMenuVisible(false)}
                    >
                        <View style={styles.timeoutRoot}>
                            <View style={styles.timeoutStatusBarSpacer} />
                            <View style={styles.timeoutScreen}>
                                <ScreenHeader
                                    title="Inactivity Timer"
                                    onBack={() => setInactivityMenuVisible(false)}
                                />

                                <View style={styles.timeoutContent}>
                                    <Text style={styles.timeoutDescription}>
                                        After this idle time, a 10-second logout warning appears:
                                    </Text>
                                    {SESSION_TIMEOUT_OPTIONS.map((minutes) => {
                                        const selected = inactivityMinutes === minutes;
                                        return (
                                            <TouchableOpacity
                                                key={minutes}
                                                style={[
                                                    styles.timeoutOption,
                                                    selected && styles.timeoutOptionSelected,
                                                ]}
                                                onPress={() => handleInactivityTimerChange(minutes)}
                                                activeOpacity={0.8}
                                            >
                                                <Text
                                                    style={[
                                                        styles.timeoutOptionText,
                                                        selected && styles.timeoutOptionTextSelected,
                                                    ]}
                                                >
                                                    {minutes} minutes
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        </View>
                    </Modal>

                    <ConfirmationModal
                        visible={confirmModalVisible}
                        onClose={() => setConfirmModalVisible(false)}
                        title={confirmConfig.title}
                        message={confirmConfig.message}
                        confirmText={confirmConfig.confirmText}
                        isDestructive={confirmConfig.isDestructive}
                        onConfirm={() => {
                            confirmConfig.onConfirm();
                            setConfirmModalVisible(false);
                        }}
                    />

                    {/* Result feedback modal (replaces Alert.alert) */}
                    <ConfirmationModal
                        visible={resultModalVisible}
                        onClose={() => setResultModalVisible(false)}
                        title={resultConfig.title}
                        message={resultConfig.message}
                        confirmText="OK"
                        cancelText={null}
                        isDestructive={resultConfig.isDestructive}
                        onConfirm={() => setResultModalVisible(false)}
                    />
                </View>
            </View>
        </>
    );
};

const styles = StyleSheet.create({
    fullScreenBackground: {
        flex: 1,
        backgroundColor: '#000000',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#000000',
    },
    container: {
        flex: 1,
        width: '100%',
        backgroundColor: 'transparent',
    },
    containerContent: {
        paddingBottom: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
        backgroundColor: 'transparent',
        marginBottom: 8,
    },
    backButton: {
        height: 40,
        width: 40,
        padding: 8,
        borderRadius: 12,
        backgroundColor: '#41403D',
        borderWidth: 1,
        borderColor: '#333333',
    },
    headerSpacer: {
        width: 40,
        height: 40,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 26,
        fontFamily: 'ProductSans-Bold',
        letterSpacing: 0.5,
        flex: 1,
        textAlign: 'center',
    },
    profileSection: {
        alignItems: 'center',
        marginBottom: 12,
        paddingVertical: 8,
    },
    avatarCircle: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#22B2A6',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 6,
    },
    avatarText: {
        fontSize: 20,
        fontFamily: 'ProductSans-Bold',
        color: '#FFFFFF',
    },
    profileName: {
        fontSize: 16,
        fontFamily: 'ProductSans-Bold',
        color: '#FFFFFF',
        marginBottom: 2,
        textAlign: 'center',
        paddingHorizontal: 20,
    },
    profileEmail: {
        fontSize: 12,
        fontFamily: 'ProductSans-Regular',
        color: '#AAAAAA',
        textAlign: 'center',
        paddingHorizontal: 20,
    },
    profileDivider: {
        width: '100%',
        height: 1,
        backgroundColor: '#333333',
        marginBottom: 10,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 10,
        marginHorizontal: 20,
        borderWidth: 1.5,
        borderColor: '#333333',
        backgroundColor: '#41403D',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 4,
    },
    menuItemPressed: {
        backgroundColor: '#252525',
        borderColor: '#22B2A6',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        elevation: 6,
        transform: [{ scale: 0.98 }],
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#2a2a2a',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    icon: {
        width: 20,
        height: 20,
        tintColor: '#22B2A6',
    },
    menuText: {
        flex: 1,
    },
    menuTitle: {
        fontSize: 15,
        fontFamily: 'ProductSans-Bold',
        color: '#FFFFFF',
        marginBottom: 2,
        letterSpacing: 0.3,
    },
    menuSubText: {
        fontSize: 12,
        fontFamily: 'ProductSans-Regular',
        color: '#AAAAAA',
        lineHeight: 16,
    },
    backButtonIcon: {
        height: 22,
        width: 22,
        tintColor: '#FFFFFF',
    },
    arrowContainer: {
        marginLeft: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    arrow: {
        fontSize: 28,
        color: '#666666',
        fontWeight: '300',
    },
    timeoutValueContainer: {
        marginLeft: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeoutValue: {
        color: '#22B2A6',
        fontSize: 15,
        fontFamily: 'ProductSans-Bold',
        marginRight: 8,
    },
    timeoutRoot: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    timeoutStatusBarSpacer: {
        height: APP_STATUS_BAR_HEIGHT,
        backgroundColor: 'transparent',
    },
    timeoutScreen: {
        flex: 1,
        backgroundColor: '#000000',
    },
    timeoutContent: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 8,
    },
    timeoutDescription: {
        color: '#AAAAAA',
        fontSize: 14,
        fontFamily: 'ProductSans-Regular',
        marginBottom: 16,
        lineHeight: 20,
    },
    timeoutOption: {
        width: '100%',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#333333',
        backgroundColor: '#41403D',
        alignItems: 'center',
        marginBottom: 10,
    },
    timeoutOptionSelected: {
        borderColor: '#22B2A6',
        backgroundColor: '#19332F',
    },
    timeoutOptionText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'ProductSans-Bold',
    },
    timeoutOptionTextSelected: {
        color: '#22B2A6',
    },
    divider: {
        width: '100%',
        height: 1,
        backgroundColor: '#333333',
        marginVertical: 12,
    },
    logoutMenuItem: {
        marginTop: 4,
        borderColor: '#d32f2f',
        backgroundColor: '#2a1a1a',
    },
    logoutIconContainer: {
        backgroundColor: '#3a1a1a',
    },
    logoutIcon: {
        tintColor: '#ff5252',
    },
    logoutText: {
        color: '#ff5252',
    },
    logoutSubText: {
        color: '#ff8a80',
    },
    exitGuestMenuItem: {
        marginTop: 8,
        borderColor: '#d32f2f',
        backgroundColor: '#2a1a1a',
    },
    exitGuestIconContainer: {
        backgroundColor: '#3a1a1a',
        borderWidth: 1,

    },
    exitGuestIcon: {
        tintColor: '#ff5252',
    },
    exitGuestText: {
        color: '#ff5252',
    },
    exitGuestSubText: {
        color: '#ff8a80',
    },
    exitGuestArrow: {
        color: '#ff5252',
    },
    serialNumberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 10,
        marginHorizontal: 20,
        borderWidth: 1.5,
        borderColor: '#333333',
        backgroundColor: '#41403D',
    },
    serialNumberText: {
        fontSize: 15,
        fontFamily: 'ProductSans-Bold',
        color: '#AAAAAA',
        letterSpacing: 1,
    },
});

export default SettingsMenu;