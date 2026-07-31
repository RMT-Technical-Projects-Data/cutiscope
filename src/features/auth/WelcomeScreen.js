import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  NativeModules,
  DeviceEventEmitter,
} from 'react-native';
import KioskTextInput from '../../shared/ui/KioskTextInput';
import { useNavigation } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import ConfirmationModal from '../../shared/ui/ConfirmationModal';
import { OrDivider, PasswordField } from '../../shared/ui';
import ForgotPasswordModal from './ForgotPasswordModal';
import authService, { checkBackendConnection, getBaseUrl } from './authService';
import { UserMessages } from '../../shared/utils/userMessages';
import { useAuth } from './authSessionContext';
import { useFocusEffect } from '@react-navigation/native';
import { notifyUserActivity } from '../../shared/utils/inAppToast';

const Logo = require('../../../assets/cutiscopeLogo-removebg-preview.png');
const GuestIcon = require('../../../assets/guest_icon.png');

const WelcomeScreen = ({ onLoginSuccess, onGuestContinue }) => {
  const [loading, setLoading] = useState(false);
  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [isWifiConnected, setIsWifiConnected] = useState(true);
  // Single identifier field: email OR username
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [signUpStep, setSignUpStep] = useState(1); // 1=email, 2=enter OTP & verify, 3=new password
  const [sendOtpPending, setSendOtpPending] = useState(false); // true while send-otp request in flight (optimistic UI)
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [serverReachable, setServerReachable] = useState(null);
  const [checkingServer, setCheckingServer] = useState(true);
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);

  // Add a ref to track if component is mounted
  const isMountedRef = useRef(true);
  const passwordRef = useRef(null);

  // Custom Alert State
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
    title: '',
    message: '',
    confirmText: 'OK',
    cancelText: null,
    onConfirm: null,
    verticalButtons: false
  });

  const showAlert = (title, message, options = {}) => {
    setAlertConfig({
      title,
      message,
      confirmText: options.confirmText || 'OK',
      cancelText: options.cancelText || null,
      onConfirm: options.onConfirm || null,
      verticalButtons: options.verticalButtons || false
    });
    setAlertVisible(true);
  };

  const navigation = useNavigation();
  const { login: authLogin, guestLogin: doGuestLogin, exitGuestMode } = useAuth();
  const [networkStatus, setNetworkStatus] = useState('unknown');

  const checkConnectivity = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (Platform.OS === 'android' && NativeModules.ConnectivityModule) {
      try {
        const status = await NativeModules.ConnectivityModule.getNetworkStatus();
        if (!isMountedRef.current) return;
        setNetworkStatus(status);

        // For general 'connected' check, we consider WiFi and Cellular as potentially connected
        // but WiFi is preferred for DermaScope's specific logic context.
        const onWifi = status === 'WIFI_INTERNET' || status === 'WIFI_NO_INTERNET';
        setIsWifiConnected(onWifi);
      } catch (e) {
        console.warn('checkConnectivity error:', e);
      }
    }
  }, []);

  useEffect(() => {
    // Emit event to reset any lingering timer when on Welcome screen
    notifyUserActivity();

    return () => {
      // Cleanup if needed
    };
  }, []);
  const handleScreenTouch = useCallback(() => {
    notifyUserActivity();
  }, []);

  // Email: proper format (local@domain.tld), must have domain with TLD e.g. .com
  const validateEmail = (val) => {
    if (!val || typeof val !== 'string') return false;
    const trimmed = val.trim().toLowerCase();
    if (trimmed.length > 254) return false;
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(trimmed)) return false;
    const afterAt = trimmed.split('@')[1] || '';
    return afterAt.includes('.') && /\.(com|org|net|edu|gov|co|in|io|[a-zA-Z]{2,})$/.test(afterAt);
  };

  // Password: min 8 chars, one uppercase, one special character, one digit
  const validatePassword = (p) => {
    if (!p || typeof p !== 'string') return { ok: false, msg: 'Password is required' };
    if (p.length < 8) return { ok: false, msg: 'Password must be at least 8 characters' };
    if (!/[A-Z]/.test(p)) return { ok: false, msg: 'Password must contain at least one capital letter' };
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'`~]/.test(p)) return { ok: false, msg: 'Password must contain at least one special character (!@#$%^&* etc.)' };
    if (!/\d/.test(p)) return { ok: false, msg: 'Password must contain at least one digit' };
    return { ok: true };
  };

  const checkWifi = async () => {
    const state = await NetInfo.fetch();
    if (!state.isConnected || state.type !== 'wifi') {
      navigation.navigate('WifiOnboarding', { isIntentional: true });
      return false;
    }
    return true;
  };

  const checkServer = useCallback(async () => {
    if (!isMountedRef.current) return false;
    setCheckingServer(true);
    try {
      // Prefer native force-validate against API health so a fresh hotspot
      // is treated as online even before Android marks the network VALIDATED.
      if (Platform.OS === 'android' && NativeModules.ConnectivityModule?.forceValidateNetwork) {
        try {
          const status = await NativeModules.ConnectivityModule.forceValidateNetwork(
            `${getBaseUrl()}/api/health`
          );
          if (status === 'WIFI_INTERNET' || status === 'CELLULAR_INTERNET') {
            if (isMountedRef.current) setServerReachable(true);
            return true;
          }
        } catch (_) {
          // Fall through to HTTP health check.
        }
      }
      await checkBackendConnection();
      if (!isMountedRef.current) return false;
      setServerReachable(true);
      return true;
    } catch {
      if (!isMountedRef.current) return false;
      setServerReachable(false);
      return false;
    } finally {
      if (isMountedRef.current) {
        setCheckingServer(false);
      }
    }
  }, []);

  // Re-probe backend whenever Wi‑Fi / network state changes (fixes stale
  // "Connection Error" after forget Wi‑Fi → logout → reconnect hotspot).
  useEffect(() => {
    isMountedRef.current = true;

    const handleStateChange = () => {
      if (!isMountedRef.current) return;
      checkConnectivity();
      checkServer();
    };

    const unsubscribe = NetInfo.addEventListener(handleStateChange);
    checkConnectivity();
    checkServer();

    const pollId = setInterval(() => {
      if (isMountedRef.current) {
        checkConnectivity();
      }
    }, 5000);

    return () => {
      isMountedRef.current = false;
      unsubscribe && unsubscribe();
      pollId && clearInterval(pollId);
    };
  }, [checkConnectivity, checkServer]);

  // CRITICAL FIX: Removed exitGuestMode() from useFocusEffect
  // This was causing the CameraScreen's inactivity timer to break
  useFocusEffect(
    React.useCallback(() => {
      checkServer();
      // Safety cleanup: ensure guest photos are wiped whenever we return to Welcome screen
      // exitGuestMode(); // COMMENTED OUT - THIS WAS CAUSING THE ISSUE
    }, [checkServer])
  );

  const showConnectionError = useCallback(() => {
    showAlert(
      'Connection Error',
      'Unable to connect to the server. Please make sure your device is connected to the network.',
      {
        confirmText: 'Open WiFi Settings',
        cancelText: 'OK',
        verticalButtons: true,
        onConfirm: () => {
          setAlertVisible(false);
          navigation.navigate('WifiOnboarding', { isIntentional: true });
        },
      }
    );
  }, [navigation]);

  /** Live probe — never trust a cached failed health check from while offline. */
  const ensureServerReachable = useCallback(async () => {
    const ok = await checkServer();
    return ok;
  }, [checkServer]);

  const handleLogin = async () => {
    if (!identifier && !password) {
      showAlert('Missing Info', 'Please enter your email and password.');
      return;
    }
    if (!identifier) {
      showAlert('Missing Info', 'Please enter your email.');
      return;
    }
    if (!password) {
      showAlert('Missing Info', 'Please enter your password.');
      return;
    }
    // If the identifier looks like an email, validate its format;
    // otherwise treat it as a username and let the backend decide.
    const trimmedId = identifier.trim();
    if (trimmedId.includes('@') && !validateEmail(trimmedId)) {
      showAlert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    // Check network + live server reachability (do not trust stale offline health cache).
    if (Platform.OS === 'android' && NativeModules.ConnectivityModule) {
      try {
        let status = null;
        if (NativeModules.ConnectivityModule.forceValidateNetwork) {
          status = await NativeModules.ConnectivityModule.forceValidateNetwork(
            `${getBaseUrl()}/api/health`
          );
        } else {
          status = await NativeModules.ConnectivityModule.getNetworkStatus();
        }
        if (status === 'WIFI_NO_INTERNET') {
          // One more HTTP probe — hotspot may work even if Android hasn't VALIDATED yet.
          const ok = await ensureServerReachable();
          if (!ok) {
            showAlert(
              'No Internet Access',
              'Your WiFi is connected but has no internet. Please check your connection or connect to a different network.',
              {
                confirmText: 'Connect to WiFi',
                cancelText: 'Cancel',
                onConfirm: () => {
                  setAlertVisible(false);
                  navigation.navigate('WifiOnboarding', { isIntentional: true });
                }
              }
            );
            return;
          }
        }
      } catch (e) {
        console.warn('handleLogin network check failed:', e);
      }
    }

    if (!(await checkWifi())) return;
    if (!(await ensureServerReachable())) {
      showConnectionError();
      return;
    }

    try {
      setLoading(true);
      const result = await authService.login(trimmedId, password);
      if (result && result.token) {
        // Only allow clinicians to login to the mobile app
        const userRole = result.user?.role || result.role;
        if (userRole !== 'clinician') {
          setLoading(false);
          showAlert('Access Denied', 'Only clinicians are allowed to login to this app.');
          return;
        }

        const userEmail = (result.email && result.email.trim()) || '';
        const userName = (result.username && result.username.trim()) || userEmail;
        if (!userName) {
          showAlert('Sign-in failed', 'Could not determine user identity. Please try again.');
          return;
        }
        await authLogin(result.token, {
          email: userEmail,
          username: userName,
          id: result.user?.id ?? result.id,
        });
        if (onLoginSuccess) onLoginSuccess();
        navigation.reset({ index: 0, routes: [{ name: 'Camera' }] });
      }
    } catch (error) {
      const msg = error.message || 'Invalid email or password.';
      if (msg === UserMessages.connectionUnavailable) {
        showAlert('Login Failed', msg, {
          confirmText: 'Open WiFi Settings',
          cancelText: 'OK',
          verticalButtons: true,
          onConfirm: () => {
            setAlertVisible(false);
            navigation.navigate('WifiOnboarding', { isIntentional: true });
          }
        });
      } else {
        showAlert('Login Failed', msg);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleSendOtp = async () => {
    const trimmedEmail = (email || '').trim().toLowerCase();
    if (!trimmedEmail) {
      showAlert('Email Required', 'Please enter your email address to receive an OTP.');
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      showAlert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!(await checkWifi())) return;
    if (!(await ensureServerReachable())) {
      showConnectionError();
      return;
    }

    // Optimistic: show OTP + password step immediately so it feels instant
    setEmail(trimmedEmail);
    setPassword('');
    setConfirmPassword('');
    setOtp('');
    setShowOtpInput(true);
    setSignUpStep(2);
    setSendOtpPending(true);

    try {
      await authService.sendOTP(trimmedEmail);
      showAlert('OTP Sent', `A verification code has been sent to ${trimmedEmail}. Enter it below.`);
    } catch (error) {
      showAlert('Could not send OTP', error.message || 'Failed to send OTP.');
      setShowOtpInput(false);
      setSignUpStep(1);
    } finally {
      if (isMountedRef.current) {
        setSendOtpPending(false);
      }
    }
  };

  const handleRegister = async () => {
    if (!otp || otp.length !== 6) {
      showAlert('Invalid OTP', 'Please enter the 6-digit code sent to your email.');
      return;
    }
    const pwdValidation = validatePassword(password);
    if (!pwdValidation.ok) {
      showAlert('Invalid Password', pwdValidation.msg);
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Passwords do not match', 'New password and Confirm password must match.');
      return;
    }
    if (!(await ensureServerReachable())) {
      showConnectionError();
      return;
    }

    try {
      setLoading(true);
      const trimmedOtp = (otp || '').trim();
      const result = await authService.register(email, password, trimmedOtp);
      if (result && result.token) {
        const userEmail = (result.email && result.email.trim()) || (email && String(email).trim()) || '';
        const userName = (result.username && result.username.trim()) || userEmail;
        if (!userName) {
          showAlert('Registration failed', 'Could not determine user identity. Please try again.');
          return;
        }
        await authLogin(result.token, {
          email: userEmail,
          username: userName,
          id: result.user?.id ?? result.id,
        });
        if (onLoginSuccess) onLoginSuccess();
        navigation.reset({ index: 0, routes: [{ name: 'Camera' }] });
      }
    } catch (error) {
      showAlert('Registration Failed', error.message || 'Invalid or expired OTP.');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const toggleMode = () => {
    setIsLoginMode(!isLoginMode);
    setShowOtpInput(false);
    setSignUpStep(1);
    setOtp('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleVerifyOtpAndContinue = () => {
    const trimmedOtp = (otp || '').trim();
    if (!trimmedOtp || trimmedOtp.length !== 6) {
      showAlert('Enter OTP', 'Please enter the 6-digit verification code sent to your email.');
      return;
    }
    // Do not call backend verify here to avoid consuming the OTP before registration.
    // Just move to the password step; backend will validate the OTP once during register.
    setSignUpStep(3);
  };

  const continueAsGuest = async () => {
    try {
      await doGuestLogin();
    } catch (e) {
      console.warn('guestLogin failed:', e);
    }
    if (onGuestContinue) onGuestContinue();
    navigation.reset({ index: 0, routes: [{ name: 'Camera' }] });
  };

  return (
    <View style={styles.container}
      onStartShouldSetResponder={() => {
        handleScreenTouch();
        return false;
      }}
      onTouchStart={handleScreenTouch}>
      <View style={[styles.topShape, { zIndex: 0 }]} />
      <View style={[styles.bottomShape, { zIndex: 0 }]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, zIndex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.nonScrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.card}>
              {/* Logo */}
              <View style={styles.logoContainer}>
                <Image source={Logo} style={styles.logoImage} resizeMode="contain" />
                <Text style={styles.logoTitle}>
                  <Text style={styles.logoTitleTeal}>Cuti</Text>
                  <Text style={styles.logoTitleWhite}>Scope</Text>
                </Text>
              </View>

              <Text style={styles.version}>v1.1.83</Text>

              {(isWifiConnected === false || networkStatus === 'WIFI_NO_INTERNET') && (
                <View style={[
                  styles.wifiNotice,
                  networkStatus === 'WIFI_NO_INTERNET' && { backgroundColor: 'rgba(229, 115, 115, 0.15)', borderColor: '#E57373' }
                ]}>
                  <Text style={styles.wifiNoticeText}>
                    {networkStatus === 'WIFI_NO_INTERNET'
                      ? 'WiFi Connected (No Internet Access)'
                      : 'You are not connected to WiFi.'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.wifiNoticeButton, networkStatus === 'WIFI_NO_INTERNET' && { backgroundColor: '#E57373' }]}
                    onPress={() => navigation.navigate('WifiOnboarding', { isIntentional: true })}
                  >
                    <Text style={styles.wifiNoticeButtonText}>Connect to WiFi</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Form */}
              <View style={styles.formContainer}>
                <Text style={styles.authTitle}>Login</Text>

                {/* Identifier: email OR username — in-app keyboard only */}
                <KioskTextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#999"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  contextMenuHidden
                  selectTextOnFocus={false}
                  showDismiss={true}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                {/* Password — in-app keyboard only */}
                <PasswordField
                  style={styles.passwordInputWrapper}
                  showPassword={showPassword}
                  onToggleShow={() => setShowPassword(!showPassword)}
                  toggleVariant="inside"
                  toggleStyle={styles.showHideBtnInside}
                  toggleTextStyle={styles.showHideText}
                >
                  <KioskTextInput
                    ref={passwordRef}
                    style={[styles.input, styles.passwordInputWithBtn]}
                    placeholder="Password"
                    placeholderTextColor="#999"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    contextMenuHidden
                    selectTextOnFocus={false}
                    showDismiss={true}
                    onSubmitEditing={handleLogin}
                  />
                </PasswordField>

                {/* Single Login button */}
                <TouchableOpacity
                  style={[styles.authButton, loading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.authButtonText}>Login</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Divider */}
              <OrDivider
                style={styles.divider}
                lineStyle={styles.dividerLine}
                textStyle={styles.dividerText}
              />

              {/* Guest */}
              <TouchableOpacity
                style={styles.guestButton}
                onPress={continueAsGuest}
                disabled={loading}
              >
                <View style={styles.buttonContent}>
                  <Image source={GuestIcon} style={[styles.buttonIcon, { tintColor: '#FFFFFF' }]} />
                  <Text style={styles.guestButtonText}>Continue as Guest</Text>
                </View>
              </TouchableOpacity>

            </View>
          </View>
        </ScrollView>

        <ConfirmationModal
          visible={wifiModalVisible}
          onClose={() => setWifiModalVisible(false)}
          onConfirm={() => setWifiModalVisible(false)}
          title="Connection Required"
          message="Please connect to WiFi"
          confirmText="OK"
          cancelText={null}
        />

        <ConfirmationModal
          visible={alertVisible}
          onClose={() => setAlertVisible(false)}
          onConfirm={alertConfig.onConfirm || (() => setAlertVisible(false))}
          title={alertConfig.title}
          message={alertConfig.message}
          confirmText={alertConfig.confirmText}
          cancelText={alertConfig.cancelText}
          verticalButtons={alertConfig.verticalButtons}
        />

        <ForgotPasswordModal
          visible={forgotPasswordVisible}
          onClose={() => setForgotPasswordVisible(false)}
        />
      </KeyboardAvoidingView>
    </View>
  );
};

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#41403D',
  },
  nonScrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topShape: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: width * 0.6,
    height: height * 0.15,
    backgroundColor: '#22B2A6',
    borderBottomLeftRadius: width * 0.3,
  },
  bottomShape: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: width * 0.5,
    height: height * 0.12,
    backgroundColor: '#22B2A6',
    borderTopLeftRadius: width * 0.25,
  },
  content: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginTop: 35,
  },
  card: {
    width: '100%',
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    elevation: 8,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 2,
  },
  logoImage: {
    width: 90,
    height: 90,
    marginBottom: 0,
  },
  logoTitle: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  logoTitleTeal: {
    color: '#22B2A6',
  },
  logoTitleWhite: {
    color: '#FFFFFF',
  },
  version: {
    fontSize: 11,
    color: '#999999',
    marginBottom: 6,
  },
  serverStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  serverStatusText: {
    fontSize: 12,
    color: '#999999',
  },
  serverStatusOk: {
    color: '#22B2A6',
  },
  serverStatusFail: {
    color: '#E57373',
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#22B2A6',
    borderRadius: 6,
  },
  retryButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  formContainer: {
    width: '100%',
    marginBottom: 5,
  },
  authTitle: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: '#3a3a3a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    color: '#FFFFFF',
    fontSize: 14,
  },
  otpInput: {
    letterSpacing: 4,
    fontSize: 16,
    textAlign: 'center',
  },
  otpInfo: {
    color: '#CCCCCC',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 6,
    lineHeight: 16,
  },
  backText: {
    color: '#22B2A6',
    fontSize: 12,
    marginBottom: 6,
  },
  authButton: {
    width: '100%',
    backgroundColor: '#22B2A6',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 2,
  },
  authButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleText: {
    color: '#22B2A6',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 12,
  },
  forgotPasswordBtn: {
    marginTop: 10,
    alignSelf: 'center',
  },
  forgotPasswordText: {
    color: '#22B2A6',
    fontSize: 12,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#444',
  },
  dividerText: {
    color: '#666',
    paddingHorizontal: 8,
    fontSize: 10,
  },
  guestButton: {
    width: '100%',
    backgroundColor: '#5c5c5c',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  guestButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonIcon: {
    width: 18,
    height: 18,
    marginRight: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  stepBlock: {
    width: '100%',
  },
  otpSentCard: {
    backgroundColor: 'rgba(34, 178, 166, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(34, 178, 166, 0.4)',
    width: '100%',
  },
  otpSentTitle: {
    color: '#22B2A6',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  otpSentEmail: {
    color: '#CCCCCC',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 4,
  },
  otpSentEmailBold: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  otpSentHint: {
    color: '#999999',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  fieldLabel: {
    color: '#AAAAAA',
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 2,
    fontWeight: '600',
  },
  passwordInputWrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 8,
  },
  passwordInputWithBtn: {
    paddingRight: 56,
  },
  showHideBtnInside: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  inputFlex: {
    flex: 1,
    marginBottom: 6,
  },
  showHideBtn: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  showHideText: {
    color: '#22B2A6',
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryAuthButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#22B2A6',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryAuthButtonText: {
    color: '#22B2A6',
    fontSize: 14,
    fontWeight: '700',
  },
  footerText: {
    color: '#666666',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 6,
  },
  wifiNotice: {
    width: '100%',
    backgroundColor: 'rgba(34, 178, 166, 0.12)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 178, 166, 0.6)',
    alignItems: 'center',
  },
  wifiNoticeText: {
    color: '#FFFFFF',
    fontSize: 12,
    marginBottom: 4,
    textAlign: 'center',
  },
  wifiNoticeButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#22B2A6',
  },
  wifiNoticeButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default WelcomeScreen;