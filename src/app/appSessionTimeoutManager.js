import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DeviceEventEmitter, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../features/auth/authSessionContext';
import firebaseAuthService from '../features/upload/firebaseAuthService';
import SessionTimeoutModal from '../features/device/SessionTimeoutModal';
import { SESSION_ACTIVITY_EVENT, SESSION_IDLE_HOLD_EVENT, emitSessionForceLogout } from '../shared/utils/inAppToast';
import { monotonicNow } from '../shared/utils/monotonicClock';
import { resetToWelcomeScreen } from './rootNavigation';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_CHANGED_EVENT,
  SESSION_TIMEOUT_OPTIONS,
  getSessionTimeoutMinutes,
} from '../features/settings/sessionTimeoutSettings';

const SESSION_LOGOUT_COUNTDOWN_SECONDS = 10;
const SESSION_WARNING_MS = SESSION_LOGOUT_COUNTDOWN_SECONDS * 1000;

const SessionManager = ({ active, navigationRef, onLoggedOut }) => {
  const { signOut, userData } = useAuth();
  const sessionActive = active && !!userData;
  const [promptVisible, setPromptVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(SESSION_LOGOUT_COUNTDOWN_SECONDS);
  const [inactivityMinutes, setInactivityMinutes] = useState(DEFAULT_SESSION_TIMEOUT_MINUTES);
  const inactivityDeadlineRef = useRef(0);
  const logoutDeadlineRef = useRef(0);
  const promptVisibleRef = useRef(false);
  const logoutInProgressRef = useRef(false);
  const inactivityMsRef = useRef(DEFAULT_SESSION_TIMEOUT_MINUTES * 60 * 1000);
  const timerArmedRef = useRef(false);
  const idleHoldRef = useRef(false);
  const idleHoldRemainingMsRef = useRef(0);
  const appInactiveRef = useRef(false);

  const startFreshSessionWindow = useCallback(() => {
    promptVisibleRef.current = false;
    setPromptVisible(false);
    setSecondsRemaining(SESSION_LOGOUT_COUNTDOWN_SECONDS);
    logoutDeadlineRef.current = 0;
    // Idle countdown only runs while the user is not interacting.
    inactivityDeadlineRef.current = monotonicNow() + inactivityMsRef.current;
    timerArmedRef.current = true;
  }, []);

  const noteUserActivity = useCallback(() => {
    if (!sessionActive || logoutInProgressRef.current) return;
    // While the 10s warning is open, only "Stay Logged In" renews the session.
    if (promptVisibleRef.current) return;
    // Using the device → push the inactivity deadline forward (timer restarts).
    inactivityDeadlineRef.current = monotonicNow() + inactivityMsRef.current;
    timerArmedRef.current = true;
  }, [sessionActive]);

  const setIdleHold = useCallback((hold) => {
    if (!sessionActive) {
      idleHoldRef.current = false;
      return;
    }
    if (hold) {
      if (!idleHoldRef.current) {
        idleHoldRemainingMsRef.current = Math.max(
          0,
          inactivityDeadlineRef.current - monotonicNow()
        );
      }
      idleHoldRef.current = true;
      return;
    }
    if (idleHoldRef.current) {
      inactivityDeadlineRef.current =
        monotonicNow() + (idleHoldRemainingMsRef.current || inactivityMsRef.current);
      timerArmedRef.current = true;
    }
    idleHoldRef.current = false;
  }, [sessionActive]);

  const applyInactivityMinutes = useCallback((minutes) => {
    const next = SESSION_TIMEOUT_OPTIONS.includes(Number(minutes))
      ? Number(minutes)
      : DEFAULT_SESSION_TIMEOUT_MINUTES;
    setInactivityMinutes(next);
    inactivityMsRef.current = next * 60 * 1000;
    startFreshSessionWindow();
  }, [startFreshSessionWindow]);

  const performLogout = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    promptVisibleRef.current = false;
    setPromptVisible(false);

    // Close fullscreen / gallery overlays first.
    emitSessionForceLogout();

    // Let the RN Modal finish dismissing before remounting nav. Dismissing the
    // timeout Modal and tearing down Gallery in the same frame often leaves a
    // blank black Android window instead of Welcome.
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Flip app session flags → App swaps to logged-out NavigationContainer
    // (Welcome only; Camera/Gallery are unmounted).
    onLoggedOut();

    // Belt-and-suspenders once the logged-out tree is ready.
    setTimeout(() => resetToWelcomeScreen(), 50);
    setTimeout(() => resetToWelcomeScreen(), 200);

    try {
      await signOut();
      await AsyncStorage.multiRemove([
        'userId',
        '@patient_box',
        'userInfo',
        'accessToken',
        'refreshToken',
        'firebaseIdToken',
      ]);
      try {
        await firebaseAuthService.signOut();
      } catch (cloudError) {
        const msg = String(cloudError?.message || cloudError || '');
        if (!/no-current-user|No user currently signed in/i.test(msg)) {
          console.warn('Cloud sign-out during session expiry failed:', msg);
        }
      }
    } catch (error) {
      console.error('Session logout failed:', error);
      await AsyncStorage.multiRemove([
        'userToken',
        'userEmail',
        'username',
        'userId',
        '@patient_box',
      ]).catch(() => {});
    } finally {
      resetToWelcomeScreen();
      logoutInProgressRef.current = false;
    }
  }, [onLoggedOut, signOut]);

  const checkDeadlines = useCallback(() => {
    if (!sessionActive || logoutInProgressRef.current || !timerArmedRef.current) return;
    // Busy overlay / active use / system UI — do not fire inactivity.
    if (idleHoldRef.current || appInactiveRef.current) return;
    const now = monotonicNow();

    // Phase 2: 10s logout modal countdown (only after inactivity expired).
    if (promptVisibleRef.current) {
      const remaining = Math.max(0, Math.ceil((logoutDeadlineRef.current - now) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) performLogout();
      return;
    }

    // Phase 1: wait for Settings inactivity timer while the user is idle.
    if (now >= inactivityDeadlineRef.current) {
      promptVisibleRef.current = true;
      logoutDeadlineRef.current = now + SESSION_WARNING_MS;
      setSecondsRemaining(SESSION_LOGOUT_COUNTDOWN_SECONDS);
      setPromptVisible(true);
    }
  }, [performLogout, sessionActive]);

  useEffect(() => {
    if (sessionActive) {
      // Hold deadline until persisted inactivity minutes are loaded.
      inactivityDeadlineRef.current = Number.MAX_SAFE_INTEGER;
      timerArmedRef.current = false;
      idleHoldRef.current = false;
      let cancelled = false;
      getSessionTimeoutMinutes().then((minutes) => {
        if (cancelled) return;
        applyInactivityMinutes(minutes);
      });
      return () => {
        cancelled = true;
      };
    }

    promptVisibleRef.current = false;
    setPromptVisible(false);
    inactivityDeadlineRef.current = 0;
    logoutDeadlineRef.current = 0;
    timerArmedRef.current = false;
    idleHoldRef.current = false;
    return undefined;
  }, [applyInactivityMinutes, sessionActive]);

  useEffect(() => {
    if (!sessionActive) return undefined;

    const activitySub = DeviceEventEmitter.addListener(SESSION_ACTIVITY_EVENT, () => {
      noteUserActivity();
    });
    const holdSub = DeviceEventEmitter.addListener(SESSION_IDLE_HOLD_EVENT, (hold) => {
      setIdleHold(!!hold);
    });
    const timeoutChangedSub = DeviceEventEmitter.addListener(
      SESSION_TIMEOUT_CHANGED_EVENT,
      (minutes) => {
        applyInactivityMinutes(minutes);
      }
    );
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        appInactiveRef.current = false;
        // Returning to foreground counts as activity — restart idle window.
        noteUserActivity();
        checkDeadlines();
      } else {
        // System overlay / background: freeze idle so pairing waits do not force logout.
        appInactiveRef.current = true;
      }
    });
    const interval = setInterval(checkDeadlines, 250);

    return () => {
      activitySub.remove();
      holdSub.remove();
      timeoutChangedSub.remove();
      appStateSub.remove();
      clearInterval(interval);
    };
  }, [applyInactivityMinutes, checkDeadlines, noteUserActivity, sessionActive, setIdleHold]);

  return (
    <SessionTimeoutModal
      visible={sessionActive && promptVisible}
      secondsRemaining={secondsRemaining}
      inactivityMinutes={inactivityMinutes}
      onStayLoggedIn={startFreshSessionWindow}
      onLogout={performLogout}
    />
  );
};

export default SessionManager;
