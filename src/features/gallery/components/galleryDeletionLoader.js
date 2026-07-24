import React from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { ACCENT_TEAL } from '../utils/galleryPathUtils';

const DeletionLoader = ({ visible }) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    statusBarTranslucent
    onRequestClose={() => {}}
  >
    <View
      style={{
        flex: 1,
        marginTop: 10,
        backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <ActivityIndicator size="large" color={ACCENT_TEAL} />
      <Text
        style={{
          color: ACCENT_TEAL,
          fontSize: 18,
          marginTop: 20,
          fontWeight: 'bold',
          textAlign: 'center',
        }}
      >
        Deleting... Please wait.
      </Text>
    </View>
  </Modal>
);

export default DeletionLoader;
