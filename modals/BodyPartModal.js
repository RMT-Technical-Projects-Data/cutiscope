import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

const BodyPartModal = ({ visible, onClose, onSave, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.modalBox}>
          <Text style={styles.title}>Enter Body Part</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="e.g. Left Arm, Back"
            placeholderTextColor="#999"
            autoFocus
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => { onSave(value.trim()); onClose(); }}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { width: 300, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 20 },
  title: { color: '#fff', fontSize: 18, fontFamily: 'ProductSans-Bold', marginBottom: 15, textAlign: 'center' },
  input: { backgroundColor: '#2c2c2e', color: '#fff', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 20 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { padding: 10 },
  cancelText: { color: '#22B2A6', fontSize: 16, fontFamily: 'ProductSans-Regular' },
  saveBtn: { padding: 10, backgroundColor: '#22B2A6', borderRadius: 8, paddingHorizontal: 15 },
  saveText: { color: '#000', fontSize: 16, fontFamily: 'ProductSans-Bold' },
});

export default BodyPartModal;
