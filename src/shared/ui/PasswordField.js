import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

/**
 * Password input wrapper with Show/Hide toggle.
 * Pass the input (e.g. KioskTextInput) as children; this only owns the toggle chrome.
 *
 * toggleVariant: 'inside' (Welcome-style overlay) | 'eye' (WiFi-style beside field)
 */
const PasswordField = ({
  children,
  showPassword,
  onToggleShow,
  toggleVariant = 'inside',
  style,
  toggleStyle,
  toggleTextStyle,
  showLabel = 'Show',
  hideLabel = 'Hide',
}) => (
  <View style={[styles.wrapper, style]}>
    {children}
    <TouchableOpacity
      style={[
        toggleVariant === 'inside' ? styles.toggleInside : styles.toggleEye,
        toggleStyle,
      ]}
      onPress={onToggleShow}
    >
      <Text
        style={[
          toggleVariant === 'inside' ? styles.toggleInsideText : styles.toggleEyeText,
          toggleTextStyle,
        ]}
        selectable={false}
      >
        {showPassword ? hideLabel : showLabel}
      </Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: '100%',
  },
  toggleInside: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  toggleInsideText: {
    color: '#22B2A6',
    fontSize: 14,
    fontFamily: 'ProductSans-Bold',
  },
  toggleEye: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  toggleEyeText: {
    color: '#22B2A6',
    fontFamily: 'ProductSans-Bold',
  },
});

export default PasswordField;
