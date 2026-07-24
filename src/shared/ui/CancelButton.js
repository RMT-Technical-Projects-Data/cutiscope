import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';

/**
 * Cancel / secondary action button.
 * variant: 'filled' (modal row), 'text' (teal text link), 'dark' (kiosk PIN gray chip)
 */
const CancelButton = ({
  title = 'Cancel',
  onPress,
  disabled = false,
  loading = false,
  variant = 'filled',
  style,
  textStyle,
  activeOpacity = 0.8,
}) => (
  <TouchableOpacity
    style={[
      styles.base,
      variant === 'filled' && styles.filled,
      variant === 'text' && styles.textVariant,
      variant === 'dark' && styles.dark,
      disabled && styles.disabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={activeOpacity}
  >
    {loading ? (
      <ActivityIndicator color="#AAAAAA" size="small" />
    ) : (
      <Text
        style={[
          styles.text,
          variant === 'filled' && styles.filledText,
          variant === 'text' && styles.textVariantText,
          variant === 'dark' && styles.darkText,
          textStyle,
        ]}
        selectable={false}
      >
        {title}
      </Text>
    )}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  filled: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#333333',
  },
  filledText: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
  },
  textVariant: {
    padding: 10,
  },
  textVariantText: {
    color: '#22B2A6',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
  },
  dark: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#333',
  },
  darkText: {
    color: '#aaa',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
  },
});

export default CancelButton;
