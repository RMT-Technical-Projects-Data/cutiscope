import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions,
  Pressable,
  Keyboard,
  ToastAndroid,
  ScrollView,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import DateTimePicker from '@react-native-community/datetimepicker';
import KioskTextInput from '../Components/KioskTextInput';
import CustomKeyboard from '../Components/CustomKeyboard';
import { useCustomKeyboard } from '../context/CustomKeyboardContext';
import backIcon from '../assets/icon_back.png';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import CustomStatusBar from '../Components/CustomStatusBar';
import { getPatients, createPatient, getNextPatientId } from '../services/patientsService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_SMALL = SCREEN_WIDTH < 360 || SCREEN_HEIGHT < 600;
const H_PAD = IS_SMALL ? 16 : 24;

const TAB_NEW_BLANK = 'Enter Patient';
const TAB_NEW_SET = 'New Patient';
const TAB_EXISTING_BLANK = 'Existing Patient';
const TAB_EXISTING_SET = 'Existing patients';

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const MR_NO_PREFIX = 'MRI-';
const PATIENT_NAME_VALID = /^[a-zA-Z\s]+$/;

function sanitizePatientName(text) {
  return String(text).replace(/[^a-zA-Z\s]/g, '');
}

function isNewPatientFormReady({ name, mrNo, dob, gender, nextId, loadingNextId }) {
  const trimmedName = (name || '').trim();
  const trimmedMrNo = (mrNo || '').trim();
  return (
    trimmedName.length > 0 &&
    PATIENT_NAME_VALID.test(trimmedName) &&
    /[a-zA-Z]/.test(trimmedName) &&
    trimmedMrNo.length === 4 &&
    (dob || '').trim().length > 0 &&
    (gender || '').trim().length > 0 &&
    !loadingNextId &&
    Boolean(nextId) &&
    nextId !== '--'
  );
}

