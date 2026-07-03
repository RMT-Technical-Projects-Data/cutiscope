import React, { useRef, useCallback, useEffect, useState, forwardRef } from 'react';
import { TextInput } from 'react-native';
import { useCustomKeyboard } from '../context/CustomKeyboardContext';

let kioskInputId = 0;

/**
 * TextInput that never shows the OS keyboard. Use with CustomKeyboard:
 * - showSoftInputOnFocus={false} blocks the system keyboard.
 * - On focus, this input registers with CustomKeyboardContext so the custom keyboard inserts into it.
 * Use for kiosk/medical apps where only the in-app keyboard should be used.
 */
const KioskTextInput = forwardRef(function KioskTextInput({
  value,
  onChangeText,
  onSelectionChange,
  id: propId,
  hostKeyboardLocally = false,
  ...rest
}, ref) {
  const localRef = useRef(null);
  const setRef = useCallback((node) => {
    localRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);

  const idRef = useRef(propId ?? `kiosk_${++kioskInputId}`);
  const id = idRef.current;
  const [selection, setSelectionState] = useState(() => {
    const len = value ? String(value).length : 0;
    return { start: len, end: len };
  });
  const { registerFocusedInput, unregisterFocusedInput } = useCustomKeyboard();

  const valueRef = useRef(value ?? '');
  const selectionRef = useRef(selection);
  valueRef.current = value ?? '';
  selectionRef.current = selection;

  const getValue = useCallback(() => valueRef.current, []);
  const getSelection = useCallback(() => selectionRef.current, []);

  const setValue = useCallback(
    (v) => {
      valueRef.current = v;
      onChangeText?.(v);
    },
    [onChangeText]
  );

  const setSelection = useCallback((s) => {
    selectionRef.current = s;
    setSelectionState(s);
  }, []);

  const onSubmitEditingRef = useRef(rest.onSubmitEditing);
  onSubmitEditingRef.current = rest.onSubmitEditing;

  const onSubmitEditing = useCallback(() => {
    onSubmitEditingRef.current?.();
  }, []);

  useEffect(() => {
    return () => unregisterFocusedInput(id);
  }, [id, unregisterFocusedInput]);

  const handleFocus = useCallback(
    (e) => {
      registerFocusedInput(id, {
        getValue,
        setValue,
        getSelection,
        setSelection,
        keyboardType: rest.keyboardType || 'default',
        showDismiss: rest.showDismiss ?? false,
        hostKeyboardLocally,
        blur: () => localRef.current?.blur?.(),
        onSubmitEditing,
      });
      rest.onFocus?.(e);
    },
    [id, getValue, setValue, getSelection, setSelection, registerFocusedInput, hostKeyboardLocally, rest, onSubmitEditing]
  );

  const handleBlur = useCallback(
    (e) => {
      unregisterFocusedInput(id);
      rest.onBlur?.(e);
    },
    [id, unregisterFocusedInput, rest]
  );

  const handleSelectionChange = useCallback(
    (e) => {
      const { start, end } = e.nativeEvent.selection;
      const s = { start, end };
      selectionRef.current = s;
      setSelectionState(s);
      onSelectionChange?.(e);
    },
    [onSelectionChange]
  );

  return (
    <TextInput
      ref={setRef}
      {...rest}
      value={value}
      onChangeText={onChangeText}
      selection={selection}
      onSelectionChange={handleSelectionChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      showSoftInputOnFocus={false}
      caretHidden={false}
    />
  );
});

export default KioskTextInput;
