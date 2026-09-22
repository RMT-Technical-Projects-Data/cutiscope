// PinchToZoom.js - Updated and Working Version

import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Image,
  TouchableOpacity,
  Text
} from 'react-native';
import {
  PinchGestureHandler,
  GestureHandlerRootView,
  State
} from 'react-native-gesture-handler';
import {
  Camera,
  useCameraDevice,
  useCameraPermission
} from 'react-native-vision-camera';

const PinchToZoom = () => {
  const camera = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const [showCamera, setShowCamera] = useState(false);
  const [zoom, setZoom] = useState(1); // Start from 1x (normal zoom)
  const [baseZoom, setBaseZoom] = useState(1); // Base zoom for smooth transitions

  const MIN_ZOOM = 1; // minimum 1x (no zoom)
  const MAX_ZOOM = device?.maxZoom || 5; // Use device max zoom or default to 5x

  const handlePinch = (event) => {
    if (!device) return;

    const scale = event.nativeEvent.scale;
    
    // Calculate new zoom based on base zoom and current scale
    let newZoom = baseZoom * scale;
    
    // Clamp zoom between min and max
    newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM));
    
    setZoom(newZoom);
  };

  const handlePinchStateChange = (event) => {
    // When gesture ends, update base zoom for next gesture
    if (event.nativeEvent.state === State.END) {
      setBaseZoom(zoom);
    }
  };

  const toggleCamera = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        console.log('Camera permission denied');
        return;
      }
    }
    setShowCamera(!showCamera);
    setZoom(1); // reset zoom to 1x
    setBaseZoom(1); // reset base zoom
  };

  const captureImage = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto();
        console.log('Photo captured:', photo.path);
        // You can add your photo handling logic here
      } catch (error) {
        console.error('Failed to capture image:', error);
      }
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {showCamera ? (
        <View style={styles.cameraContainer}>
          {device && hasPermission ? (
            <>
              <PinchGestureHandler 
                onGestureEvent={handlePinch}
                onHandlerStateChange={handlePinchStateChange}
              >
                <View style={styles.cameraWrapper}>
                  <Camera
                    ref={camera}
                    style={styles.camera}
                    device={device}
                    isActive={showCamera}
                    photo={true}
                    zoom={zoom}
                  />
                </View>
              </PinchGestureHandler>

              <View style={styles.cameraControls}>
                <View style={styles.zoomIndicator}>
                  <Text style={styles.zoomText}>
                    Zoom: {zoom.toFixed(1)}x
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.captureButton}
                  onPress={captureImage}
                >
                  <View style={styles.captureButtonInner} />
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.closeButton}
                  onPress={toggleCamera}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.cameraPermissionContainer}>
              <Text style={styles.permissionText}>
                {!hasPermission
                  ? 'Camera permission required'
                  : 'No camera device found'}
              </Text>
              {!hasPermission && (
                <TouchableOpacity
                  style={styles.permissionButton}
                  onPress={requestPermission}
                >
                  <Text style={styles.permissionButtonText}>
                    Grant Permission
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.backButton}
                onPress={toggleCamera}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.previewContainer}
          onPress={toggleCamera}
          activeOpacity={0.7}
        >
          <View style={styles.placeholderCamera}>
            <Text style={styles.cameraIcon}>📷</Text>
          </View>
          <Text style={styles.tapText}>Tap to open camera</Text>
          <Text style={styles.pinchText}>Pinch with two fingers to zoom</Text>
          <Text style={styles.zoomRangeText}>
            Zoom range: {MIN_ZOOM}x - {MAX_ZOOM.toFixed(1)}x
          </Text>
        </TouchableOpacity>
      )}
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  previewContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  placeholderCamera: {
    width: 120,
    height: 120,
    backgroundColor: '#333',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30
  },
  cameraIcon: {
    fontSize: 50
  },
  tapText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 5
  },
  pinchText: {
    color: '#ccc',
    fontSize: 16,
    marginBottom: 5,
    textAlign: 'center'
  },
  zoomRangeText: {
    color: '#888',
    fontSize: 14,
    marginTop: 5
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000'
  },
  cameraWrapper: {
    flex: 1
  },
  camera: {
    flex: 1,
    width: '100%'
  },
  cameraControls: {
    position: 'absolute',
    bottom: 40,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 30
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff'
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000'
  },
  closeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold'
  },
  zoomIndicator: {
    position: 'absolute',
    top: -350,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20
  },
  zoomText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  },
  cameraPermissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20
  },
  permissionText: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 30
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 15
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  },
  backButton: {
    backgroundColor: '#333',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 10
  },
  backButtonText: {
    color: 'white',
    fontSize: 16
  }
});

export default PinchToZoom;