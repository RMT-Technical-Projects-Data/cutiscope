import React, { createContext, useContext, useCallback, useRef, useState, useMemo } from 'react';

/**
 * Focused input descriptor for the in-app custom keyboard.
 * The keyboard inserts/deletes text into whichever input is currently focused.
 */
const defaultDescriptor = {
  getValue: () => '',
  setValue: () => {},
  getSelection: () => ({ start: 0, end: 0 }),
  setSelection: () => {},
  keyboardType: 'default',
  showDismiss: false,
  blur: () => {},
  onSubmitEditing: undefined,
  hostKeyboardLocally: false,
};

const CustomKeyboardContext = createContext({
  registerFocusedInput: () => {},
  unregisterFocusedInput: () => {},
  insertText: () => {},
  deleteBackward: () => {},
  dismissKeyboard: () => {},
  submitEditing: () => {},
  hasFocusedInput: false,
  hostKeyboardLocally: false,
  keyboardType: 'default',
  showDismiss: false,
});

export function CustomKeyboardProvider({ children }) {
  const focusedRef = useRef(null);
  const [hasFocusedInput, setHasFocusedInput] = useState(false);
  const [hostKeyboardLocally, setHostKeyboardLocally] = useState(false);
  const [keyboardType, setKeyboardType] = useState('default');
  const [showDismiss, setShowDismiss] = useState(false);

  const registerFocusedInput = useCallback((id, descriptor) => {
    focusedRef.current = { id, ...descriptor };
    setKeyboardType(descriptor.keyboardType || 'default');
    setShowDismiss(!!descriptor.showDismiss);
    setHostKeyboardLocally(!!descriptor.hostKeyboardLocally);
    setHasFocusedInput(true);
  }, []);

  const unregisterFocusedInput = useCallback((id) => {
    if (focusedRef.current?.id === id) {
      focusedRef.current = null;
      setKeyboardType('default');
      setShowDismiss(false);
      setHostKeyboardLocally(false);
      setHasFocusedInput(false);
    }
  }, []);

  const insertText = useCallback((text) => {
    const cur = focusedRef.current;
    if (!cur) return;
    const value = cur.getValue();
    const { start, end } = cur.getSelection();
    const newValue = value.slice(0, start) + text + value.slice(end);
    cur.setValue(newValue);
    const newCursor = start + text.length;
    cur.setSelection({ start: newCursor, end: newCursor });
  }, []);

  const deleteBackward = useCallback(() => {
    const cur = focusedRef.current;
    if (!cur) return;
    const value = cur.getValue();
    const { start, end } = cur.getSelection();
    let newValue;
    let newCursor;
    if (end > start) {
      newValue = value.slice(0, start) + value.slice(end);
      newCursor = start;
    } else {
      if (start <= 0) return;
      newValue = value.slice(0, start - 1) + value.slice(end);
      newCursor = start - 1;
    }
    cur.setValue(newValue);
    cur.setSelection({ start: newCursor, end: newCursor });
  }, []);

  const dismissKeyboard = useCallback(() => {
    if (focusedRef.current && typeof focusedRef.current.blur === 'function') {
      focusedRef.current.blur();
    }
  }, []);

  const submitEditing = useCallback(() => {
    const cur = focusedRef.current;
    if (cur) {
      if (typeof cur.onSubmitEditing === 'function') {
        cur.onSubmitEditing();
      } else {
        dismissKeyboard();
      }
    }
  }, [dismissKeyboard]);

  const value = useMemo(
    () => ({
      registerFocusedInput,
      unregisterFocusedInput,
      insertText,
      deleteBackward,
      dismissKeyboard,
      submitEditing,
      hasFocusedInput,
      hostKeyboardLocally,
      keyboardType,
      showDismiss,
    }),
    [hasFocusedInput, hostKeyboardLocally, registerFocusedInput, unregisterFocusedInput, insertText, deleteBackward, dismissKeyboard, submitEditing, keyboardType, showDismiss]
  );

  return (
    <CustomKeyboardContext.Provider value={value}>
      {children}
    </CustomKeyboardContext.Provider>
  );
}

export function useCustomKeyboard() {
  const ctx = useContext(CustomKeyboardContext);
  if (!ctx) {
    throw new Error('useCustomKeyboard must be used within CustomKeyboardProvider');
  }
  return ctx;
}

export default CustomKeyboardContext;
