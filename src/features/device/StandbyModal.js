import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const StandbyModal = ({ visible, onActivate }) => {
  if (!visible) {
    return null;
  }

  // Use only the App-level CustomStatusBar (do not embed or suppress it).
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons name="camera-off" size={80} color="#666" />
        </View>

        <Text style={styles.title}>Camera Standby</Text>
        <Text style={styles.subtitle}>
          The camera is on Standby position.
        </Text>

        <TouchableOpacity
          style={styles.activateButton}
          onPress={onActivate}
          activeOpacity={0.7}
        >
          <Text style={styles.activateText}>Activate Camera</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9500,
    elevation: 9500,
  },
  content: {
    width: '85%',
    alignItems: 'center',
    padding: 30,
    borderRadius: 20,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
  },
  iconContainer: {
    marginBottom: 20,
    padding: 20,
    borderRadius: 50,
    backgroundColor: '#1a1a1a',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#AAA',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 22,
  },
  activateButton: {
    flexDirection: 'row',
    backgroundColor: '#22B2A6',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  activateText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
});

export default StandbyModal;
