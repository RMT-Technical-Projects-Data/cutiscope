import React, { useState, useEffect, useRef } from 'react';
import { View, Text, DeviceEventEmitter, StyleSheet, Animated } from 'react-native';
import { IN_APP_TOAST_EVENT } from '../shared/utils/inAppToast';

const positionToContainerStyle = (position) => {
  // Capture status must stay above the 150px camera control bar.
  if (position === 'aboveCapture') {
    return { top: undefined, bottom: 170, justifyContent: 'flex-end' };
  }
  // Other notifications retain the native Android-style bottom position.
  return { top: undefined, bottom: 80, justifyContent: 'flex-end' };
};

const InAppToastHost = () => {
  const [toast, setToast] = useState(null); // { message, durationMs, position }
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(IN_APP_TOAST_EVENT, (payload) => {
      const next = {
        message: payload?.message ?? '',
        durationMs: payload?.durationMs ?? 1400,
        position: payload?.position ?? 'bottom',
      };

      setToast(next);

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      opacity.stopAnimation();
      translateY.stopAnimation();
      opacity.setValue(0);
      translateY.setValue(6);

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]).start();

      hideTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 6, duration: 180, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setToast(null);
        });
      }, Math.max(600, Number(next.durationMs) || 1400));
    });

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      sub.remove();
    };
  }, [opacity, translateY]);

  if (!toast) return null;

  const containerPos = positionToContainerStyle(toast.position);

  return (
    <View pointerEvents="none" style={[toastStyles.container, containerPos]}>
      <Animated.View style={[toastStyles.toast, { opacity, transform: [{ translateY }] }]}>
        <Text style={toastStyles.text}>{toast.message}</Text>
      </Animated.View>
    </View>
  );
};

const toastStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    maxWidth: 360,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: 'ProductSans-Regular',
  },
});

export default InAppToastHost;
