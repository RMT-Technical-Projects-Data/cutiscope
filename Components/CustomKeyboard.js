import React, { useState, useCallback, memo, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Vibration, DeviceEventEmitter } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCustomKeyboard } from '../context/CustomKeyboardContext';

const KEY_HAPTIC_MS = 3;

const LAYOUT_ALPHA = 'alpha';
const LAYOUT_SYMBOLS = 'symbols';
const LAYOUT_NUMERIC = 'numeric';

// Caps states
const CAPS_OFF   = 'off';   // lowercase
const CAPS_ONCE  = 'once';  // one capital then auto-off (stroke icon)
const CAPS_LOCK  = 'lock';  // always capital (filled icon)

const ROW1 = 'QWERTYUIOP';
const ROW2 = 'ASDFGHJKL';
const ROW3 = 'ZXCVBNM';
const NUMBERS = '1234567890';
const SYM_ROW1_KEYS = ['@', '.', '?', '#', '$', '%', '&', '*', '-', '+'];
const SYM_ROW2 = '!()[]{};:';
const SYM_ROW3_KEYS = ['/', '\\', '|', '<', '>', '^', '_', '~'];

const KEY_HEIGHT = 44;
const KEY_MIN_WIDTH = 30;
const ROW_MARGIN = 6;
const KEY_GAP = 5;

const BACKSPACE_REPEAT_DELAY_MS = 280;
const BACKSPACE_REPEAT_INTERVAL_MS = 65;

// ─── Generic key ───────────────────────────────────────────────────────────────
const Key = memo(function Key({ label, onPress, style, size = 'normal', labelStyle, children }) {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const handlePress = useCallback(() => {
    onPressRef.current();
    DeviceEventEmitter.emit('userActivity');
    setImmediate(() => Vibration.vibrate(KEY_HAPTIC_MS));
  }, []);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.key,
        size === 'wide' && styles.keyWide,
        style,
        pressed && styles.keyPressed,
      ]}
      onPress={handlePress}
      delayLongPress={400}
      android_disableSound
      android_ripple={null}
    >
      {children ? children : (
        <Text style={[styles.keyLabel, labelStyle]} numberOfLines={1}>{label}</Text>
      )}
    </Pressable>
  );
});

// ─── Backspace key ─────────────────────────────────────────────────────────────
const BackspaceKey = memo(function BackspaceKey({ onBackspace, style, iconSize = 20 }) {
  const repeatTimerRef = useRef(null);
  const repeatIntervalRef = useRef(null);
  const onBackspaceRef = useRef(onBackspace);
  onBackspaceRef.current = onBackspace;

  const clearRepeat = useCallback(() => {
    if (repeatTimerRef.current) { clearTimeout(repeatTimerRef.current); repeatTimerRef.current = null; }
    if (repeatIntervalRef.current) { clearInterval(repeatIntervalRef.current); repeatIntervalRef.current = null; }
  }, []);

  useEffect(() => () => clearRepeat(), [clearRepeat]);

  const handlePressIn = useCallback(() => {
    onBackspaceRef.current();
    DeviceEventEmitter.emit('userActivity');
    setImmediate(() => Vibration.vibrate(KEY_HAPTIC_MS));
    repeatTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = null;
      repeatIntervalRef.current = setInterval(() => { 
        onBackspaceRef.current(); 
        DeviceEventEmitter.emit('userActivity');
      }, BACKSPACE_REPEAT_INTERVAL_MS);
    }, BACKSPACE_REPEAT_DELAY_MS);
  }, []);

  const handlePressOut = useCallback(() => { clearRepeat(); }, [clearRepeat]);
  const handlePress    = useCallback(() => { clearRepeat(); }, [clearRepeat]);

  return (
    <Pressable
      style={({ pressed }) => [styles.key, styles.keyModifier, style, pressed && styles.keyPressed]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      android_disableSound
      android_ripple={null}
    >
      <Icon name="backspace-outline" size={iconSize} color="#fff" />
    </Pressable>
  );
});

