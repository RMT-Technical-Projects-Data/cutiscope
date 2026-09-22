import React from 'react';
import { View, TouchableOpacity, Image, Text, ScrollView } from 'react-native';
import {
  ZOOM_VALUES,
  EXPOSURE_VALUES,
  FOCUS_DEPTH_VALUES
} from '../utils/Constants';

const CameraControls = ({
  showSlider,
  showScale,
  showFocusScale,
  zoomBtnValue,
  exposureBtnValue,
  focusDepthValue,
  handleZoomPress,
  handleContrastPress,
  handleScroll,
  handleExposureScroll,
  handleFocusScroll,
  onScrollEnd,
  onExposureScrollEnd,
  onFocusScrollEnd,
  scrollViewRef,
  scrollExposureViewRef,
  focusScrollViewRef,
  mapZoomToDisplay,
  mapExposureToDisplay,
  styles
}) => {
  return (
    <>
      {showSlider && (
        <View style={styles.scaleContainer}>
          <ScrollView
            ref={scrollExposureViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={handleExposureScroll}
            scrollEventThrottle={16}
            snapToInterval={50}
            onMomentumScrollEnd={onExposureScrollEnd}
            contentContainerStyle={styles.scaleContentContainer}
          >
            {EXPOSURE_VALUES
              .filter((_, index) => index % 2 === 0)
              .map((value, index) => (
                <View key={index} style={styles.tick}>
                  <Text style={styles.tickText}>
                    {index % 1 === 0
                      ? `${mapExposureToDisplay(parseFloat(value))}`
                      : ''}
                  </Text>
                  <View style={styles.tickLine} />
                </View>
              ))}
          </ScrollView>
          <View style={[styles.centerLine]} />
        </View>
      )}

      {showScale && (
        <View style={styles.scaleContainer}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            snapToInterval={50}
            onMomentumScrollEnd={onScrollEnd}
            contentContainerStyle={styles.scaleContentContainer}
          >
            {ZOOM_VALUES.map((value, index) => (
              <View key={index} style={styles.tick}>
                <Text style={styles.tickText}>
                  {index % 2 === 0
                    ? `${mapZoomToDisplay(parseFloat(value))}x`
                    : ''}
                </Text>
                <View style={styles.tickLine} />
              </View>
            ))}
          </ScrollView>
          <View style={[styles.centerLine]} />
        </View>
      )}

      {showFocusScale && (
        <View style={styles.scaleContainer}>
          <ScrollView
            ref={focusScrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={handleFocusScroll}
            scrollEventThrottle={12}
            snapToInterval={50}
            onMomentumScrollEnd={onFocusScrollEnd}
            contentContainerStyle={styles.scaleFocusContentContainer}>
            {FOCUS_DEPTH_VALUES
              .filter((_, index) => index % 2 === 0)
              .map((value, index) => (
                <View key={index} style={styles.tick}>
                  <Text style={styles.tickFocusText}>
                    {index % 1 === 0 ? value : ' '}
                  </Text>
                  {index % 1 === 0 && (
                    <View
                      style={[
                        styles.tickLine,
                        focusDepthValue === parseFloat(value)
                          ? styles.activeTick
                          : {},
                      ]}
                    />
                  )}
                </View>
              ))}
          </ScrollView>
          <View style={styles.centerLine} />
        </View>
      )}
    </>
  );
};

export default CameraControls;
