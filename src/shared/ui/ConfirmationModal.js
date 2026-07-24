import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';

/**
 * Full-screen dim overlay (not RN Modal) so App CustomStatusBar stays visible
 * above Settings logout / guest exit / gallery confirms.
 */
const ConfirmationModal = ({
    visible,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDestructive = false,
    verticalButtons = false
}) => {
    useEffect(() => {
        if (!visible) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose?.();
            return true;
        });
        return () => sub.remove();
    }, [visible, onClose]);

    if (!visible) return null;

    return (
        <View style={styles.root} pointerEvents="auto">
            <View style={styles.overlay}>
                <View style={styles.modalContainer}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.message}>{message}</Text>

                    <View style={[styles.buttonContainer, verticalButtons && styles.buttonContainerVertical]}>
                        {cancelText !== null && (
                            <TouchableOpacity
                                style={[styles.button, styles.cancelButton, verticalButtons && styles.buttonVertical]}
                                onPress={onClose}
                            >
                                <Text style={styles.cancelButtonText}>{cancelText}</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={[
                                styles.button,
                                styles.confirmButton,
                                isDestructive ? styles.destructiveButton : styles.primaryButton,
                                verticalButtons && styles.buttonVertical
                            ]}
                            onPress={onConfirm}
                        >
                            <Text style={[
                                styles.confirmButtonText,
                                isDestructive ? styles.destructiveButtonText : styles.primaryButtonText
                            ]}>
                                {confirmText}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10000,
        elevation: 10000,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        width: '100%',
        maxWidth: 340,
        backgroundColor: '#41403D',
        borderRadius: 20,
        padding: 24,
        borderWidth: 1.5,
        borderColor: '#333333',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
    },
    title: {
        fontSize: 20,
        fontFamily: 'ProductSans-Bold',
        color: '#FFFFFF',
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        fontFamily: 'ProductSans-Regular',
        color: '#AAAAAA',
        marginBottom: 24,
        textAlign: 'center',
        lineHeight: 22,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    buttonContainerVertical: {
        flexDirection: 'column',
        gap: 12,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonVertical: {
        flex: undefined,
        width: '100%',
    },
    cancelButton: {
        backgroundColor: '#2a2a2a',
        borderWidth: 1,
        borderColor: '#333333',
    },
    confirmButton: {
        borderWidth: 1,
    },
    primaryButton: {
        backgroundColor: '#2a241a',
        borderColor: '#22B2A6',
    },
    destructiveButton: {
        backgroundColor: '#2a1a1a',
        borderColor: '#ff5252',
    },
    cancelButtonText: {
        fontSize: 16,
        fontFamily: 'ProductSans-Bold',
        color: '#ffffffff',
    },
    primaryButtonText: {
        fontSize: 16,
        fontFamily: 'ProductSans-Bold',
        color: '#22B2A6',
    },
    destructiveButtonText: {
        fontSize: 16,
        fontFamily: 'ProductSans-Bold',
        color: '#ff5252',
    },
});

export default ConfirmationModal;
