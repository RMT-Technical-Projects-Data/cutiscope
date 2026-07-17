import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CustomStatusBar from '../Components/CustomStatusBar';

const SessionTimeoutModal = ({
  visible,
  secondsRemaining,
  inactivityMinutes = 60,
  onStayLoggedIn,
  onLogout,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    statusBarTranslucent
    onRequestClose={onStayLoggedIn}
  >
    <View style={styles.overlay}>
      <CustomStatusBar />
      <View style={styles.card}>
        <Text style={styles.title}>Session Expiring</Text>
        <Text style={styles.message}>
          No activity for {inactivityMinutes} minutes. Stay logged in or you will be logged out.
        </Text>
        <Text style={styles.countdown}>{secondsRemaining}</Text>
        <Text style={styles.countdownLabel}>seconds remaining</Text>

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.stayButton} onPress={onStayLoggedIn}>
            <Text style={styles.stayText}>Stay Logged In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'ProductSans-Bold',
    marginBottom: 10,
  },
  message: {
    color: '#C7C7CC',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
    lineHeight: 22,
    textAlign: 'center',
  },
  countdown: {
    color: '#22B2A6',
    fontSize: 56,
    lineHeight: 66,
    fontFamily: 'ProductSans-Bold',
    marginTop: 14,
  },
  countdownLabel: {
    color: '#8E8E93',
    fontSize: 14,
    fontFamily: 'ProductSans-Regular',
    marginBottom: 24,
  },
  buttons: {
    width: '100%',
    flexDirection: 'row',
  },
  logoutButton: {
    flex: 1,
    marginRight: 6,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#2A1A1A',
    borderWidth: 1,
    borderColor: '#FF5252',
  },
  stayButton: {
    flex: 1,
    marginLeft: 6,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#19332F',
    borderWidth: 1,
    borderColor: '#22B2A6',
  },
  logoutText: {
    color: '#FF5252',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  stayText: {
    color: '#22B2A6',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
});

export default SessionTimeoutModal;
