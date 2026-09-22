import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Dimensions,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import KioskTextInput from '../Components/KioskTextInput';
import authService from '../services/authService';
import { UserMessages } from '../utils/userMessages';
import ConfirmationModal from './ConfirmationModal';

const STEP_SEND = 1;
const STEP_OTP = 2;
const STEP_PASSWORD = 3;

function validatePassword(p) {
    if (!p || typeof p !== 'string') return { ok: false, msg: 'Password is required' };
    if (p.length < 8) return { ok: false, msg: 'Password must be at least 8 characters' };
    if (!/[A-Z]/.test(p)) return { ok: false, msg: 'Password must contain at least one capital letter' };
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'`~]/.test(p)) return { ok: false, msg: 'Password must contain at least one special character (!@#$%^&* etc.)' };
    if (!/\d/.test(p)) return { ok: false, msg: 'Password must contain at least one digit' };
    return { ok: true };
}

const ChangePasswordModal = ({ visible, onClose }) => {
    const [step, setStep] = useState(STEP_SEND);
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [alertVisible, setAlertVisible] = useState(false);
    const [alertConfig, setAlertConfig] = useState({ title: '', message: '', onConfirm: null });

    useEffect(() => {
        if (!visible) {
            setStep(STEP_SEND);
            setOtp('');
            setNewPassword('');
            setConfirmPassword('');
        }
    }, [visible]);

    const showAlert = (title, message, onConfirm = null) => {
        setAlertConfig({ title, message, onConfirm });
        setAlertVisible(true);
    };

    const handleSendCode = async () => {
        try {
            // Make sure user is logged in before calling backend
            const token = await authService.getToken();
            if (!token) {
                showAlert('Log in required', 'Please log in again to change your password.');
                return;
            }

            setLoading(true);
            await authService.sendChangePasswordOtp();
            setStep(STEP_OTP);
            setOtp('');
        } catch (e) {
            // Show a clearer message instead of a very generic error
            const msg = e && e.message
                ? e.message
                : 'We couldn\'t send the verification code. Please check your connection and try again.';
            showAlert('Could not send code', msg);
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        const code = (otp || '').trim();
        if (code.length !== 6) {
            showAlert('Invalid code', 'Please enter the 6-digit verification code from your email.');
            return;
        }
        try {
            setLoading(true);
            await authService.verifyChangePasswordOtp(code);
            showAlert('OTP verified', 'Verification successful. Now enter your new password.');
            setStep(STEP_PASSWORD);
            setNewPassword('');
            setConfirmPassword('');
        } catch (e) {
            showAlert('Verification failed', e.message || 'Invalid or expired code. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePassword = async () => {
        const code = (otp || '').trim();
        if (code.length !== 6) {
            showAlert('Invalid code', 'Please enter the 6-digit verification code.');
            return;
        }
        const pwdCheck = validatePassword(newPassword);
        if (!pwdCheck.ok) {
            showAlert('Invalid password', pwdCheck.msg);
            return;
        }
        if (newPassword !== confirmPassword) {
            showAlert('Passwords do not match', 'New password and Confirm password must match.');
            return;
        }
        try {
            setLoading(true);
            await authService.changePasswordWithOtp(code, newPassword);
            showAlert('Password updated', UserMessages.passwordChanged, () => {
                onClose();
            });
        } catch (e) {
            showAlert('Could not update password', e.message || UserMessages.passwordChangeFailed);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.modalBox}
                >
                    <Text style={styles.title} selectable={false}>Change Password</Text>

                    {step === STEP_SEND && (
                        <View style={styles.form}>
                            <Text style={styles.hint}>A verification code will be sent to your registered email.</Text>
                            <TouchableOpacity
                                style={[styles.submitButton, loading && styles.disabledButton]}
                                onPress={handleSendCode}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.submitButtonText} selectable={false}>Send verification code</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}

                    {step === STEP_OTP && (
                        <View style={styles.form}>
                    <Text style={styles.label} selectable={false}>Verification code (6 digits)</Text>
                    <KioskTextInput
                        style={styles.input}
                        value={otp}
                        onChangeText={setOtp}
                        placeholder="Enter code from email"
                        placeholderTextColor="#666"
                        maxLength={6}
                        contextMenuHidden
                        selectTextOnFocus={false}
                    />
                    <TouchableOpacity style={[styles.submitButton, loading && styles.disabledButton]} onPress={handleVerifyOtp} disabled={loading}>
                        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitButtonText} selectable={false}>Continue</Text>}
                    </TouchableOpacity>
                        </View>
                    )}

                    {step === STEP_PASSWORD && (
                        <View style={styles.form}>
                    <Text style={styles.label} selectable={false}>New password</Text>
                    <View style={styles.passwordRow}>
                        <KioskTextInput
                            style={[styles.input, styles.inputFlex]}
                            secureTextEntry={!showNewPassword}
                            value={newPassword}
                            onChangeText={setNewPassword}
                            placeholder="Min 8 chars, 1 capital, 1 special, 1 digit"
                            placeholderTextColor="#666"
                            contextMenuHidden
                            selectTextOnFocus={false}
                        />
                                <TouchableOpacity style={styles.showHideBtn} onPress={() => setShowNewPassword(!showNewPassword)}>
                                    <Text style={styles.showHideText}>{showNewPassword ? 'Hide' : 'Show'}</Text>
                                </TouchableOpacity>
                            </View>
                    <Text style={styles.label} selectable={false}>Confirm new password</Text>
                    <View style={styles.passwordRow}>
                        <KioskTextInput
                            style={[styles.input, styles.inputFlex]}
                            secureTextEntry={!showConfirmPassword}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            placeholder="Re-enter new password"
                            placeholderTextColor="#666"
                            contextMenuHidden
                            selectTextOnFocus={false}
                        />
                                <TouchableOpacity style={styles.showHideBtn} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                                    <Text style={styles.showHideText}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity
                                style={[styles.submitButton, loading && styles.disabledButton]}
                                onPress={handleUpdatePassword}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.submitButtonText} selectable={false}>Update Password</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}

                    <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
                        <Text style={styles.secondaryButtonText} selectable={false}>Back</Text>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </View>

            <ConfirmationModal
                visible={alertVisible}
                onClose={() => setAlertVisible(false)}
                onConfirm={() => {
                    setAlertVisible(false);
                    if (alertConfig.onConfirm) alertConfig.onConfirm();
                }}
                title={alertConfig.title}
                message={alertConfig.message}
                confirmText="OK"
                cancelText={null}
            />
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalBox: {
        backgroundColor: '#2a2a2a',
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 360,
    },
    title: {
        fontSize: 22,
        color: '#FFFFFF',
        fontWeight: '700',
        marginBottom: 24,
        textAlign: 'center',
    },
    form: {
        width: '100%',
        marginBottom: 16,
    },
    hint: {
        color: '#AAAAAA',
        fontSize: 14,
        marginBottom: 20,
        textAlign: 'center',
    },
    label: {
        color: '#AAAAAA',
        fontSize: 13,
        marginBottom: 6,
        fontWeight: '600',
    },
    input: {
        backgroundColor: '#1a1a1a',
        borderRadius: 10,
        color: '#FFFFFF',
        padding: 14,
        fontSize: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#333',
    },
    passwordRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    inputFlex: {
        flex: 1,
        marginBottom: 0,
    },
    showHideBtn: {
        paddingVertical: 14,
        paddingHorizontal: 12,
        justifyContent: 'center',
        minHeight: 48,
        alignSelf: 'stretch',
    },
    showHideText: {
        color: '#22B2A6',
        fontSize: 16,
        fontWeight: '600',
    },
    submitButton: {
        backgroundColor: '#22B2A6',
        borderRadius: 10,
        padding: 15,
        alignItems: 'center',
        marginTop: 10,
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#22B2A6',
        borderRadius: 10,
        padding: 15,
        alignItems: 'center',
        marginTop: 12,
    },
    secondaryButtonText: {
        color: '#22B2A6',
        fontSize: 16,
        fontWeight: '700',
    },
    disabledButton: {
        opacity: 0.7,
    },
});

export default ChangePasswordModal;
