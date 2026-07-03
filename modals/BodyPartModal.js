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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const H_PAD = 24;
const BODY_PART_MAX_LENGTH = 20;
const BODY_PART_VALID = /^[a-zA-Z\s]+$/;
// Reserve space for the in-app keyboard so the form sits above it on open.
const MODAL_BOTTOM_OFFSET = Math.min(300, Math.round(SCREEN_HEIGHT * 0.34));

function sanitizeBodyPart(text) {
  return String(text).replace(/[^a-zA-Z\s]/g, '').slice(0, BODY_PART_MAX_LENGTH);
}

function isBodyPartReady(value) {
  const trimmed = (value || '').trim();
  return (
    trimmed.length > 0 &&
    BODY_PART_VALID.test(trimmed) &&
    /[a-zA-Z]/.test(trimmed)
  );
}

const BodyPartModal = ({ visible, onClose, onSave, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);
  const { dismissKeyboard } = useCustomKeyboard();

  useEffect(() => {
    if (visible) {
      setValue(sanitizeBodyPart(initialValue));
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
    const trimmed = sanitizeBodyPart(value).trim();
    if (!isBodyPartReady(trimmed)) return;
    dismissKeyboard();
    onSave(trimmed);
    onClose();
  };

  const canSave = isBodyPartReady(value);

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
        <View style={styles.modalLayer}>
          <View style={styles.modalView}>
            <Text style={styles.title}>Enter Body Part</Text>
            <KioskTextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={(text) => setValue(sanitizeBodyPart(text))}
              placeholder="e.g. Left Arm, Back"
              placeholderTextColor="#666"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={BODY_PART_MAX_LENGTH}
              contextMenuHidden
              selectTextOnFocus={false}
              showDismiss
              hostKeyboardLocally
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
              >
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View style={styles.keyboardLayer} pointerEvents="box-none">
          <CustomKeyboard localHost />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  modalLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: H_PAD,
    paddingBottom: MODAL_BOTTOM_OFFSET,
  },
  keyboardLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    marginTop: 8,
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
  saveBtnDisabled: {
    backgroundColor: '#444',
    opacity: 0.8,
  },
  saveText: {
    color: '#000',
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
  },
});

export default BodyPartModal;
