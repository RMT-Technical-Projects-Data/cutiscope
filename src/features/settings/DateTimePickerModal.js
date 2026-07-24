import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  Alert,
  ScrollView,
  FlatList
} from 'react-native';
import { showInAppToast } from '../../shared/utils/inAppToast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EventEmitter from 'events';
import { changeTime } from '../../shared/ui/CustomStatusBar';
import moment from 'moment-timezone';
import dateIcon from '../../../assets/icon_calendar.png';
import timeIcon from '../../../assets/icon_clock.png';
import { ScreenHeader } from '../../shared/ui';

/** Matches App CustomStatusBar height so content sits below it without moving it. */
const APP_STATUS_BAR_HEIGHT = 62;

const dateEventEmitter = new EventEmitter();

const AndroidShell = {
  executeCommand: (command, callback) => {
    setTimeout(() => callback('0'), 100);
  }
};

// Picker constants — defined outside so they are stable
const ITEM_HEIGHT = 48;
const VISIBLE_ITEMS = 5;
const SCROLL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 240
const PICKER_PADDING = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2); // 96

// PickerColumn is defined OUTSIDE the parent component so React never
// treats it as a new component type between renders — this eliminates the
// "blink" caused by unmount/remount on every state change.
const PickerColumn = memo(({ scrollRef, data, selectedValue, onSelect, label, renderItem, initialScrollIndex }) => {
  const hasScrolled = useRef(false);

  // Scroll to the correct initial position once the ScrollView is ready.
  // We use onLayout (fires after measure) instead of onContentSizeChange
  // so we only scroll once per "open", not on every render.
  const handleLayout = useCallback(() => {
    if (hasScrolled.current) return;
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ y: initialScrollIndex * ITEM_HEIGHT, animated: false });
    hasScrolled.current = true;
  }, [scrollRef, initialScrollIndex]);

  // If the desired scroll position changes externally (e.g. user taps an item
  // and we want the list to follow), scroll programmatically.
  useEffect(() => {
    if (!hasScrolled.current) return; // wait until mounted
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ y: initialScrollIndex * ITEM_HEIGHT, animated: false });
  }, [initialScrollIndex]);

  const handleMomentumEnd = useCallback((event) => {
    const y = event.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    if (data && index >= 0 && index < data.length) {
      onSelect(data[index]);
    }
  }, [data, onSelect]);

  return (
    <View style={styles.columnContainer}>
      <Text style={styles.columnLabel}>{label}</Text>
      <View style={[styles.scrollColumn, { height: SCROLL_HEIGHT }]}>
        {/* Center selection highlight band */}
        <View style={[styles.pickerHighlight, { top: PICKER_PADDING, height: ITEM_HEIGHT }]} pointerEvents="none" />
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: PICKER_PADDING }}
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          onLayout={handleLayout}
          onMomentumScrollEnd={handleMomentumEnd}
          scrollEventThrottle={400}
        >
          {data.map((item, index) => {
            const isSelected = item === selectedValue;
            return (
              <TouchableOpacity
                key={`${label}-${index}`}
                style={styles.pickerItem}
                onPress={() => {
                  onSelect(item);
                  if (scrollRef.current) {
                    scrollRef.current.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.pickerItemText,
                  isSelected && styles.selectedPickerItemText
                ]}>
                  {renderItem ? renderItem(item) : item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* Top fade overlay */}
        <View style={styles.pickerFadeTop} pointerEvents="none" />
        {/* Bottom fade overlay */}
        <View style={styles.pickerFadeBottom} pointerEvents="none" />
      </View>
    </View>
  );
});

const DateTimePickerModal = ({ visible, onClose, onConfirm, ...props }) => {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [date, setDate] = useState(new Date());
  const [storedDate, setStoredDate] = useState(null);
  const [storedTime, setStoredTime] = useState(null);
  const [timezone, setTimezone] = useState(null);
  const [isSettingDateTime, setIsSettingDateTime] = useState(false);
  const [initialDateValues, setInitialDateValues] = useState(null);
  const [initialTimeValues, setInitialTimeValues] = useState(null);

  // Custom picker states
  const [selectedHour, setSelectedHour] = useState(12); // Stores 1-12
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [selectedAmPm, setSelectedAmPm] = useState('AM'); // Stores 'AM' or 'PM'

  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const years = Array.from({ length: 11 }, (_, i) => 2020 + i);
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // 12 Hour Format Arrays
  const hoursArray = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
  const minutesArray = Array.from({ length: 60 }, (_, i) => i);
  const amPmArray = ['AM', 'PM'];

  // Initialize time state from current time or stored time
  useEffect(() => {
    const loadStoredData = async () => {
      const now = new Date();
      let h = now.getHours();
      let m = now.getMinutes();
      let ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      h = h ? h : 12; // the hour '0' should be '12'

      setSelectedHour(h);
      setSelectedMinute(m);
      setSelectedAmPm(ampm);

      setSelectedDay(now.getDate());
      setSelectedMonth(now.getMonth());
      setSelectedYear(now.getFullYear());
    };

    if (visible) {
      loadStoredData();
    } else {
      // Reset to main menu when modal is closed
      setShowDatePicker(false);
      setShowTimePicker(false);
      setIsSettingDateTime(false);
    }
  }, [visible]);

  useEffect(() => {
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    if (selectedDay > daysInMonth) {
      setSelectedDay(daysInMonth);
    }
  }, [selectedDay, selectedMonth, selectedYear]);

  const showToast = (message) => {
    showInAppToast(message, { durationMs: 3500 });
  };

  const padZero = (value) => (value < 10 ? `0${value}` : `${value}`);

  const setDateTime = async () => {
    setIsSettingDateTime(true);

    // Change Detection
    let hasChanged = false;
    let updateType = '';

    if (showDatePicker) {
      if (
        selectedDay !== initialDateValues?.day ||
        selectedMonth !== initialDateValues?.month ||
        selectedYear !== initialDateValues?.year
      ) {
        hasChanged = true;
        updateType = 'date';
      }
    } else if (showTimePicker) {
      if (
        selectedHour !== initialTimeValues?.hour ||
        selectedMinute !== initialTimeValues?.minute ||
        selectedAmPm !== initialTimeValues?.ampm
      ) {
        hasChanged = true;
        updateType = 'time';
      }
    }

    if (!hasChanged) {
      setIsSettingDateTime(false);
      setShowDatePicker(false);
      setShowTimePicker(false);
      showToast('No changes made');
      return;
    }

    // Convert back to 24h format for Date object
    let hour24 = selectedHour;
    if (selectedAmPm === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (selectedAmPm === 'AM' && hour24 === 12) {
      hour24 = 0;
    }

    const newDate = new Date(selectedYear, selectedMonth, selectedDay, hour24, selectedMinute);

    // Use onConfirm callback if provided (delegating to parent)
    if (onConfirm && typeof onConfirm === 'function') {
      onConfirm(newDate, updateType);
      setIsSettingDateTime(false);
      return;
    }

    // Fallback for previous implementation (if any) or just simulate success
    await AsyncStorage.setItem('selectedDate', newDate.toISOString());
    setIsSettingDateTime(false);
    setShowDatePicker(false);
    setShowTimePicker(false);
  };

  const handleBack = () => {
    if (showDatePicker) {
      setShowDatePicker(false);
    } else if (showTimePicker) {
      setShowTimePicker(false);
    } else {
      onClose();
    }
  };

  const hourScrollRef = useRef(null);
  const minuteScrollRef = useRef(null);
  const amPmScrollRef = useRef(null);

  const monthScrollRef = useRef(null);
  const dayScrollRef = useRef(null);
  const yearScrollRef = useRef(null);

  // Compute scroll indices for each picker column
  const hourScrollIndex = selectedHour === 12 ? 11 : selectedHour - 1;
  const minuteScrollIndex = selectedMinute;
  const amPmScrollIndex = selectedAmPm === 'PM' ? 1 : 0;
  const monthScrollIndex = selectedMonth;
  const dayScrollIndex = selectedDay - 1;
  const yearScrollIndex = years.indexOf(selectedYear) !== -1 ? years.indexOf(selectedYear) : 0;

  const renderCustomTimePicker = () => (
    <View style={styles.customPickerContainer}>
      <Text style={styles.customPickerTitle}>Set Time</Text>

      <View style={styles.selectedDisplay}>
        <Text style={styles.selectedDisplayText}>
          {padZero(selectedHour)}:{padZero(selectedMinute)} {selectedAmPm}
        </Text>
        <Text style={styles.selectedDisplayLabel}>Selected Time</Text>
      </View>

      <View style={styles.pickerWrapper}>
        <PickerColumn
          scrollRef={hourScrollRef}
          data={hoursArray}
          selectedValue={selectedHour}
          onSelect={setSelectedHour}
          label="Hour"
          renderItem={(h) => padZero(h)}
          initialScrollIndex={hourScrollIndex}
        />
        <Text style={styles.separator}>:</Text>
        <PickerColumn
          scrollRef={minuteScrollRef}
          data={minutesArray}
          selectedValue={selectedMinute}
          onSelect={setSelectedMinute}
          label="Minute"
          renderItem={(m) => padZero(m)}
          initialScrollIndex={minuteScrollIndex}
        />
        <Text style={styles.separator}> </Text>
        <PickerColumn
          scrollRef={amPmScrollRef}
          data={amPmArray}
          selectedValue={selectedAmPm}
          onSelect={setSelectedAmPm}
          label="AM/PM"
          initialScrollIndex={amPmScrollIndex}
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowTimePicker(false)}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, isSettingDateTime && styles.primaryButtonDisabled]}
          onPress={setDateTime}
          disabled={isSettingDateTime}
        >
          <Text style={styles.primaryButtonText}>
            {isSettingDateTime ? 'Setting...' : 'Set Time'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderCustomDatePicker = () => (
    <View style={styles.customPickerContainer}>
      <Text style={styles.customPickerTitle}>Set Date</Text>

      <View style={styles.selectedDisplay}>
        <Text style={styles.selectedDisplayText}>
          {`${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}-${selectedYear}`}
        </Text>
        <Text style={styles.selectedDisplayLabel}>Selected Date</Text>
      </View>

      <View style={styles.pickerWrapper}>
        <PickerColumn
          scrollRef={monthScrollRef}
          data={months}
          selectedValue={months[selectedMonth]}
          onSelect={(month) => setSelectedMonth(months.indexOf(month))}
          label="Month"
          initialScrollIndex={monthScrollIndex}
        />
        <PickerColumn
          scrollRef={dayScrollRef}
          data={daysArray}
          selectedValue={selectedDay}
          onSelect={setSelectedDay}
          label="Day"
          initialScrollIndex={dayScrollIndex}
        />
        <PickerColumn
          scrollRef={yearScrollRef}
          data={years}
          selectedValue={selectedYear}
          onSelect={setSelectedYear}
          label="Year"
          initialScrollIndex={yearScrollIndex}
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDatePicker(false)}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, isSettingDateTime && styles.primaryButtonDisabled]}
          onPress={setDateTime}
          disabled={isSettingDateTime}
        >
          <Text style={styles.primaryButtonText}>
            {isSettingDateTime ? 'Setting...' : 'Set Date'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      transparent={true}
      statusBarTranslucent={true}
    >
      <View style={styles.modalRoot}>
        <View style={styles.statusBarSpacer} />
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <ScreenHeader title="Date & Time" onBack={handleBack} />

            {/* Main Content */}
            <View style={styles.content}>
              {!showDatePicker && !showTimePicker ? (
                <>
                  {/* Current Date/Time Display */}
                  <View style={styles.currentDateTimeCard}>
                    <Text style={styles.currentDateTimeTitle}>Current Date & Time</Text>
                    <Text style={styles.currentDateTimeValue}>
                      {`${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}-${new Date().getFullYear()}`}
                    </Text>
                    <Text style={styles.currentDateTimeValue}>
                      {new Date().toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </Text>
                  </View>

                  {/* Menu Options */}
                  <View style={styles.menuOptions}>
                    <TouchableOpacity
                      style={styles.menuOption}
                      onPress={() => {
                        const now = new Date();
                        setSelectedDay(now.getDate());
                        setSelectedMonth(now.getMonth());
                        setSelectedYear(now.getFullYear());
                        setInitialDateValues({
                          day: now.getDate(),
                          month: now.getMonth(),
                          year: now.getFullYear()
                        });
                        setShowDatePicker(true);
                      }}
                    >
                      <View style={styles.menuOptionIcon}>
                        <Image source={dateIcon} style={styles.menuOptionImage} />
                      </View>
                      <View style={styles.menuOptionText}>
                        <Text style={styles.menuOptionTitle}>Set Date</Text>
                        <Text style={styles.menuOptionSubtitle}>Change the current date</Text>
                      </View>
                      <Text style={styles.menuOptionArrow}>›</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.menuOption}
                      onPress={() => {
                        const now = new Date();
                        const h = now.getHours() % 12 || 12;
                        const m = now.getMinutes();
                        const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

                        setSelectedHour(h);
                        setSelectedMinute(m);
                        setSelectedAmPm(ampm);

                        setInitialTimeValues({
                          hour: h,
                          minute: m,
                          ampm: ampm
                        });
                        setShowTimePicker(true);
                      }}
                    >
                      <View style={styles.menuOptionIcon}>
                        <Image source={timeIcon} style={styles.menuOptionImage} />
                      </View>
                      <View style={styles.menuOptionText}>
                        <Text style={styles.menuOptionTitle}>Set Time</Text>
                        <Text style={styles.menuOptionSubtitle}>Change the current time</Text>
                      </View>
                      <Text style={styles.menuOptionArrow}>›</Text>
                    </TouchableOpacity>


                  </View>
                </>
              ) : showDatePicker ? (
                renderCustomDatePicker()
              ) : (
                renderCustomTimePicker()
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal >
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  statusBarSpacer: {
    height: APP_STATUS_BAR_HEIGHT,
    backgroundColor: 'transparent',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 0,
  },
  modalContent: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: 'transparent',
    marginBottom: 8,
  },
  backButton: {
    height: 40,
    width: 40,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#41403D',
    borderWidth: 1,
    borderColor: '#333333',
  },
  backButtonIcon: {
    height: 22,
    width: 22,
    tintColor: '#FFFFFF',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'ProductSans-Bold',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
  },
  content: {
    padding: 16,
  },
  currentDateTimeCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  currentDateTimeTitle: {
    fontSize: 12,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  currentDateTimeValue: {
    fontSize: 15,
    fontFamily: 'ProductSans-Medium',
    color: '#ffffff',
    marginBottom: 2,
  },
  menuOptions: {
    gap: 10,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  menuOptionIcon: {
    width: 38,
    height: 38,
    backgroundColor: '#252525',
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuOptionImage: {
    width: 18,
    height: 18,
    tintColor: '#22B2A6',
  },
  menuOptionText: {
    flex: 1,
  },
  menuOptionTitle: {
    fontSize: 15,
    fontFamily: 'ProductSans-Bold',
    color: '#ffffff',
    marginBottom: 2,
  },
  menuOptionSubtitle: {
    fontSize: 12,
    fontFamily: 'ProductSans-Light',
    color: '#666666',
  },
  menuOptionArrow: {
    fontSize: 22,
    color: '#22B2A6',
    fontWeight: 'bold',
  },
  customPickerContainer: {
    paddingBottom: 4,
  },
  customPickerTitle: {
    fontSize: 16,
    fontFamily: 'ProductSans-Bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
  },
  selectedDisplay: {
    backgroundColor: '#161616',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  selectedDisplayText: {
    fontSize: 24,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
  },
  selectedDisplayLabel: {
    fontSize: 11,
    fontFamily: 'ProductSans-Medium',
    color: '#555555',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 0,
  },
  columnContainer: {
    alignItems: 'center',
    flex: 1,
  },
  scrollColumn: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  pickerHighlight: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#22B2A6',
    backgroundColor: 'rgba(255, 175, 32, 0.07)',
    zIndex: 10,
  },
  pickerItem: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  selectedPickerItem: {},
  pickerItemText: {
    fontSize: 15,
    fontFamily: 'ProductSans-Regular',
    color: '#444444',
  },
  selectedPickerItemText: {
    color: '#22B2A6',
    fontFamily: 'ProductSans-Bold',
    fontSize: 17,
  },
  separator: {
    fontSize: 18,
    fontFamily: 'ProductSans-Bold',
    color: '#22B2A6',
    textAlign: 'center',
    paddingHorizontal: 2,
    alignSelf: 'center',
    marginTop: 20,
  },
  columnLabel: {
    fontSize: 10,
    fontFamily: 'ProductSans-Medium',
    color: '#555555',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#22B2A6',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#2a2a2a',
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 15,
    fontFamily: 'ProductSans-Bold',
    color: '#000000',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: 'ProductSans-Medium',
    color: '#888888',
  },
});

export default DateTimePickerModal;
export { dateEventEmitter };