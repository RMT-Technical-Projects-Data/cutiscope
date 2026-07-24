import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

const ACCENT_TEAL = '#22B2A6';
const PRIMARY_BACKGROUND = '#000000';

const UploadAnimation = ({ progress, total }) => {
  let message;
  if (total <= 1) {
    message = 'Uploading Image...';
  } else {
    message = `Uploading Images... (${progress} out of ${total})`;
  }
  return (
    <View style={styles.uploadContainer}>
      <ActivityIndicator size="large" color={ACCENT_TEAL} />
      <Text style={styles.uploadText}>{message}</Text>
      {total > 1 && (
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.round((progress / total) * 100)}%` }
            ]}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  uploadContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PRIMARY_BACKGROUND,
  },
  uploadText: {
    color: ACCENT_TEAL,
    fontSize: 18,
    marginTop: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  progressBarBackground: {
    width: '70%',
    height: 8,
    backgroundColor: '#333333',
    borderRadius: 4,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: ACCENT_TEAL,
    borderRadius: 4,
  },
});

export default UploadAnimation;