// ─── Caps key ──────────────────────────────────────────────────────────────────
const CapsKey = memo(function CapsKey({ capsState, onPress, style }) {
  // CAPS_OFF   → outline arrow (no fill, dim colour)
  // CAPS_ONCE  → outline arrow (white, active but not locked)
  // CAPS_LOCK  → filled arrow (accent colour, locked)
  const iconName  = capsState === CAPS_LOCK ? 'arrow-up-bold'         : 'arrow-up-bold-outline';
  const iconColor = capsState === CAPS_OFF  ? '#888'
                  : capsState === CAPS_ONCE ? '#fff'
                  :                          '#22B2A6'; // LOCK = accent

  const handlePress = useCallback(() => {
    DeviceEventEmitter.emit('userActivity');
    setImmediate(() => Vibration.vibrate(KEY_HAPTIC_MS));
    onPress();
  }, [onPress]);

  return (
    <Pressable
      style={({ pressed }) => [styles.key, styles.keyModifier, style, pressed && styles.keyPressed]}
      onPress={handlePress}
      android_disableSound
      android_ripple={null}
    >
      <Icon name={iconName} size={20} color={iconColor} />
    </Pressable>
  );
});

// ─── Row helper ────────────────────────────────────────────────────────────────
const KeyRow = memo(function KeyRow({ keys, onKeyPress }) {
  return (
    <View style={styles.keyRow}>
      {keys.map((k, i) => (
        <Key key={i} label={k} onPress={() => onKeyPress(k)} />
      ))}
    </View>
  );
});

