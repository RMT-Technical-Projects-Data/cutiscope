import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  Alert,
  ScrollView,
  SafeAreaView
} from 'react-native';
import KioskTextInput from '../Components/KioskTextInput';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import Config from 'react-native-config';
import ConfirmationModal from '../modals/ConfirmationModal';
// import CustomStatusBar from '../Components/CustomStatusBar';


const { height, width } = Dimensions.get('window');

// Use environment variable or fallback
const API_BASE_URL = Config.API_BASE_URL || 'http://35.154.32.201:4040';
// const API_BASE_URL = Config.API_BASE_URL || 'http://192.168.50.75:3009';
const API_TIMEOUT = parseInt(Config.API_TIMEOUT || '10000');

// Configure axios defaults
axios.defaults.timeout = API_TIMEOUT;

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Custom Alert State
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ title: '', message: '' });

  const showAlert = (title, message) => {
    setAlertConfig({ title, message });
    setAlertVisible(true);
  };

  const { login, guestLogin } = useAuth();

  const handleLogin = async () => {
    // Basic validation
    if (!email || !password) {
      showAlert('Error', 'Please enter both email and password');
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showAlert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);

    try {
      console.log(`Attempting login to: ${API_BASE_URL}/api/auth/login`);
      console.log('With email:', email.trim());

      // Make API call to your backend
      const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
        email: email.trim(),
        password: password,
      });

      console.log('Login response:', response.data);

      // Check if response has the expected structure from your backend
      if (response.data.message === "Login successful" && response.data.user) {
        const userData = response.data.user;
        if (userData.role !== 'clinician') {
          setLoading(false);
          showAlert('Access Denied', 'Only clinicians are allowed to login to this app.');
          return;
        }


        // Create a local token based on user data
        const localToken = `app-token-${userData.id}-${Date.now()}`;

        console.log('Login successful for user:', userData.email);

        try {
          // Save the local token and user data
          await login(localToken, userData);
          console.log('Login successful, user data saved');

          showAlert('Success', `Welcome back, ${userData.username || userData.email}!`);

        } catch (authError) {
          console.error('Error in auth context login:', authError);
          showAlert('Authentication Error', 'Failed to save login session. Please try again.');
        }
      } else {
        // Backend returned a different message
        showAlert('Error', response.data.message || 'Login failed');
      }
    } catch (error) {
      console.error('Login error details:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status
      });

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        const message = data?.message || '';

        switch (status) {
          case 400:
            showAlert('Error', message || 'Please provide email and password');
            break;
          case 401:
            showAlert('Error', message || 'Invalid email or password');
            break;
          case 404:
            showAlert('Error', 'Login endpoint not found. Please check the API URL');
            break;
          case 500:
            showAlert('Server Error', message || 'Server is experiencing issues. Please try again later');
            break;
          default:
            showAlert('Error', message || `Server error (${status})`);
        }
      } else if (error.request) {
        showAlert(
          'Connection Error',
          `Cannot connect to server at:\n${API_BASE_URL}\n\nPlease check connection settings.`
        );
      } else if (error.code === 'ECONNABORTED') {
        showAlert('Timeout Error', 'Connection timeout. Server might be busy or unreachable');
      } else {
        showAlert('Error', error.message || 'An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    try {
      await guestLogin();
      showAlert('Guest Mode', 'Continuing as guest with limited features');
    } catch (error) {
      console.error('Guest login error:', error);
      showAlert('Error', 'Failed to enter guest mode');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* <CustomStatusBar /> */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Header / Logo Section */}
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoIcon}>🔬</Text>
            </View>
            <Text style={styles.appTitle}>MedImage</Text>
            <Text style={styles.appSubtitle}>Dermatology Imaging Tools</Text>
          </View>

          {/* Login Form Section */}
          <View style={styles.formSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <KioskTextInput
                style={styles.input}
                placeholder="name@clinic.com"
                placeholderTextColor="#A0AEC0"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                editable={!loading}
                returnKeyType="next"
                showDismiss={true}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <KioskTextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#A0AEC0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                showDismiss={true}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleGuestLogin}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryButtonText}>Continue as Guest</Text>
            </TouchableOpacity>
          </View>

          {/* Footer Section */}
          <View style={styles.footerSection}>
            <Text style={styles.footerText}>
              Developed by <Text style={styles.companyName}>Revive Medical Technologies</Text>
            </Text>

            {__DEV__ && (
              <View style={styles.debugBadge}>
                <Text style={styles.debugText}>Host: {API_BASE_URL.replace('http://', '')}</Text>
              </View>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmationModal
        visible={alertVisible}
        onClose={() => setAlertVisible(false)}
        onConfirm={() => setAlertVisible(false)}
        title={alertConfig.title}
        message={alertConfig.message}
        confirmText="OK"
        cancelText={null}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingBottom: 30,
  },

  // Header Styles
  headerSection: {
    alignItems: 'center',
    marginTop: height * 0.05,
    marginBottom: 40,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#F0F9FF', // Lightest blue
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  logoIcon: {
    fontSize: 32,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A', // Slate 900
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 15,
    color: '#64748B', // Slate 500
    fontWeight: '400',
  },

  // Form Styles
  formSection: {
    width: '100%',
    marginBottom: 40,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155', // Slate 700
    marginBottom: 8,
    marginLeft: 2,
  },
  input: {
    backgroundColor: '#F8FAFC', // Slate 50
    borderWidth: 1,
    borderColor: '#E2E8F0', // Slate 200
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1E293B',
  },

  // Buttons
  primaryButton: {
    backgroundColor: '#0EA5E9', // Sky 500
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },

  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '600',
  },

  // Footer Styles
  footerSection: {
    alignItems: 'center',
    marginTop: 'auto',
  },
  footerText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 8,
  },
  companyName: {
    color: '#64748B',
    fontWeight: '600',
  },
  debugBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  debugText: {
    fontSize: 10,
    color: '#CBD5E1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default LoginScreen;