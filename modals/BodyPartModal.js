import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import KioskTextInput from '../Components/KioskTextInput';
import CustomKeyboard from '../Components/CustomKeyboard';
import { useCustomKeyboard } from '../context/CustomKeyboardContext';
import CustomStatusBar from '../Components/CustomStatusBar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 24;

const BodyPartModal = ({ visible, onClose, onSave, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);
  const { dismissKeyboard } = useCustomKeyboard();

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [visible, initialValue]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        inputRef.current?.focus?.();
      } catch (e) {}
    }, 80);
    return () => clearTimeout(t);
  }, [visible]);

  const handleClose = () => {
    dismissKeyboard();
    onClose();
  };

  const handleSave = () => {
    dismissKeyboard();
    onSave(value.trim());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <CustomStatusBar />
        <View style={[styles.contentArea, styles.contentAreaCentered]}>
          <View style={styles.modalView}>
            <Text style={styles.title}>Enter Body Part</Text>
            <KioskTextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder="e.g. Left Arm, Back"
              placeholderTextColor="#666"
              autoCapitalize="words"
              autoCorrect={false}
              contextMenuHidden
              selectTextOnFocus={false}
              showDismiss
              hostKeyboardLocally
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <CustomKeyboard localHost />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  contentArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: H_PAD,
  },
  contentAreaCentered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    width: SCREEN_WIDTH * 0.92,
    maxWidth: 400,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: H_PAD,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
    height: 52,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    padding: 10,
  },
  cancelText: {
    color: '#22B2A6',
    fontSize: 16,
    fontFamily: 'ProductSans-Regular',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#22B2A6',
    borderRadius: 8,
  },
  saveText: {
    color: '#000',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
});

export default BodyPartModal;
