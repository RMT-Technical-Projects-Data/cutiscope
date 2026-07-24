import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';

/**
 * Primary / confirm action button.
 * variant: 'solid' (teal fill), 'outline' (dark fill + teal border), 'chip' (kiosk PIN teal)
 */
const PrimaryButton = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'solid',
  style,
  textStyle,
  activeOpacity = 0.8,
}) => (
  <TouchableOpacity
    style={[
      styles.base,
      variant === 'solid' && styles.solid,
      variant === 'outline' && styles.outline,
      variant === 'chip' && styles.chip,
      (disabled || loading) && styles.disabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={activeOpacity}
  >
    {loading ? (
      <ActivityIndicator color="#FFFFFF" size="small" />
    ) : (
      <Text
        style={[
          styles.text,
          variant === 'solid' && styles.solidText,
          variant === 'outline' && styles.outlineText,
          variant === 'chip' && styles.chipText,
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
  solid: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22B2A6',
  },
  solidText: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#FFFFFF',
  },
  outline: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a241a',
    borderWidth: 1,
    borderColor: '#22B2A6',
  },
  outlineText: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
  },
  chip: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22B2A6',
  },
  chipText: {
    color: '#fff',
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

export default PrimaryButton;