const PatientBoxModal = ({
  visible,
  onClose,
  initialId = '',
  initialName = '',
  onSet,
}) => {
  const { hasFocusedInput } = useCustomKeyboard();
  const isBlank = !initialId && !initialName;
  const [activeTab, setActiveTab] = useState(TAB_NEW_BLANK);
  const [showNewPatientForm, setShowNewPatientForm] = useState(false);
  const [nextId, setNextId] = useState('');
  const [loadingNextId, setLoadingNextId] = useState(false);
  const [noInternet, setNoInternet] = useState(false);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [mrNo, setMrNo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGenderMenu, setShowGenderMenu] = useState(false);
  const [dateObj, setDateObj] = useState(new Date(2000, 0, 1));

  const [existingList, setExistingList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  // Track whether the new-patient form is currently mounted so the NetInfo
  // listener knows whether to re-fetch the ID.
  const showNewPatientFormViewRef = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const tabNew = isBlank ? TAB_NEW_BLANK : TAB_NEW_SET;
  const tabExisting = isBlank ? TAB_EXISTING_BLANK : TAB_EXISTING_SET;

  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      setFormError('');
      setShowNewPatientForm(false);
      setNoInternet(false);
      if (isBlank) {
        setActiveTab(TAB_NEW_BLANK);
        setName('');
        setDob('');
        setGender('');
        setAge('');
        setMrNo('');
        setNextId('');
        setLoadingNextId(true);
        getNextPatientId()
          .then((id) => {
            setNextId(id || '--');
            setNoInternet(false);
          })
          .catch(() => {
            setNextId('--');
            setNoInternet(true);
            ToastAndroid.show('No Internet Connection', ToastAndroid.SHORT);
          })
          .finally(() => setLoadingNextId(false));
      } else {
        setActiveTab(tabNew);
        setName('');
        setDob('');
        setGender('');
        setAge('');
        setMrNo('');
      }
    }
  }, [visible, isBlank, tabNew]);

  useEffect(() => {
    if (visible && (activeTab === TAB_EXISTING_BLANK || activeTab === TAB_EXISTING_SET)) {
      setLoadingList(true);
      setListError(null);
      getPatients()
        .then((list) => setExistingList(Array.isArray(list) ? list : []))
        .catch((err) => {
          setListError(err.message || 'Could not load patients');
          setExistingList([]);
        })
        .finally(() => setLoadingList(false));
    }
  }, [visible, activeTab]);

  const showForm = activeTab === tabNew;
  const showList = activeTab === tabExisting;
  const showNewPatientFormView = showForm && (isBlank || showNewPatientForm);

  // Keep a ref in sync so the NetInfo listener can read it without stale closure.
  useEffect(() => {
    showNewPatientFormViewRef.current = showNewPatientFormView;
  }, [showNewPatientFormView]);

  useEffect(() => {
    if (!visible || !showNewPatientFormView) return;
    setNextId('');
    setLoadingNextId(true);
    getNextPatientId()
      .then((id) => {
        setNextId(id || '--');
        setNoInternet(false);
      })
      .catch(() => {
        setNextId('--');
        setNoInternet(true);
        ToastAndroid.show('No Internet Connection', ToastAndroid.SHORT);
      })
      .finally(() => setLoadingNextId(false));
  }, [visible, showNewPatientFormView]);

  // When internet is restored while the modal is open and the ID wasn't
  // successfully fetched (still '--'), automatically re-fetch it.
  useEffect(() => {
    if (!visible) return;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected && state.isInternetReachable !== false;
      if (isConnected && showNewPatientFormViewRef.current) {
        // Only re-fetch if we previously failed (ID is still '--').
        setNextId((prev) => {
          if (prev === '--') {
            setLoadingNextId(true);
            getNextPatientId()
              .then((id) => {
                setNextId(id || '--');
                setNoInternet(false);
              })
              .catch(() => {
                setNextId('--');
                setNoInternet(true);
              })
              .finally(() => setLoadingNextId(false));
          }
          return prev; // state update is handled inside the branch above
        });
      }
    });
    return () => unsubscribe();
  }, [visible]);

  const onDateChange = useCallback((event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setDateObj(selectedDate);
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const year = selectedDate.getFullYear();
      setDob(`${day}/${month}/${year}`);

      // Calculate age
      const today = new Date();
      let calculatedAge = today.getFullYear() - year;
      const m = today.getMonth() - selectedDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < selectedDate.getDate())) {
        calculatedAge--;
      }
      setAge(String(calculatedAge));
    }
  }, []);

  const handleSelectExisting = useCallback((patient) => {
    onSet({
      id: String(patient.id ?? ''),
      name: String(patient.name ?? ''),
    });
    onClose();
  }, [onSet, onClose]);

  const handleSetNew = useCallback(async () => {
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      onSet({ id: '', name: '' });
      onClose();
      return;
    }

    if (!PATIENT_NAME_VALID.test(trimmedName) || !/[a-zA-Z]/.test(trimmedName)) {
      setFormError('Patient name must contain only letters.');
      return;
    }

    const trimmedMrNo = (mrNo || '').trim();
    if (trimmedMrNo.length !== 4) {
      setFormError('MRI number must be exactly 4 digits.');
      return;
    }

    if (!(dob || '').trim()) {
      setFormError('Date of birth is required.');
      return;
    }

    if (!(gender || '').trim()) {
      setFormError('Gender is required.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const created = await createPatient({
        id: nextId,
        name: trimmedName,
        dob: (dob || '').trim(),
        gender: (gender || '').trim(),
        // age: (age || '').trim(),
        mr_no: `${MR_NO_PREFIX}${trimmedMrNo}`,
      });
      onSet({
        id: String(created.id ?? nextId),
        name: String(created.name ?? trimmedName),
      });
      onClose();
    } catch (err) {
      setFormError(err?.message || 'Could not create patient. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [name, dob, gender, age, mrNo, nextId, onSet, onClose, formError]);

  const handleClearSelection = useCallback(() => {
    onSet({ id: '', name: '' });
    onClose();
  }, [onSet, onClose]);

  const handleBackdrop = useCallback(() => {
    onClose();
  }, [onClose]);

  const filteredList = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return existingList;
    return existingList.filter(
      (p) =>
        String(p.id || '').toLowerCase().includes(q) ||
        String(p.name || '').toLowerCase().includes(q)
    );
  }, [existingList, searchQuery]);

  const canSaveNewPatient = isNewPatientFormReady({ name, mrNo, dob, gender, nextId, loadingNextId });

  const renderPatientItem = useCallback(({ item }) => {
    const isSelected = String(item.id) === String(initialId);
    return (
      <TouchableOpacity
        style={[styles.patientRow, isSelected && styles.patientRowSelected]}
        onPress={() => handleSelectExisting(item)}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name="folder-account"
          size={IS_SMALL ? 20 : 22}
          color={isSelected ? '#fff' : '#22B2A6'}
          style={styles.patientRowIcon}
        />
        <View style={styles.patientRowText}>
          <Text style={[styles.patientRowName, isSelected && styles.patientRowNameSelected]} numberOfLines={1} selectable={false}>
            {item.name}
          </Text>
          <Text style={[styles.patientRowId, isSelected && styles.patientRowIdSelected]} selectable={false}>
            ID: {item.id}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={isSelected ? '#fff' : '#666'} />
      </TouchableOpacity>
    );
  }, [initialId, handleSelectExisting]);

  const keyExtractor = useCallback((item) => String(item.id), []);

  const showCurrentSelectionView = !isBlank && showForm && !showNewPatientForm;

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={handleBackdrop}
      statusBarTranslucent={true}
    >
      {/* Simple container like PowerOffModal */}
      <View style={styles.container}>
        <CustomStatusBar />
        <View style={[styles.modalView, hasFocusedInput && styles.modalViewKeyboardOpen]}>
          {/* Header with back button */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBackdrop} style={styles.backBtn}>
              <Image source={backIcon} style={styles.backIcon} />
            </TouchableOpacity>
          </View>

          {/* Tab Row */}
          <View style={styles.tabRow}>
            <TouchableOpacity style={[styles.tab, showForm && styles.tabActive]} onPress={() => setActiveTab(tabNew)}>
              <Text style={[styles.tabText, showForm && styles.tabTextActive]} selectable={false} numberOfLines={1}>
                {tabNew}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, showList && styles.tabActive]} onPress={() => setActiveTab(tabExisting)}>
              <Text style={[styles.tabText, showList && styles.tabTextActive]} selectable={false} numberOfLines={1}>
                {tabExisting}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.contentSlot}>
            {showForm && (
              <>
                {showCurrentSelectionView && (
                  <View style={styles.form}>
                    <Text style={styles.label} selectable={false}>Selected patient</Text>
                    <View style={styles.selectedCard}>
                      <View style={styles.idRow}>
                        <Text style={styles.idLabel} selectable={false}>ID</Text>
                        <Text style={styles.idValue} selectable={false}>{initialId || '—'}</Text>
                      </View>
                      <View style={[styles.idRow, styles.idRowLast]}>
                        <Text style={styles.idLabel} selectable={false}>Name</Text>
                        <Text style={styles.idValue} selectable={false} numberOfLines={2}>{initialName || '—'}</Text>
                      </View>
                    </View>
                    <View style={styles.twoButtonRow}>
                      <TouchableOpacity style={styles.clearButton} onPress={handleClearSelection}>
                        <Text style={styles.clearButtonText} selectable={false}>Clear selection</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.newPatientButton} onPress={() => setShowNewPatientForm(true)}>
                        <Text style={styles.newPatientButtonText} selectable={false}>New patient</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {showNewPatientFormView && (
                  <ScrollView 
                    style={[styles.formScroll, hasFocusedInput && styles.formScrollKeyboardOpen]} 
                    contentContainerStyle={styles.formContent} 
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.form}>
                    {!isBlank && (
                      <TouchableOpacity style={styles.backToSelection} onPress={() => setShowNewPatientForm(false)}>
                        <MaterialCommunityIcons name="arrow-left" size={20} color="#22B2A6" />
                        <Text style={[styles.backToSelectionText, { marginLeft: 6 }]} selectable={false}>Back to selected</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.label} selectable={false}>ID (assigned automatically)</Text>
                    <View style={styles.idRow}>
                      {loadingNextId ? (
                        <ActivityIndicator size="small" color="#22B2A6" style={styles.idLoader} />
                      ) : (
                        <Text style={styles.idValue} selectable={false}>{nextId || '—'}</Text>
                      )}
                    </View>
                    <Text style={styles.label} selectable={false}>Name</Text>
                    <KioskTextInput
                      style={styles.input}
                      value={name}
                      onChangeText={(text) => {
                        setName(sanitizePatientName(text));
                        if (formError) setFormError('');
                      }}
                      placeholder="Patient"
                      placeholderTextColor="#666"
                      autoCapitalize="words"
                      contextMenuHidden
                      selectTextOnFocus={false}
                      showDismiss={true}
                      hostKeyboardLocally
                    />

                    <Text style={styles.label} selectable={false}>MR. NO.</Text>
                    <View style={styles.mrNoRow}>
                      <View style={styles.mrNoPrefix}>
                        <Text style={styles.mrNoPrefixText} selectable={false}>{MR_NO_PREFIX}</Text>
                      </View>
                      <KioskTextInput
                        style={[styles.input, styles.mrNoInput]}
                        value={mrNo}
                        onChangeText={(text) => {
                          setMrNo(String(text).replace(/^MRI-/i, '').replace(/\D/g, ''));
                          if (formError) setFormError('');
                        }}
                        placeholder="1234"
                        placeholderTextColor="#666"
                        keyboardType="numeric"
                        contextMenuHidden
                        selectTextOnFocus={false}
                        showDismiss={true}
                      hostKeyboardLocally
                      />
                    </View>

                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label} selectable={false}>DOB</Text>
                        <TouchableOpacity 
                          style={[styles.pickerTrigger, { marginBottom: 16 }]} 
                          onPress={() => setShowDatePicker(true)}
                          activeOpacity={0.7}
                        >
                          <Text 
                            style={[styles.pickerTriggerText, !dob && styles.pickerPlaceholder, { flex: 1 }]}
                            numberOfLines={1}
                          >
                            {dob || 'DD/MM/YYYY'}
                          </Text>
                          <MaterialCommunityIcons name="calendar" size={20} color="#666" />
                        </TouchableOpacity>
                      </View>
                      {/* Commented out Age input field
                      <View style={{ flex: 0.8 }}>
                        <Text style={styles.label} selectable={false}>Age</Text>
                        <KioskTextInput
                          style={styles.input}
                          value={age}
                          onChangeText={setAge}
                          placeholder="Age"
                          placeholderTextColor="#666"
                          keyboardType="numeric"
                          contextMenuHidden
                          selectTextOnFocus={false}
                          showDismiss={true}
                      hostKeyboardLocally
                        />
                      </View>
                      */}
                    </View>

                    <Text style={styles.label} selectable={false}>Gender</Text>
                    <TouchableOpacity 
                      style={[styles.pickerTrigger, { marginBottom: 16 }]} 
                      onPress={() => setShowGenderMenu(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickerTriggerText, !gender && styles.pickerPlaceholder]}>
                        {gender || 'Select Gender'}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={24} color="#666" />
                    </TouchableOpacity>

                    {showDatePicker && (
                      <DateTimePicker
                        value={dateObj}
                        mode="date"
                        display="default"
                        onChange={onDateChange}
                        maximumDate={new Date()}
                      />
                    )}

                    <Modal
                      visible={showGenderMenu}
                      transparent
                      animationType="fade"
                      onRequestClose={() => setShowGenderMenu(false)}
                    >
                      <Pressable style={styles.menuOverlay} onPress={() => setShowGenderMenu(false)}>
                        <View style={styles.menuContainer}>
                          <Text style={styles.menuTitle}>Select Gender</Text>
                          {GENDER_OPTIONS.map((opt) => (
                            <TouchableOpacity
                              key={opt}
                              style={[styles.menuOption, gender === opt && styles.menuOptionSelected]}
                              onPress={() => {
                                setGender(opt);
                                setShowGenderMenu(false);
                                if (formError) setFormError('');
                              }}
                            >
                              <Text style={[styles.menuOptionText, gender === opt && styles.menuOptionTextSelected]}>
                                {opt}
                              </Text>
                              {gender === opt && <MaterialCommunityIcons name="check" size={20} color="#22B2A6" />}
                            </TouchableOpacity>
                          ))}
                        </View>
                      </Pressable>
                    </Modal>
                    {formError ? (
                      <View style={styles.formErrorBox}>
                        <Text style={styles.formErrorTitle} selectable={false}>Unable to save patient</Text>
                        <Text style={styles.formErrorMessage} selectable={false}>{formError}</Text>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.setButton,
                        (saving || !canSaveNewPatient) && styles.setButtonDisabled
                      ]}
                      onPress={handleSetNew}
                      disabled={saving || !canSaveNewPatient}
                    >
                      {saving ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.setButtonText} selectable={false}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
                )}
              </>
            )}

            {showList && (
              <View style={[styles.listContainer, hasFocusedInput && styles.listContainerKeyboardOpen]}>
                {!isBlank && (
                  <View style={styles.selectedBanner}>
                    <MaterialCommunityIcons name="check-circle" size={18} color="#22B2A6" />
                    <Text style={[styles.selectedBannerText, { marginLeft: 8 }]} selectable={false} numberOfLines={1}>
                      Selected: ID {initialId} · {initialName}
                    </Text>
                  </View>
                )}
                <View style={styles.searchWrap}>
                  <MaterialCommunityIcons name="magnify" size={20} color="#888" style={styles.searchIcon} />
                  <KioskTextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by ID or name"
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    contextMenuHidden
                    selectTextOnFocus={false}
                    showDismiss={true}
                    hostKeyboardLocally
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
                      <MaterialCommunityIcons name="close-circle" size={20} color="#888" />
                    </TouchableOpacity>
                  )}
                </View>
                {loadingList ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="large" color="#22B2A6" />
                    <Text style={styles.loadingText} selectable={false}>Loading patients…</Text>
                  </View>
                ) : listError ? (
                  <View style={styles.loadingBox}>
                    <Text style={styles.errorText} selectable={false}>{listError}</Text>
                  </View>
                ) : filteredList.length === 0 ? (
                  <View style={styles.loadingBox}>
                    <Text style={styles.emptyText} selectable={false}>
                      {existingList.length === 0 ? 'No patients yet. Add one in the other tab.' : 'No match for search.'}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredList}
                    keyExtractor={keyExtractor}
                    renderItem={renderPatientItem}
                    style={[styles.flatList, hasFocusedInput && styles.flatListKeyboardOpen]}
                    contentContainerStyle={styles.flatListContent}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={12}
                    maxToRenderPerBatch={10}
                    windowSize={6}
                  />
                )}
              </View>
            )}
          </View>
        </View>
      </View>
      <CustomKeyboard localHost />
    </Modal>
  );
};

