import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import BackButton from './BackButton';

/**
 * Standard header: back + centered title + right slot (defaults to 40x40 spacer).
 */
const ScreenHeader = ({
  title,
  onBack,
  right = null,
  style,
  titleStyle,
  backButtonStyle,
  backIconStyle,
  backIconTint,
}) => (
  <View style={[styles.header, style]}>
    <BackButton
      onPress={onBack}
      style={backButtonStyle}
      iconStyle={backIconStyle}
      iconTint={backIconTint}
    />
    {typeof title === 'string' ? (
      <Text
        style={[styles.title, titleStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {title}
      </Text>
    ) : (
      title
    )}
    {right != null ? right : <View style={styles.headerSpacer} />}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
});

export default ScreenHeader;
