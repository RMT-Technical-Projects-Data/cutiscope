import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import BackButton from './BackButton';

/**
 * Standard header: back + centered title + right slot.
 * Equal side slots keep the title visually centered when Select All is shown.
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
    <View style={[styles.sideSlot, styles.sideSlotLeft]}>
      <BackButton
        onPress={onBack}
        style={backButtonStyle}
        iconStyle={backIconStyle}
        iconTint={backIconTint}
      />
    </View>
    {typeof title === 'string' ? (
      <Text
        style={[styles.title, titleStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
        pointerEvents="none"
      >
        {title}
      </Text>
    ) : (
      <View style={styles.title} pointerEvents="box-none">
        {title}
      </View>
    )}
    <View style={[styles.sideSlot, styles.sideSlotRight]}>
      {right != null ? right : <View style={styles.headerSpacer} />}
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    marginBottom: 8,
    position: 'relative',
    minHeight: 56,
  },
  sideSlot: {
    zIndex: 2,
    width: 96,
    minHeight: 40,
    justifyContent: 'center',
  },
  sideSlotLeft: {
    alignItems: 'flex-start',
  },
  sideSlotRight: {
    alignItems: 'flex-end',
  },
  title: {
    position: 'absolute',
    left: 104,
    right: 104,
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    textAlign: 'center',
    zIndex: 1,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
});

export default ScreenHeader;