const styles = StyleSheet.create({
  // Container like PowerOffModal - full screen with dark background
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)', // Same as PowerOffModal
  },
  modalView: {
    width: SCREEN_WIDTH * 0.92,
    maxWidth: 400,
    maxHeight: SCREEN_HEIGHT * 0.85,
    backgroundColor: '#1C1C1E', // Same as PowerOffModal
    borderRadius: 20,
    padding: H_PAD,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    padding: 4,
  },
  backIcon: {
    width: 28,
    height: 28,
    tintColor: '#fff',
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#252525',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#22B2A6',
  },
  tabText: {
    fontSize: IS_SMALL ? 13 : 15,
    color: '#888',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
  contentSlot: {
    width: '100%',
  },
  form: {
    paddingBottom: 10,
  },
  formScroll: {
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  formContent: {
    flexGrow: 1,
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 6,
  },
  selectedCard: {
    backgroundColor: '#252525',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  idRowLast: {
    borderBottomWidth: 0,
  },
  idLabel: {
    fontSize: 13,
    color: '#888',
    width: 48,
  },
  idValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
    flex: 1,
  },
  idLoader: {
    alignSelf: 'flex-start',
  },
  twoButtonRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  clearButton: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 6,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  newPatientButton: {
    flex: 1,
    backgroundColor: '#22B2A6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginLeft: 6,
  },
  newPatientButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backToSelection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backToSelectionText: {
    color: '#22B2A6',
    fontSize: 14,
    fontWeight: '600',
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
  mrNoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  mrNoPrefix: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 52,
    justifyContent: 'center',
    marginRight: 8,
  },
  mrNoPrefixText: {
    fontSize: 16,
    color: '#aaa',
  },
  mrNoInput: {
    flex: 1,
    marginBottom: 0,
  },
  pickerTrigger: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
    height: 52, // Match KioskTextInput height roughly
  },
  pickerTriggerText: {
    fontSize: 15,
    color: '#fff',
  },
  pickerPlaceholder: {
    color: '#666',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    width: SCREEN_WIDTH * 0.7,
    maxWidth: 280,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  menuTitle: {
    fontSize: 14,
    color: '#888',
    padding: 12,
    fontWeight: '600',
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 8,
  },
  menuOptionSelected: {
    backgroundColor: 'rgba(34, 178, 166, 0.1)',
  },
  menuOptionText: {
    fontSize: 16,
    color: '#fff',
  },
  menuOptionTextSelected: {
    color: '#22B2A6',
    fontWeight: '600',
  },
  setButton: {
    backgroundColor: '#22B2A6',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  setButtonDisabled: {
    backgroundColor: '#444',
    opacity: 0.8,
  },
  setButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  formErrorBox: {
    backgroundColor: '#2a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#d32f2f',
    marginBottom: 8,
  },
  formErrorTitle: {
    color: '#ff8a80',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  formErrorMessage: {
    color: '#ffcccc',
    fontSize: 13,
  },
  listContainer: {
    maxHeight: SCREEN_HEIGHT * 0.7,
    flexShrink: 1,
  },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 178, 166, 0.2)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 178, 166, 0.4)',
  },
  selectedBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252525',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
  },
  searchClear: {
    padding: 4,
  },
  flatList: {
    maxHeight: SCREEN_HEIGHT * 0.6,
    flexShrink: 1,
  },
  flatListContent: {
    paddingBottom: 16,
  },
  patientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#252525',
    marginBottom: 2,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  patientRowSelected: {
    backgroundColor: 'rgba(34, 178, 166, 0.35)',
    borderColor: '#22B2A6',
  },
  patientRowIcon: {
    marginRight: 10,
  },
  patientRowText: {
    flex: 1,
    minWidth: 0,
  },
  patientRowName: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },
  patientRowNameSelected: {
    color: '#fff',
  },
  patientRowId: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  patientRowIdSelected: {
    color: 'rgba(255,255,255,0.9)',
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
  errorText: {
    color: '#e57373',
    textAlign: 'center',
    fontSize: 14,
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalViewKeyboardOpen: {
    maxHeight: SCREEN_HEIGHT * 0.48,
  },
  formScrollKeyboardOpen: {
    maxHeight: SCREEN_HEIGHT * 0.3,
  },
  listContainerKeyboardOpen: {
    maxHeight: SCREEN_HEIGHT * 0.35,
  },
  flatListKeyboardOpen: {
    maxHeight: SCREEN_HEIGHT * 0.25,
  },
});

export default PatientBoxModal;