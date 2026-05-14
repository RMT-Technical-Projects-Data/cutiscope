import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { UserMessages, toUserMessage } from '../utils/userMessages';

const BASE_URL = (Config.API_BASE_URL || 'http://192.168.50.144:3009').replace(/\/$/, '');
const API_URL = `${BASE_URL}/api/users`;

if (__DEV__) {
    console.log('Auth API base URL:', BASE_URL);
}

const AXIOS_TIMEOUT = 15000;
const HEALTH_TIMEOUT = 8000;

/** Get the backend base URL (no trailing slash). */
export function getBaseUrl() {
    return BASE_URL;
}

/**
 * Check if the backend is reachable (GET /api/health).
 * Resolves to true if OK, throws with message if unreachable.
 */
export async function checkBackendConnection() {
    const url = `${BASE_URL}/api/health`;
    try {
        const response = await axios.get(url, {
            timeout: HEALTH_TIMEOUT,
            validateStatus: (s) => s === 200,
        });
        if (response.status === 200 && response.data && response.data.ok) {
            return true;
        }
        throw new Error('Invalid health response');
    } catch (err) {
        throw new Error(UserMessages.connectionUnavailable);
    }
}

function getMessage(err) {
    if (!err) return UserMessages.somethingWrong;
    const data = err.response && err.response.data;
    const backendMsg = (data && typeof data.message === 'string') ? data.message : (data && typeof data === 'string') ? data : null;
    if (backendMsg) {
        const safe = toUserMessage(backendMsg, UserMessages.somethingWrong);
        if (safe !== UserMessages.somethingWrong) return safe;
        if (backendMsg.toLowerCase().includes('invalid') && backendMsg.toLowerCase().includes('password')) return UserMessages.signInFailed;
        if (backendMsg.toLowerCase().includes('email')) return backendMsg;
        if (backendMsg.toLowerCase().includes('otp') || backendMsg.toLowerCase().includes('expired')) return UserMessages.invalidOrExpiredCode;
        return UserMessages.somethingWrong;
    }
    if (err.code === 'ECONNABORTED' || err.message === 'Network Error') return UserMessages.connectionUnavailable;
    return toUserMessage(err, UserMessages.somethingWrong);
}

class AuthService {
    async sendOTP(email) {
        try {
            const response = await axios.post(`${API_URL}/send-otp`, { email: (email || '').trim().toLowerCase() }, { timeout: AXIOS_TIMEOUT });
            return response.data;
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async register(email, password, otp) {
        try {
            const response = await axios.post(`${API_URL}/register`, {
                email: (email || '').trim().toLowerCase(),
                password,
                otp: (otp || '').trim(),
            }, { timeout: AXIOS_TIMEOUT });

            if (response.data && response.data.token) {
                await AsyncStorage.setItem('userToken', response.data.token);
                await AsyncStorage.setItem('userEmail', response.data.email);
                await AsyncStorage.setItem('username', response.data.email || '');
            }

            return response.data;
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async login(email, password) {
        try {
            const body = {
                email: String(email || '').trim().toLowerCase(),
                password: String(password ?? ''),
            };
            const response = await axios.post(`${API_URL}/login`, body, {
                timeout: AXIOS_TIMEOUT,
                headers: { 'Content-Type': 'application/json' },
                validateStatus: () => true,
            });

            const data = response.data;
            if (response.status === 200 && data && data.token) {
                await AsyncStorage.setItem('userToken', data.token);
                await AsyncStorage.setItem('userEmail', data.email || '');
                await AsyncStorage.setItem('username', data.email || '');
                return data;
            }

            const msg = (data && data.message) ? data.message : (response.status === 401 ? 'Invalid email or password' : 'Login failed');
            throw new Error(msg);
        } catch (error) {
            throw new Error(getMessage(error) || error.message || 'Login failed');
        }
    }

    async changePassword(oldPassword, newPassword) {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Please log in to change password');
            const response = await axios.put(
                `${API_URL}/change-password`,
                { oldPassword, newPassword },
                {
                    timeout: AXIOS_TIMEOUT,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                }
            );
            if (response.status === 200 && response.data && response.data.message) {
                return response.data;
            }
            throw new Error((response.data && response.data.message) || 'Failed to change password');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async verifyOtp(email, otp) {
        try {
            const response = await axios.post(
                `${API_URL}/verify-otp`,
                { email: (email || '').trim().toLowerCase(), otp: (otp || '').trim() },
                { timeout: AXIOS_TIMEOUT, validateStatus: () => true }
            );
            if (response.status === 200 && response.data && response.data.valid) return response.data;
            throw new Error((response.data && response.data.message) || 'Invalid or expired OTP');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async verifyChangePasswordOtp(otp) {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Please log in first');
            const response = await axios.post(
                `${API_URL}/verify-change-password-otp`,
                { otp: (otp || '').trim() },
                {
                    timeout: AXIOS_TIMEOUT,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                }
            );
            if (response.status === 200 && response.data && response.data.valid) return response.data;
            throw new Error((response.data && response.data.message) || 'Invalid or expired verification code');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async sendChangePasswordOtp() {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Please log in first');
            const response = await axios.post(
                `${API_URL}/send-change-password-otp`,
                {},
                {
                    timeout: AXIOS_TIMEOUT,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                }
            );
            if (response.status === 200) return response.data;
            throw new Error((response.data && response.data.message) || 'Failed to send code');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async changePasswordWithOtp(otp, newPassword) {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) throw new Error('Please log in first');
            const response = await axios.post(
                `${API_URL}/change-password-with-otp`,
                { otp: (otp || '').trim(), newPassword: newPassword || '' },
                {
                    timeout: AXIOS_TIMEOUT,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    validateStatus: () => true,
                }
            );
            if (response.status === 200 && response.data && response.data.message) {
                return response.data;
            }
            throw new Error((response.data && response.data.message) || 'Failed to change password');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async forgotPassword(email) {
        try {
            const response = await axios.post(
                `${API_URL}/forgot-password`,
                { email: (email || '').trim().toLowerCase() },
                { timeout: AXIOS_TIMEOUT, validateStatus: () => true }
            );
            if (response.status === 200) return response.data;
            throw new Error((response.data && response.data.message) || 'Failed to send reset code');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async resetPassword(email, otp, newPassword) {
        try {
            const response = await axios.post(
                `${API_URL}/reset-password`,
                {
                    email: (email || '').trim().toLowerCase(),
                    otp: (otp || '').trim(),
                    newPassword: newPassword || '',
                },
                { timeout: AXIOS_TIMEOUT, validateStatus: () => true }
            );
            if (response.status === 200) return response.data;
            throw new Error((response.data && response.data.message) || 'Failed to reset password');
        } catch (error) {
            throw new Error(getMessage(error));
        }
    }

    async logout() {
        await AsyncStorage.multiRemove(['userToken', 'userEmail', 'username']);
    }

    async getToken() {
        return await AsyncStorage.getItem('userToken');
    }
}

export default new AuthService();
