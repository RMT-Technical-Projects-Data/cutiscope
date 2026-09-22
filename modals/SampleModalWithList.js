import React, { useState, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, FlatList, StyleSheet, Alert } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

const SampleModalWithList = () => {
  const [modalVisible, setModalVisible] = useState(false);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  
  // Camera states
  const camera = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Sample data for the list
  const sampleData = [
    { id: '1', title: 'Network 1', signalStrength: 'Excellent', security: 'Secured' },
    { id: '2', title: 'Network 2', signalStrength: 'Good', security: 'Open' },
    { id: '3', title: 'Network 3', signalStrength: 'Fair', security: 'Secured' },
    { id: '4', title: 'Network 4', signalStrength: 'Poor', security: 'Open' },
    { id: '5', title: 'Network 5', signalStrength: 'Excellent', security: 'Secured' },
    { id: '6', title: 'Network 6', signalStrength: 'Good', security: 'Open' },
    { id: '7', title: 'Network 7', signalStrength: 'Fair', security: 'Secured' },
    { id: '8', title: 'Network 8', signalStrength: 'Poor', security: 'Open' },
    { id: '9', title: 'Network 9', signalStrength: 'Excellent', security: 'Secured' },
    { id: '10', title: 'Network 10', signalStrength: 'Good', security: 'Open' },
    { id: '11', title: 'Network 11', signalStrength: 'Fair', security: 'Secured' },
    { id: '12', title: 'Network 12', signalStrength: 'Poor', security: 'Open' },
    { id: '13', title: 'Network 13', signalStrength: 'Excellent', security: 'Secured' },
    { id: '14', title: 'Network 14', signalStrength: 'Good', security: 'Open' },
    { id: '15', title: 'Network 15', signalStrength: 'Fair', security: 'Secured' },
    { id: '16', title: 'Network 16', signalStrength: 'Poor', security: 'Open' },
    { id: '17', title: 'Network 17', signalStrength: 'Excellent', security: 'Secured' },
    { id: '18', title: 'Network 18', signalStrength: 'Good', security: 'Open' },
    { id: '19', title: 'Network 19', signalStrength: 'Fair', security: 'Secured' },
    { id: '20', title: 'Network 20', signalStrength: 'Poor', security: 'Open' },
  ];

  const handleItemPress = (item) => {
    Alert.alert('Item Pressed', `You pressed ${item.title}`);
  };

  const handleOpenCamera = async () => {
    if (!hasPermission) {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) {
        Alert.alert('Camera permission required', 'Please grant camera permission to use the camera');
        return;
      }
    }
    setCameraModalVisible(true);
  };

  const handleCameraClose = () => {
    setCameraModalVisible(false);
  };

  const captureImage = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto();
        Alert.alert('Image Captured', `Photo saved at: ${photo.path}`);
        console.log('Photo captured:', photo.path);
        // You can add your computer vision processing here
      } catch (error) {
        console.error('Failed to capture image:', error);
        Alert.alert('Error', 'Failed to capture image');
      }
    }
  };

  // Camera Modal Component
  const CameraModal = () => (
    <Modal
      visible={cameraModalVisible}
      animationType="slide"
      onRequestClose={handleCameraClose}
    >
      <View style={styles.cameraContainer}>
        <TouchableOpacity style={styles.cameraBackButton} onPress={handleCameraClose}>
          <Text style={styles.cameraBackButtonText}>← Back</Text>
        </TouchableOpacity>
        
        {device && hasPermission ? (
          <>
            <Camera
              ref={camera}
              style={styles.camera}
              device={device}
              isActive={cameraModalVisible}
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
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.openButton}
        onPress={() => setModalVisible(true)}
      >
        <Text style={styles.buttonText}>Open Modal</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cameraButton}
        onPress={handleOpenCamera}
      >
        <Text style={styles.buttonText}>Open Camera</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <ScrollView>
              <FlatList
                data={sampleData}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.listItem}
                    onPress={() => handleItemPress(item)}
                  >
                    <Text style={styles.listItemText}>{item.title}</Text>
                    <Text style={styles.listItemDetail}>
                      Signal Strength: {item.signalStrength}
                    </Text>
                    <Text style={styles.listItemDetail}>
                      Security: {item.security}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </ScrollView>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.buttonText}>Close Modal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Camera Modal */}
      <CameraModal />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  openButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  cameraButton: {
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  listItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    alignItems: 'flex-start',
  },
  listItemText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  listItemDetail: {
    fontSize: 14,
    color: '#555',
  },
  closeButton: {
    marginTop: 20,
    backgroundColor: '#FF6347',
    padding: 10,
    borderRadius: 5,
  },
  // Camera Styles
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBackButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 5,
  },
  cameraBackButtonText: {
    color: 'white',
    fontSize: 16,
  },
  camera: {
    width: '90%',
    height: '60%',
    borderRadius: 10,
    marginBottom: 20,
  },
  captureButton: {
    paddingVertical: 15,
    paddingHorizontal: 30,
    backgroundColor: '#2196F3',
    borderRadius: 10,
  },
  captureButtonText: {
    color: '#ffffff',
    fontSize: 18,
  },
  cameraPermissionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
  },
});

export default SampleModalWithList;