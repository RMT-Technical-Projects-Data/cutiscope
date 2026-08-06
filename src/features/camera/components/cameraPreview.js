import React from "react";
import { ActivityIndicator, Animated, Text, TouchableOpacity, View, InteractionManager } from "react-native";
import Reanimated from "react-native-reanimated";
import { Camera } from "react-native-vision-camera";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { ZoomRuler } from "../cameraZoomRuler";
import MillimeterScale from "./millimeterScale";
import { styles } from "../styles/cameraScreenStyles";

const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);

const CameraPreview = (props) => {
  const { cameraError,handleTap,device,hasPermission,requestPermission,panResponder,pinchGesture,previewTouchableRef,handleCameraTouch,setViewDimensions,previewLayoutInWindowRef,cameraRef,isScreenFocused,wifiMenuVisible,isStandby,animatedCameraProps,format,isFlashOn,showSlider,focusDepthValue,resumingFromLockRef,setCameraError,isTransientCameraError,zoom,minZoom,maxZoom,setZoomBtnValue,zoomBtnValue,showFocusStatus,showFocusIndicator,focusPoint,focusAnimation } = props;
    if (cameraError) {
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>{cameraError}</Text>
          <TouchableOpacity
            style={styles.statusButton}
            onPress={handleTap}
          >
            <Text style={styles.statusButtonText}>Wake Up</Text>
          </TouchableOpacity>
        </View>
      );
    }



    if (!device) {
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Camera Not Ready</Text>
          <Text style={styles.statusSubText}>Camera device not found or still initializing...</Text>
          <ActivityIndicator size="large" color="#22B2A6" style={{ marginTop: 20 }} />
        </View>
      );
    }

    if (!hasPermission) {
      const handleGrantPermission = () => {
        InteractionManager.runAfterInteractions(() => {
          requestPermission().catch((e) => console.warn('Camera permission request error:', e));
        });
      };
      return (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>Permission Required</Text>
          <Text style={styles.statusSubText}>We need camera access to capture images</Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={handleGrantPermission}
            activeOpacity={0.85}
            delayPressIn={0}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <GestureHandlerRootView style={styles.cameraContainer}>
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
          <GestureDetector gesture={pinchGesture}>
            <View style={styles.cameraWrapper}>
              <TouchableOpacity
                ref={previewTouchableRef}
                style={styles.previewTouchable}
                activeOpacity={1}
                onPress={handleCameraTouch}
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setViewDimensions({ width, height });

                  // Capture the preview's on-screen position for accurate tap-to-focus mapping.
                  // This is important when the preview does not start at y=0 (e.g., paddingTop)
                  // or when other absolute-positioned UI overlaps the preview.
                  requestAnimationFrame(() => {
                    previewTouchableRef.current?.measureInWindow?.((x, y, w, h) => {
                      previewLayoutInWindowRef.current = { x, y, width: w, height: h };
                    });
                  });
                }}
              >
                <ReanimatedCamera
                  ref={cameraRef}
                  style={styles.preview}
                  device={device}
                  isActive={
                    isScreenFocused
                    && !isStandby
                  }
                  photo={true}
                  animatedProps={animatedCameraProps}
                  format={format}
                  torch={isFlashOn ? 'on' : 'off'} // FLASHLIGHT CONTROL
                  photoQualityBalance="quality"
                  enableZoomGesture={false}
                  enableFpsGraph={false}
                  // Lock photo orientation to the portrait-locked preview so a tilted
                  // phone cannot write landscape-left/right EXIF that flips the shot.
                  // (VisionCamera v4 default is "device", which ignores the UI lock.)
                  outputOrientation="preview"
                  // Add explicit focus prop check. 
                  // If showSlider is true (Manual Focus Mode), pass the focus value.
                  // Otherwise, it defaults to auto-focus (or whatever tap-to-focus set).
                  {...(showSlider ? { focus: focusDepthValue } : {})}

                  onInitialized={() => {
                    console.log(`[WakeUpDebug] [${Date.now()}] ReanimatedCamera onInitialized triggered. Flash state: ${isFlashOn ? 'ON' : 'OFF'}`);
                    console.log('📱 Camera initialized, flash state:', isFlashOn ? 'ON' : 'OFF');
                    resumingFromLockRef.current = false;
                    setCameraError(null);
                  }}
                  onError={(error) => {
                    console.log(`[WakeUpDebug] [${Date.now()}] ReanimatedCamera onError triggered. Error:`, error);
                    if (resumingFromLockRef.current || isTransientCameraError(error)) {
                      console.log('Ignoring transient camera error during lock/unlock:', error);
                      return;
                    }
                    console.error('Camera Error:', error);
                    setCameraError('Tap On the Button to Use Camera');
                  }}
                />

                {/* Overlay Zoom Ruler (Interactive on Zoom) */}
                <View
                  style={{ position: 'absolute', bottom: 18, width: '100%', alignItems: 'center', zIndex: 110 }}
                >
                  <ZoomRuler
                    zoom={zoom}
                    minZoom={minZoom}
                    maxZoom={maxZoom}
                    onZoomChange={setZoomBtnValue}
                    disabled={!!cameraError}
                  />
                </View>

                {/* Millimeter Scale Overlay */}
                <MillimeterScale zoom={zoomBtnValue} />


                {showFocusStatus && (
                  <View style={styles.focusStatusContainer}>
                    <Text style={styles.focusStatusText}>Focus Set</Text>
                  </View>
                )}

                {showFocusIndicator && focusPoint && (
                  <Animated.View
                    style={[
                      styles.focusIndicator,
                      {
                        left: focusPoint.x - 60,
                        top: focusPoint.y - 60,
                        opacity: focusAnimation,
                        transform: [
                          {
                            scale: focusAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.8, 1.1]
                            })
                          }
                        ]
                      },
                    ]}
                  >
                    <View style={styles.focusOuterRing} />
                    <View style={styles.focusInnerCrosshair} />
                    <View style={styles.focusCorners}>
                      <View style={[styles.focusCorner, styles.cornerTL]} />
                      <View style={[styles.focusCorner, styles.cornerTR]} />
                      <View style={[styles.focusCorner, styles.cornerBL]} />
                      <View style={[styles.focusCorner, styles.cornerBR]} />
                    </View>
                  </Animated.View>
                )}
              </TouchableOpacity>
            </View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    );
};

export default CameraPreview;
