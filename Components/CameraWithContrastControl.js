import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import VerticalSlider from 'rn-vertical-slider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const CameraWithContrastControl = () => {
  const [exposure, setExposure] = useState(0);
  const [showSlider, setShowSlider] = useState(false); // Toggle state for slider visibility
  const cameraRef = useRef(null);
  const device = useCameraDevice('back');

  useEffect(() => {
    // Request camera permission on component mount
    const requestPermission = async () => {
      const cameraPermission = await Camera.requestCameraPermission();
      if (cameraPermission !== 'authorized') {
        console.warn('Camera permission not granted');
      }
    };
    requestPermission();
  }, []);

  if (device == null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Camera device not found</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Camera
        ref={cameraRef}
        style={{ flex: 1 }}
        device={device}
        isActive={true}
        photo={true}
        exposure={exposure / 100} // Convert exposure value to appropriate range if needed
      />

      <TouchableOpacity
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          backgroundColor: '#2979FF',
          padding: 10,
          borderRadius: 5,
        }}
        onPress={() => setShowSlider(!showSlider)}
      >
        <Text style={{ color: '#fff' }}>Adjust Exposure</Text>
      </TouchableOpacity>

      {showSlider && (
        <View style={{ position: 'absolute', bottom: 70, right: 20 }}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <VerticalSlider
              value={exposure}
              onChange={(value) => setExposure(value)}
              height={200}
              width={40}
              step={1}
              min={0}
              max={100}
              borderRadius={5}
              minimumTrackTintColor="#2979FF"
              maximumTrackTintColor="#D1D1D6"
              showIndicator
              renderIndicator={() => (
                <View
                  style={{
                    height: 40,
                    width: 80,
                    backgroundColor: '#2979FF',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff' }}>{exposure}</Text>
                </View>
              )}
              containerStyle={{ backgroundColor: '#e0e0e0', borderRadius: 10 }}
              sliderStyle={{ backgroundColor: '#fff', borderRadius: 5 }}
            />
          </View>
        </View>
      )}
    </GestureHandlerRootView>
  );
};

export default CameraWithContrastControl;