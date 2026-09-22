import React, { useState } from 'react';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    TouchableWithoutFeedback,
    Keyboard
} from 'react-native';
import KioskTextInput from '../Components/KioskTextInput';
import CustomKeyboard from '../Components/CustomKeyboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SerialNumberModal = ({ visible, onComplete }) => {
    const [serialNumber, setSerialNumber] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async () => {
        if (!serialNumber.trim()) {
            setError('Please enter a serial number');
            return;
        }

        try {
            await AsyncStorage.setItem('serial_number', serialNumber.trim());
            onComplete(serialNumber.trim());
        } catch (e) {
            console.error('Failed to save serial number:', e);
            setError('Failed to save serial number. Please try again.');
        }
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
        >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={styles.overlay}>
                    <View style={styles.modalWrapper}>
                        <KeyboardAvoidingView
                            behavior="padding"
                            style={styles.keyboardView}
                        >
                            <View style={styles.modalContainer}>
                                <Text style={styles.title}>Welcome to CutiScope</Text>
                                <Text style={styles.subtitle}>Please enter your device serial number to get started.</Text>

                                <View style={styles.inputContainer}>
                                    <KioskTextInput
                                        style={[styles.input, error ? styles.inputError : null]}
                                        placeholder="Enter Serial Number"
                                        placeholderTextColor="#666666"
                                        value={serialNumber}
                                        onChangeText={(text) => {
                                            setSerialNumber(text);
                                            if (error) setError('');
                                        }}
                                        autoCapitalize="characters"
                                        autoCorrect={false}
                                    />
                                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                                </View>

                                <TouchableOpacity
                                    style={styles.submitButton}
                                    onPress={handleSubmit}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.submitButtonText}>Submit</Text>
                                </TouchableOpacity>
                            </View>
                        </KeyboardAvoidingView>
                    </View>
                    <CustomKeyboard />
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalWrapper: {
        flex: 1,
        justifyContent: 'center',
        width: '100%',
    },
    keyboardView: {
        width: '100%',
        alignItems: 'center',
    },
    modalContainer: {
        width: '85%',
        backgroundColor: '#41403D',
        borderRadius: 24,
        padding: 30,
        borderWidth: 1.5,
        borderColor: '#333333',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    title: {
        fontSize: 24,
        fontFamily: 'ProductSans-Bold',
        color: '#FFFFFF',
        marginBottom: 12,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 16,
        fontFamily: 'ProductSans-Regular',
        color: '#AAAAAA',
        marginBottom: 30,
        textAlign: 'center',
        lineHeight: 22,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 30,
    },
    input: {
        width: '100%',
        height: 60,
        backgroundColor: '#262626',
        borderRadius: 12,
        paddingHorizontal: 20,
        fontSize: 18,
        color: '#FFFFFF',
        fontFamily: 'ProductSans-Bold',
        borderWidth: 1,
        borderColor: '#333333',
    },
    inputError: {
        borderColor: '#ff5252',
    },
    errorText: {
        color: '#ff5252',
        fontSize: 14,
        fontFamily: 'ProductSans-Regular',
        marginTop: 8,
        marginLeft: 4,
    },
    submitButton: {
        width: '100%',
        height: 56,
        backgroundColor: '#2a241a',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#22B2A6',
    },
    submitButtonText: {
        fontSize: 18,
        fontFamily: 'ProductSans-Bold',
        color: '#22B2A6',
    },
});

export default SerialNumberModal;
