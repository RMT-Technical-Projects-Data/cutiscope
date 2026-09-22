import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Modal, FlatList, TouchableOpacity, StyleSheet, NativeModules } from 'react-native';
import timezones from '../Components/timezones.json';
import { DateTime } from 'luxon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

const TimezoneSelector = ({ visible, onClose }) => {
  const [selectedTimezone, setSelectedTimezone] = useState('');
  const [timezoneCategory, setTimezoneCategory] = useState(null);
  const [viewMode, setViewMode] = useState('categories');
  
  // Camera states
  const [showCamera, setShowCamera] = useState(false);
  const [cameraResult, setCameraResult] = useState('');
  const camera = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const loadTimezone = useCallback(async () => {
    try {
      const savedTimezone = await AsyncStorage.getItem('selectedTimezone');
      setSelectedTimezone(savedTimezone || '');
      console.log("selectedTimezone: " + savedTimezone);
    } catch (error) {
      console.error('Failed to load timezone from AsyncStorage:', error);
    }
  }, []);

  useEffect(() => {
    loadTimezone();
  }, [loadTimezone]);

  useEffect(() => {
    let interval;
    if (selectedTimezone) {
      interval = setInterval(() => {
        DateTime.now().setZone(selectedTimezone);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedTimezone]);

  const handleRegionSelect = (region) => {
    setTimezoneCategory(region);
    setViewMode('timezones');
  };

  const handleTimezoneSelect = async (timezone) => {
    setSelectedTimezone(timezone);
    try {
      await AsyncStorage.setItem('selectedTimezone', timezone);
      console.log("Set into AsyncStorage: " + timezone);

      // Call NativeModule to set timezone at system level using root
      const { SystemTimeModule } = NativeModules;
      if (SystemTimeModule && SystemTimeModule.setTimezone) {
        await SystemTimeModule.setTimezone(timezone);
        console.log("System timezone updated successfully.");
      }
    } catch (error) {
      console.error('Failed to save or set system timezone:', error);
    }
    setViewMode('categories');
    onClose();
  };

  // Camera functionality
  const toggleCamera = async () => {
    if (!hasPermission) {
      await requestPermission();
    }
    setShowCamera(!showCamera);
  };

  const captureImage = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto();
        setCameraResult('Image captured successfully!');
        console.log('Photo path:', photo.path);
      } catch (error) {
        console.error('Failed to capture image:', error);
        setCameraResult('Failed to capture image');
      }
    }
  };

  const renderCategoryList = () => (
    <FlatList
      data={Object.keys(timezones)}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.categoryButton}
          onPress={() => handleRegionSelect(item)}
        >
          <Text style={styles.categoryButtonText}>{item}</Text>
        </TouchableOpacity>
      )}
      keyExtractor={(item) => item}
    />
  );

  const renderTimezoneList = () => (
    <FlatList
      data={timezones[timezoneCategory]}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.timezoneButton}
          onPress={() => handleTimezoneSelect(item)}
        >
          <Text style={styles.timezoneButtonText}>{item}</Text>
        </TouchableOpacity>
      )}
      keyExtractor={(item) => item}
    />
  );

  const renderCameraView = () => (
    <View style={styles.cameraContainer}>
      <Text style={styles.cameraTitle}>Camera Vision</Text>
      
      {device && hasPermission ? (
        <>
          <Camera
            ref={camera}
            style={styles.camera}
            device={device}
            isActive={showCamera}
            photo={true}
          />
          <TouchableOpacity style={styles.captureButton} onPress={captureImage}>
            <Text style={styles.captureButtonText}>Capture Image</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.cameraPermissionText}>
          {hasPermission ? 'Camera not available' : 'Camera permission required'}
        </Text>
      )}
      
      {cameraResult ? (
        <Text style={styles.cameraResult}>{cameraResult}</Text>
      ) : null}
      
      <TouchableOpacity style={styles.cameraBackButton} onPress={toggleCamera}>
        <Text style={styles.doneButtonText}>Close Camera</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackground}>
        <View style={styles.modalContainer}>
          {/* Camera Toggle Button */}
          <TouchableOpacity onPress={toggleCamera} style={styles.cameraToggleButton}>
            <Text style={styles.cameraToggleButtonText}>
              {showCamera ? 'Hide Camera' : 'Show Camera'}
            </Text>
          </TouchableOpacity>

          {showCamera ? (
            renderCameraView()
          ) : (
            <>
              {viewMode === 'categories' ? (
                renderCategoryList()
              ) : (
                <>
                  <View style={styles.timezoneListContainer}>
                    <Text style={styles.selectedRegionText}>Select Region</Text>
                    {renderTimezoneList()}
                  </View>
                  <TouchableOpacity onPress={() => setViewMode('categories')} style={styles.navigationBackButton}>
                    <Text style={styles.doneButtonText}>Back</Text>
                  </TouchableOpacity>
                </>
              )}

              {viewMode === 'timezones' ? null : (
                <TouchableOpacity onPress={onClose} style={styles.doneButton}>
                  <Text style={styles.doneButtonText}>Close</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  modalContainer: {
    height: '65%',
    width: '50%',
    backgroundColor: '#1c1c1c',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  categoryButton: {
    padding: 10,
    paddingLeft: 0,
    textAlign: 'left',
  },
  categoryButtonText: {
    fontSize: 17,
    fontFamily: 'ProductSans-Bold',
    color: '#fff',
    textAlign: 'center',
  },
  timezoneButton: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    fontFamily: 'ProductSans-Regular',
  },
  timezoneButtonText: {
    color: 'white',
    fontFamily: 'ProductSans-Regular',
  },
  timezoneListContainer: {
    height: '87%',
  },
  selectedRegionText: {
    marginVertical: 10,
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: 'white',
  },
  selectedTimezoneText: {
    marginVertical: 10,
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  currentTimeText: {
    marginVertical: 10,
    fontSize: 16,
    color: 'white',
  },
  doneButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgb(153, 0, 0)',
    borderRadius: 10,
    position: 'absolute',
    bottom: 13,
  },
  doneButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontFamily: 'ProductSans-Regular',
  },
  navigationBackButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#005249',
    borderRadius: 10,
    position: 'absolute',
    bottom: 13,
    alignSelf: 'center',
  },
  // Camera Styles
  cameraToggleButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#2196F3',
    borderRadius: 10,
    marginBottom: 10,
  },
  cameraToggleButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTitle: {
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    color: 'white',
    marginBottom: 10,
  },
  camera: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    marginBottom: 10,
  },
  captureButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#FF5722',
    borderRadius: 10,
    marginBottom: 10,
  },
  captureButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
  },
  cameraPermissionText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 10,
  },
  cameraResult: {
    color: 'white',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  cameraBackButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#005249',
    borderRadius: 10,
  },
});

export default TimezoneSelector;