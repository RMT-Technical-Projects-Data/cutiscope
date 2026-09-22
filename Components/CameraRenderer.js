import React from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { GestureDetector, PinchGestureHandler } from 'react-native-gesture-handler';
import { Camera } from 'react-native-vision-camera';
import Animated from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const CameraRenderer = ({
  cameraError,
  standby,
  device,
  hasPermission,
  requestPermission,
  cameraRef,
  zoomBtnValue,
  format,
  focusMode,
  focusDepthValue,
  focusPoint,
  tapGesture,
  onPinchEvent,
  onPinchStateChange,
  handleTap,
  styles
}) => {
  if (cameraError) {
    return (
      <TouchableOpacity
        style={{
          textAlign: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
        onPress={handleTap}>
        <Text style={{
          color: 'white',
          alignSelf: 'center',
          fontSize: 18,
          fontFamily: 'ProductSans-Regular',
        }}>{cameraError}</Text>
      </TouchableOpacity>
    );
  }

  if (standby) {
    return (
      <TouchableOpacity
        style={{
          textAlign: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
        onPress={handleTap}>
        <Text style={{
          color: 'white',
          alignSelf: 'center',
          fontSize: 18,
          fontFamily: 'ProductSans-Regular',
        }}>
          Camera is on standby. Tap to turn on
        </Text>
      </TouchableOpacity>
    );
  }

  if (!device) {
    return (
      <View style={{
        textAlign: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}>
        <Text style={{
          color: 'white',
          alignSelf: 'center',
          fontSize: 18,
          fontFamily: 'ProductSans-Regular',
        }}>
          Camera device not found
        </Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={{
        textAlign: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}>
        <Text style={{
          color: 'white',
          alignSelf: 'center',
          fontSize: 18,
          fontFamily: 'ProductSans-Regular',
        }}>
          Camera permission required
        </Text>
        <TouchableOpacity onPress={requestPermission}>
          <Text style={{ color: '#22B2A6', marginTop: 10 }}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <GestureDetector gesture={tapGesture}>
      <PinchGestureHandler
        onGestureEvent={onPinchEvent}
        onHandlerStateChange={onPinchStateChange}
        style={styles.cameraContainer}>
        <Animated.View style={styles.cameraWrapper}>
          <Camera
            ref={cameraRef}
            style={styles.preview}
            device={device}
            isActive={!standby}
            photo={true}
            zoom={zoomBtnValue}
            format={format}
            photoQualityBalance="speed"
            enableZoomGesture={true}
            focus={focusMode === 'auto' ? 'auto' : 'manual'}
            focusDepth={focusMode === 'manual' ? focusDepthValue : 0}
          />

          {focusPoint && focusMode === 'manual' && (
            <View
              style={[
                styles.focusIndicator,
                {
                  left: focusPoint.x * width - 25,
                  top: focusPoint.y * height - 25,
                },
              ]}
            />
          )}
        </Animated.View>
      </PinchGestureHandler>
    </GestureDetector>
  );
};

export default CameraRenderer;
