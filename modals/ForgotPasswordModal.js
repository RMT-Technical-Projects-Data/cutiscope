import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import KioskTextInput from '../Components/KioskTextInput';
import authService from '../services/authService';
import { UserMessages } from '../utils/userMessages';
import ConfirmationModal from './ConfirmationModal';

const ForgotPasswordModal = ({ visible, onClose }) => {
  const [step, setStep] = useState(1); // 1=email, 2=enter OTP, 3=password
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Custom Alert State
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ title: '', message: '', onConfirm: null });

  const showAlert = (title, message, onConfirm = null) => {
    setAlertConfig({ title, message, onConfirm });
    setAlertVisible(true);
  };

  const validateEmail = (val) => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim().toLowerCase();
    if (trimmed.length > 254) return false;
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(trimmed)) return false;
    const afterAt = trimmed.split('@')[1] || '';
    return afterAt.includes('.') && /\.(com|org|net|edu|gov|co|in|io|[a-zA-Z]{2,})$/.test(afterAt);
  };

  const handleSendCode = async () => {
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) {
      showAlert('Enter email', 'Please enter your registered email address.');
      return;
    }
    if (!validateEmail(trimmed)) {
      showAlert('Invalid email', 'Please enter a valid email address (e.g. name@domain.com).');
      return;
    }
    try {
      setLoading(true);
      await authService.forgotPassword(trimmed);
      setEmail(trimmed);
      setStep(2);
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      const msg = e.message || '';
      if (msg.toLowerCase().includes('no account') || msg.toLowerCase().includes('not found') || msg.includes('404')) {
        showAlert('Email not registered', UserMessages.emailNotRegistered);
      } else if (msg.toLowerCase().includes('reach') || msg.toLowerCase().includes('network')) {
        showAlert('Unable to connect', UserMessages.connectionUnavailable);
      } else {
        showAlert('Could not send reset code', UserMessages.resetCodeNotSent);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndContinue = async () => {
    if (!otp || otp.trim().length !== 6) {
      showAlert('Enter OTP', 'Please enter the 6-digit verification code sent to your email.');
      return;
    }
    try {
      setLoading(true);
      await authService.verifyOtp(email, otp.trim());
      showAlert('OTP verified', 'Verification successful. Now set your new password.');
      setStep(3);
    } catch (e) {
      showAlert('Verification failed', e.message || 'Invalid or expired OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!otp || otp.length !== 6) {
      showAlert('Error', 'Please enter the 6-digit code from your email');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      showAlert('Error', 'Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      showAlert('Error', 'Password must contain at least one capital letter');
      return;
    }
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'`~]/.test(newPassword)) {
      showAlert('Error', 'Password must contain at least one special character (!@#$%^&* etc.)');
      return;
    }
    if (!/\d/.test(newPassword)) {
      showAlert('Error', 'Password must contain at least one digit');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return;
    }
    try {
      setLoading(true);
      await authService.resetPassword(email, otp, newPassword);
      showAlert('Password updated', UserMessages.passwordUpdated, () => {
        setStep(1); setEmail(''); setOtp(''); setNewPassword(''); setConfirmPassword(''); onClose();
      });
    } catch (e) {
      showAlert('Could not update password', UserMessages.invalidOrExpiredCode);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      setOtp('');
    } else if (step === 3) {
      setStep(2);
      setNewPassword('');
      setConfirmPassword('');
    } else {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.box}>
          <Text style={styles.title} selectable={false}>
            {step === 1 ? 'Forgot password' : step === 2 ? 'Enter verification code' : 'Set new password'}
          </Text>

          {step === 1 ? (
            <>
              <Text style={styles.hint} selectable={false}>Enter your registered email and we'll send a verification code.</Text>
              <KioskTextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                contextMenuHidden
                selectTextOnFocus={false}
              />
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
                onPress={handleSendCode}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send verification code</Text>}
              </TouchableOpacity>
            </>
          ) : step === 2 ? (
            <>
              <View style={styles.messageCard}>
                <Text style={styles.messageCardTitle}>Verification code sent</Text>
                <Text style={styles.messageCardBody}>A 6-digit code has been sent to{'\n'}<Text style={styles.messageCardEmail}>{email}</Text></Text>
                <Text style={styles.messageCardHint}>Please enter it below.</Text>
              </View>
              <Text style={styles.fieldLabel} selectable={false}>Enter OTP</Text>
              <KioskTextInput
                style={styles.input}
                placeholder="Enter 6-digit code"
                placeholderTextColor="#999"
                value={otp}
                onChangeText={setOtp}
                maxLength={6}
                contextMenuHidden
                selectTextOnFocus={false}
              />
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, (loading || (otp || '').trim().length !== 6) && styles.btnDisabled]}
                onPress={handleVerifyAndContinue}
                disabled={loading || (otp || '').trim().length !== 6}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify OTP</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.messageCard}>
                <Text style={styles.messageCardTitle}>Set new password</Text>
                <Text style={styles.messageCardHint}>Use at least 8 characters with one capital letter, one special character, and one digit.</Text>
              </View>
              <Text style={styles.fieldLabel} selectable={false}>New password</Text>
              <View style={styles.passwordRow}>
                <KioskTextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="Enter new password"
                  placeholderTextColor="#999"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNewPassword}
                  contextMenuHidden
                  selectTextOnFocus={false}
                />
                <TouchableOpacity style={styles.showHideBtn} onPress={() => setShowNewPassword(!showNewPassword)}>
                  <Text style={styles.showHideText} selectable={false}>{showNewPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldLabel} selectable={false}>Confirm password</Text>
              <View style={styles.passwordRow}>
                <KioskTextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="Re-enter password"
                  placeholderTextColor="#999"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  contextMenuHidden
                  selectTextOnFocus={false}
                />
                <TouchableOpacity style={styles.showHideBtn} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  <Text style={styles.showHideText} selectable={false}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
                onPress={handleResetPassword}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Update password</Text>}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleBack}>
            <Text style={styles.btnTextSecondary}>{step === 1 ? 'Cancel' : 'Back'}</Text>
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: '#999',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  messageCard: {
    backgroundColor: 'rgba(34, 178, 166, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(34, 178, 166, 0.4)',
  },
  messageCardTitle: {
    color: '#22B2A6',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  messageCardBody: { color: '#CCC', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  messageCardEmail: { color: '#fff', fontWeight: '600' },
  messageCardHint: { color: '#999', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  fieldLabel: { color: '#AAA', fontSize: 13, marginBottom: 6, marginLeft: 2, fontWeight: '600' },
  passwordRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 12 },
  inputFlex: { flex: 1, marginBottom: 0 },
  showHideBtn: { paddingVertical: 14, paddingHorizontal: 12, marginLeft: 8, justifyContent: 'center', minHeight: 48 },
  showHideText: { color: '#22B2A6', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    color: '#fff',
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  btn: {
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: '#22B2A6',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#22B2A6',
    marginTop: 12,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  btnTextSecondary: {
    color: '#22B2A6',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ForgotPasswordModal;
