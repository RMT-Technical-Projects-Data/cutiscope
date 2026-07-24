import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const OrDivider = ({ label = 'OR', style, lineStyle, textStyle }) => (
  <View style={[styles.divider, style]}>
    <View style={[styles.dividerLine, lineStyle]} />
    <Text style={[styles.dividerText, textStyle]} selectable={false}>
      {label}
    </Text>
    <View style={[styles.dividerLine, lineStyle]} />
  </View>
);

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333333',
  },
  dividerText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    marginHorizontal: 12,
  },
});

export default OrDivider;