// ─── Main keyboard ─────────────────────────────────────────────────────────────
function CustomKeyboard({ onKeyPressFeedback }) {
  const { insertText, deleteBackward, dismissKeyboard, submitEditing, hasFocusedInput, keyboardType, showDismiss } = useCustomKeyboard();
  const [layout, setLayout] = useState(LAYOUT_ALPHA);
  const [capsState, setCapsState] = useState(CAPS_OFF);

  useEffect(() => {
    if (keyboardType === 'numeric' || keyboardType === 'number-pad') {
      setLayout(LAYOUT_NUMERIC);
    } else if (layout === LAYOUT_NUMERIC) {
      setLayout(LAYOUT_ALPHA);
    }
  }, [keyboardType]);

  // Cycle: OFF → ONCE → LOCK → OFF
  const handleShift = useCallback(() => {
    setCapsState(s =>
      s === CAPS_OFF  ? CAPS_ONCE :
      s === CAPS_ONCE ? CAPS_LOCK :
                        CAPS_OFF
    );
  }, []);

  const handleChar = useCallback(
    (char) => {
      insertText(char);
      if (onKeyPressFeedback) onKeyPressFeedback();
      // CAPS_ONCE: auto-revert to off after one character
      setCapsState(s => s === CAPS_ONCE ? CAPS_OFF : s);
    },
    [insertText, onKeyPressFeedback]
  );

  const handleBackspace = useCallback(() => {
    deleteBackward();
    if (onKeyPressFeedback) onKeyPressFeedback();
  }, [deleteBackward, onKeyPressFeedback]);

  if (!hasFocusedInput) return null;

  const isUpperCase = capsState !== CAPS_OFF && layout === LAYOUT_ALPHA;
  const char = (c) => (isUpperCase ? c : c.toLowerCase());

  return (
    <View style={styles.container}>
      {showDismiss && (
        <View style={styles.accessoryBar}>
          <Pressable
            style={({ pressed }) => [styles.dismissBtn, pressed && styles.dismissBtnPressed]}
            onPress={dismissKeyboard}
          >
            <Icon name="keyboard-close" size={20} color="#22B2A6" />
            <Text style={styles.dismissText}>Done</Text>
          </Pressable>
        </View>
      )}
      {/* ========== ALPHA LAYOUT ========== */}
      {layout === LAYOUT_ALPHA && (
        <>
          <KeyRow keys={NUMBERS.split('')} onKeyPress={handleChar} />
          <KeyRow keys={ROW1.split('').map(char)} onKeyPress={(k) => handleChar(k)} />
          <KeyRow keys={ROW2.split('').map(char)} onKeyPress={(k) => handleChar(k)} />
          <View style={styles.keyRow}>
            <CapsKey capsState={capsState} onPress={handleShift} style={styles.keyModifier} />
            {ROW3.split('').map((c, i) => (
              <Key key={i} label={char(c)} onPress={() => handleChar(char(c))} />
            ))}
            <BackspaceKey onBackspace={handleBackspace} />
          </View>
          <View style={styles.keyRow}>
            <Key label="123" onPress={() => setLayout(LAYOUT_SYMBOLS)} style={styles.keyModifier} />
            <Key label="@" onPress={() => handleChar('@')} style={styles.keyModifier} />
            <Key label=" " onPress={() => handleChar(' ')} style={styles.spaceKey} size="wide" />
            <Key label="." onPress={() => handleChar('.')} style={styles.keyModifier} />
            <Key label=".com" onPress={() => handleChar('.com')} style={styles.keyDotCom} />
            {/* Enter key with consistent icon */}
            <Pressable
              style={({ pressed }) => [styles.key, styles.keyEnter, pressed && styles.keyPressed]}
              onPress={() => {
                DeviceEventEmitter.emit('userActivity');
                setImmediate(() => Vibration.vibrate(KEY_HAPTIC_MS));
                submitEditing();
              }}
              android_disableSound
              android_ripple={null}
            >
              <Icon name="keyboard-return" size={20} color="#fff" />
            </Pressable>
          </View>
        </>
      )}

      {/* ========== SYMBOL LAYOUT ========== */}
      {layout === LAYOUT_SYMBOLS && (
        <>
          <KeyRow keys={NUMBERS.split('')} onKeyPress={handleChar} />
          <View style={styles.keyRow}>
            {SYM_ROW1_KEYS.map((k, i) => (
              <Key key={i} label={k} onPress={() => handleChar(k)} />
            ))}
          </View>
          <KeyRow keys={SYM_ROW2.split('')} onKeyPress={handleChar} />
          <View style={styles.keyRow}>
            {SYM_ROW3_KEYS.map((k, i) => (
              <Key key={i} label={k} onPress={() => handleChar(k)} />
            ))}
            <BackspaceKey onBackspace={handleBackspace} />
          </View>
          <View style={styles.keyRow}>
            <Key label="ABC" onPress={() => setLayout(LAYOUT_ALPHA)} style={styles.keyModifier} />
            <Key label="@" onPress={() => handleChar('@')} style={styles.keyModifier} />
            <Key label=" " onPress={() => handleChar(' ')} style={styles.spaceKey} size="wide" />
            <Key label="." onPress={() => handleChar('.')} style={styles.keyModifier} />
            <Key label="," onPress={() => handleChar(',')} style={styles.keyModifier} />
            <Pressable
              style={({ pressed }) => [styles.key, styles.keyEnter, pressed && styles.keyPressed]}
              onPress={() => {
                DeviceEventEmitter.emit('userActivity');
                setImmediate(() => Vibration.vibrate(KEY_HAPTIC_MS));
                submitEditing();
              }}
              android_disableSound
              android_ripple={null}
            >
              <Icon name="keyboard-return" size={20} color="#fff" />
            </Pressable>
          </View>
        </>
      )}

      {/* ========== NUMERIC LAYOUT ========== */}
      {layout === LAYOUT_NUMERIC && (
        <>
          <KeyRow keys={['1', '2', '3']} onKeyPress={handleChar} />
          <KeyRow keys={['4', '5', '6']} onKeyPress={handleChar} />
          <KeyRow keys={['7', '8', '9']} onKeyPress={handleChar} />
          <View style={styles.keyRow}>
            <Key label="*" onPress={() => handleChar('*')} />
            <Key label="0" onPress={() => handleChar('0')} />
            <BackspaceKey 
              onBackspace={handleBackspace} 
              style={{ backgroundColor: '#3a3a3c', minWidth: 28 }} 
              iconSize={18} 
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#2c2c2e',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#3a3a3c',
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: ROW_MARGIN,
    gap: KEY_GAP,
  },
  key: {
    flex: 1,
    minWidth: 28,
    height: KEY_HEIGHT,
    backgroundColor: '#3a3a3c',
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  keyPressed: {
    opacity: 0.8,
    backgroundColor: '#4a4a4e',
  },
  keyWide: {
    flex: 1,
    minWidth: 60,
    maxWidth: 200,
  },
  keyModifier: {
    backgroundColor: '#4a4a4e',
    minWidth: 38,
  },
  keyDotCom: {
    backgroundColor: '#4a4a4e',
    minWidth: 42,
    paddingHorizontal: 6,
  },
  keyEnter: {
    backgroundColor: '#22B2A6',
    minWidth: 46,
  },
  spaceKey: {
    flex: 1,
    minWidth: 80,
    maxWidth: 200,
  },
  keyLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  accessoryBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#3a3a3c',
    marginBottom: 6,
  },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#3a3a3c',
    borderRadius: 6,
  },
  dismissBtnPressed: {
    opacity: 0.8,
  },
  dismissText: {
    color: '#22B2A6',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default memo(CustomKeyboard);
