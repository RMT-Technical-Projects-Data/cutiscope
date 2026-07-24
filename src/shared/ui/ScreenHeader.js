import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import BackButton from './BackButton';

/**
 * Standard header: back + centered title + right slot (defaults to 40x40 spacer).
 * Title is absolutely centered so a wide right action (e.g. Select All) does not shift it.
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
    <View style={styles.sideSlot}>
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
        minimumFontScale={0.6}
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    marginBottom: 8,
    position: 'relative',
  },
  sideSlot: {
    zIndex: 2,
    minWidth: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideSlotRight: {
    alignItems: 'flex-end',
  },
  title: {
    position: 'absolute',
    left: 56,
    right: 56,
    color: '#FFFFFF',
    fontSize: 26,
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
