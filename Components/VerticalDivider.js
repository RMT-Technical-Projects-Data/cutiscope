import React from 'react';
import { View, StyleSheet } from 'react-native';

const VerticalDivider = ({ height = 24, color = '#888' }) => (
  <View style={[styles.divider, { height, backgroundColor: color }]} />
);

const styles = StyleSheet.create({
  divider: {
    width: 1,
    marginHorizontal: 10,
  },
});

export default VerticalDivider;
