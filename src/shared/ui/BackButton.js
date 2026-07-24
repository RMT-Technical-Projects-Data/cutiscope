import React from 'react';
import { TouchableOpacity, Image, StyleSheet } from 'react-native';

const backIcon = require('../../../assets/icon_back.png');

/**
 * Shared kiosk back chip used across Gallery, Settings, WiFi, Bluetooth, etc.
 */
const BackButton = ({ onPress, style, iconStyle, iconTint = '#FFFFFF', activeOpacity = 0.7, hitSlop }) => (
  <TouchableOpacity
    style={[styles.backButton, style]}
    onPress={onPress}
    activeOpacity={activeOpacity}
    hitSlop={hitSlop}
  >
    <Image source={backIcon} style={[styles.backButtonIcon, iconTint ? { tintColor: iconTint } : null, iconStyle]} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  backButton: {
    height: 40,
    width: 40,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
  },
  backButtonIcon: {
    height: 22,
    width: 22,
    tintColor: '#FFFFFF',
  },
});

export default BackButton;
