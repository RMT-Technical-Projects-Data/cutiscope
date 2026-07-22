import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import authService from '../services/authService';
import { deleteGuestPhotos } from '../utils/guestPhotos';

const LAST_SESSION_WAS_GUEST_KEY = 'last_session_was_guest';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(true);

  useEffect(() => {
    // Load user data from AsyncStorage on mount
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const username = await AsyncStorage.getItem('username');
      const userEmail = await AsyncStorage.getItem('userEmail');
      const name = (username && username.trim()) || (userEmail && userEmail.trim()) || '';
      if (token && token.trim() && name) {
        setUserData({ username: name, token, id: await AsyncStorage.getItem('userId') });
        setIsGuest(false);
        await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'false');
      } else {
        setUserData(null);
        setIsGuest(true);
        const lastWasGuest = await AsyncStorage.getItem(LAST_SESSION_WAS_GUEST_KEY);
        if (lastWasGuest === 'true') {
          await deleteGuestPhotos();
          await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'false');
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      setUserData(null);
      setIsGuest(true);
    } finally {
      setIsLoading(false);
    }
  };

  /** Call after successful email/password login. Updates context so user is not in guest mode. */
  const login = async (token, user) => {
    try {
      const name = (user && (user.username || user.email)) || '';
      if (!token || !token.trim()) {
        console.warn('AuthContext login: missing token');
        return;
      }
      if (!name) {
        console.warn('AuthContext login: missing username/email');
        return;
      }
      // Clear any previously selected patient/box when a new user logs in
      await AsyncStorage.removeItem('@patient_box');
      await AsyncStorage.setItem('userToken', token.trim());
      await AsyncStorage.setItem('username', name);
      await AsyncStorage.setItem('userEmail', (user && user.email) || name);
      if (user && user.id != null)       await AsyncStorage.setItem('userId', String(user.id));
      setUserData({ username: name, token: token.trim(), id: user?.id });
      setIsGuest(false);
      await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'false');
    } catch (e) {
      console.error('AuthContext login:', e);
      throw e;
    }
  };

  /** Switch to guest mode: clear stored user and set isGuest true. */
  const guestLogin = async () => {
    try {
      await authService.logout();
      // Clear any selected patient/box when switching to guest
      await AsyncStorage.removeItem('@patient_box');
      await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'true');
      setUserData(null);
      setIsGuest(true);
    } catch (e) {
      console.error('AuthContext guestLogin:', e);
      await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'true').catch(() => {});
      setUserData(null);
      setIsGuest(true);
    }
  };

  const getUsername = () => {
    if (userData && userData.username) {
      return userData.username;
    }
    return 'Guest';
  };

  const signOut = async () => {
    try {
      await authService.logout();
      // Clear any selected patient/box on sign-out
      await AsyncStorage.removeItem('@patient_box');
      setUserData(null);
      // Logged out is not guest mode; guestLogin() is the explicit guest path.
      setIsGuest(false);
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  /** Explicitly cleanup guest mode: delete photos and reset guest flag. */
  const exitGuestMode = async () => {
    try {
      console.log('AuthContext: Exiting Guest Mode - performing cleanup');
      await deleteGuestPhotos();
      await AsyncStorage.setItem(LAST_SESSION_WAS_GUEST_KEY, 'false');
      setUserData(null);
      setIsGuest(false);
    } catch (e) {
      console.error('AuthContext exitGuestMode:', e);
      setUserData(null);
      setIsGuest(false);
    }
  };

  const value = {
    userData,
    isGuest,
    isLoading,
    getUsername,
    loadUserData,
    login,
    guestLogin,
    signOut,
    exitGuestMode,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

