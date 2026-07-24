import React, { useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import KioskTextInput from '../shared/ui/KioskTextInput';
import CustomKeyboard from '../shared/ui/CustomKeyboard';
import { CancelButton, PrimaryButton } from '../shared/ui';

/**
 * Kiosk developer PIN / options modal. Props-driven — App owns unlock orchestration.
 */
const DeveloperPinModal = ({
  visible,
  onClose,
  pinValue,
  pinError,
  onPinChange,
  onPinSubmit,
  pinInputRef,
  isDeveloperUnlocked,
  showSerialInput,
  serialValue,
  serialError,
  onSerialChange,
  onSaveSerial,
  onCancelSerial,
  onShowSerialInput,
  serialInputRef,
  currentSerialNumber,
  isKioskActive,
  onToggleKiosk,
}) => {
  // Autofocus serial number input when shown
  useEffect(() => {
    if (showSerialInput) {
      const t = setTimeout(() => {
        try {
          serialInputRef?.current?.focus?.();
        } catch (e) { }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [showSerialInput, serialInputRef]);

  // When kiosk PIN modal opens, auto-focus the input so CustomKeyboard shows.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        pinInputRef?.current?.focus?.();
      } catch (e) { }
    }, 80);
    return () => clearTimeout(t);
  }, [visible, pinInputRef]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.kioskPinOverlay}>
        <View style={styles.kioskPinContent}>
          <View style={styles.kioskPinBox}>
            {!isDeveloperUnlocked ? (
              <>
                <Text style={styles.kioskPinTitle}>Enter Developer Mode</Text>
                <Text style={styles.kioskPinSubtitle}>Enter PIN</Text>
                <KioskTextInput
                  ref={pinInputRef}
                  style={[styles.kioskPinInput, pinError ? styles.kioskPinInputError : null]}
                  value={pinValue}
                  onChangeText={onPinChange}
                  maxLength={4}
                  placeholder="••••"
                  placeholderTextColor="#666"
                  secureTextEntry
                  keyboardType="numeric"
                  hostKeyboardLocally
                />
                {pinError ? <Text style={styles.kioskPinErrorText}>{pinError}</Text> : null}
                <View style={styles.kioskPinButtons}>
                  <CancelButton
                    variant="dark"
                    title="Cancel"
                    onPress={onClose}
                    style={styles.kioskPinCancelBtn}
                    textStyle={styles.kioskPinCancelText}
                  />
                  <PrimaryButton
                    variant="chip"
                    title="Unlock"
                    onPress={onPinSubmit}
                    style={styles.kioskPinUnlockBtn}
                    textStyle={styles.kioskPinUnlockText}
                  />
                </View>
              </>
            ) : showSerialInput ? (
              <>
                <Text style={styles.kioskPinTitle}>Set Serial Number</Text>
                <Text style={styles.kioskPinSubtitle}>Enter device serial number</Text>
                <KioskTextInput
                  ref={serialInputRef}
                  style={[styles.kioskPinInput, serialError ? styles.kioskPinInputError : null]}
                  value={serialValue}
                  onChangeText={onSerialChange}
                  // placeholder="Serial Number"
                  placeholderTextColor="#666"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  hostKeyboardLocally
                />
                {serialError ? <Text style={styles.kioskPinErrorText}>{serialError}</Text> : null}
                <View style={styles.kioskPinButtons}>
                  <CancelButton
                    variant="dark"
                    title="Cancel"
                    onPress={onCancelSerial}
                    style={styles.kioskPinCancelBtn}
                    textStyle={styles.kioskPinCancelText}
                  />
                  <PrimaryButton
                    variant="chip"
                    title="Save"
                    onPress={onSaveSerial}
                    style={styles.kioskPinUnlockBtn}
                    textStyle={styles.kioskPinUnlockText}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.kioskPinTitle}>Developer Options</Text>
                <Text style={styles.kioskPinSubtitle}>
                  Serial Number: {currentSerialNumber || 'Not Set'}
                </Text>

                <TouchableOpacity
                  style={styles.devMenuOptionBtn}
                  onPress={onShowSerialInput}
                >
                  <Text style={styles.devMenuOptionText}>Set Serial Number</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.devMenuOptionBtn,
                    isKioskActive ? styles.devMenuKioskOnBtn : styles.devMenuKioskOffBtn
                  ]}
                  onPress={onToggleKiosk}
                >
                  <Text style={styles.devMenuOptionText}>
                    {isKioskActive ? 'Turn Kiosk Mode OFF' : 'Turn Kiosk Mode ON'}
                  </Text>
                </TouchableOpacity>

                {pinError ? <Text style={styles.kioskPinErrorText}>{pinError}</Text> : null}

                <View style={styles.kioskPinButtons}>
                  <CancelButton
                    variant="dark"
                    title="Close"
                    onPress={onClose}
                    style={styles.kioskPinCancelBtn}
                    textStyle={styles.kioskPinCancelText}
                  />
                </View>
              </>
            )}
          </View>
        </View>
        {/* Custom keyboard must be inside Modal on Android (Modal is separate window). */}
        <CustomKeyboard localHost />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  kioskPinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  kioskPinContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  kioskPinBox: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  kioskPinTitle: {
    fontSize: 20,
    fontFamily: 'ProductSans-Bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  kioskPinSubtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 16,
  },
  kioskPinInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  kioskPinInputError: {
    borderColor: '#d32f2f',
  },
  kioskPinErrorText: {
    fontSize: 13,
    color: '#ff5252',
    textAlign: 'center',
    marginBottom: 12,
  },
  kioskPinButtons: {
    flexDirection: 'row',
    marginTop: 8,
  },
  kioskPinCancelBtn: {
    flex: 1,
    marginRight: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  kioskPinCancelText: {
    color: '#aaa',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  kioskPinUnlockBtn: {
    flex: 1,
    marginLeft: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22B2A6',
    alignItems: 'center',
  },
  kioskPinUnlockText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  devMenuOptionBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    marginBottom: 12,
  },
  devMenuOptionText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
  devMenuKioskOnBtn: {
    borderColor: '#22B2A6',
    backgroundColor: '#1b3a36',
  },
  devMenuKioskOffBtn: {
    borderColor: '#ff5252',
    backgroundColor: '#3a1b1b',
  },
});

export default DeveloperPinModal;
