# Kiosk Mode Implementation Plan for DermaScope App

This document describes where and how to integrate the kiosk mode feature from **KioskMode-Full-main** into **dermaScopeApp**, with a clear file-by-file plan and design decisions.

---

## 1. Overview

### 1.1 What Kiosk Mode Does (from KioskMode-Full-main)

- **Android**: Uses **Lock Task Mode** (`startLockTask()` / `stopLockTask()`) so the app stays in the foreground and the user cannot leave it (no recents, no home).
- **Device owner**: When the app is set as **device owner**, it can call `setLockTaskPackages()` so only this app is allowed in lock task.
- **Native API**: Exposed to JS via a React Native native module with:
  - `startKioskMode()` → starts lock task
  - `stopKioskMode()` → stops lock task

### 1.2 Design Goals for DermaScope

- **Structured**: Kiosk logic lives in a dedicated native module and a small JS layer; no scattering across unrelated files.
- **Optional**: Kiosk can be enabled/disabled (e.g. via settings or a build/device-owner flag); normal usage unchanged when disabled.
- **Android-only**: Lock Task Mode is Android-specific; iOS is out of scope for this plan (can be added later with Guided Access if needed).
- **Reuse existing patterns**: Follow how `SystemPowerPackage`, `AppUpdatePackage`, and `DermascopePackage` are registered and used.

---

## 2. Files to Add

### 2.1 Android (native)

| File | Purpose |
|------|--------|
| `android/app/src/main/java/com/dermascopeapp/KioskModeModule.kt` | Native module: `startKioskMode()` and `stopKioskMode()` using `DevicePolicyManager` and `startLockTask()` / `stopLockTask()`. |
| `android/app/src/main/java/com/dermascopeapp/KioskModePackage.kt` | React package that registers `KioskModeModule`. |
| `android/app/src/main/java/com/dermascopeapp/KioskDeviceAdminReceiver.kt` | Device admin receiver used as the `ComponentName` for `setLockTaskPackages()` when app is device owner. |

**Notes:**

- **KioskModeModule.kt**: Adapt from `KioskMode-Full-main/android/.../KioskModeModule.kt`; change package to `com.dermascopeapp` and use `KioskDeviceAdminReceiver::class.java` for `ComponentName`.
- **KioskDeviceAdminReceiver.kt**: Copy from `KioskMode-Full-main/android/.../KioskDeviceAdminReceiver.kt` and change package to `com.dermascopeapp`.
- **KioskModePackage.kt**: Same pattern as `DermascopePackage.kt` / `SystemPowerPackage.kt`; only register `KioskModeModule`.

### 2.2 Android manifest and resources

| File | Change |
|------|--------|
| `android/app/src/main/AndroidManifest.xml` | Declare a `<receiver>` for `KioskDeviceAdminReceiver` with `BIND_DEVICE_ADMIN`, `android.app.action.DEVICE_ADMIN_ENABLED`, and `meta-data android:resource="@xml/device_admin_rules"` (reuse existing `device_admin_rules.xml`; it already has the policies needed for device owner / lock task). |
| `android/app/src/main/res/xml/device_admin_rules.xml` | No change required; already contains the policies used by the existing `DeviceAdminReceiver`. If you use a **separate** XML for kiosk (e.g. `kiosk_device_admin.xml`), add that file and reference it in the new receiver’s `meta-data`. |

**Note:** The current manifest references `.DeviceAdminReceiver`, which does not exist in the repo. If the build fails for that, either (a) add a minimal `DeviceAdminReceiver.kt` that extends `DeviceAdminReceiver`, or (b) use a single receiver: rename/use `KioskDeviceAdminReceiver` for both device admin and kiosk and point the existing manifest entry to it. Prefer (b) if you only need device admin for kiosk.

### 2.3 JavaScript / React Native

| File | Purpose |
|------|--------|
| `utils/KioskMode.js` (or `services/KioskMode.js`) | Single place for JS kiosk API: get `KioskModeModule` from `NativeModules`, expose `startKioskMode()` and `stopKioskMode()` with Platform check (Android only), and optional error handling / logging. |
| `context/KioskContext.js` (optional) | If you want app-wide “is kiosk active” or “enable kiosk at startup” state, provide it here and wrap `App.js` (or the navigator) with `KioskProvider`. |
| `modals/SettingsMenu.js` | Add a “Kiosk mode” section: toggle or “Enter / Exit kiosk” buttons that call the `KioskMode` util; show only on Android. |
| `App.js` | Optional: after login/when appropriate, call `KioskMode.startKioskMode()` if a flag (e.g. from AsyncStorage or remote config) is set, so the device boots into kiosk. |

---

## 3. Files to Modify

### 3.1 Android

| File | Change |
|------|--------|
| `android/app/src/main/java/com/dermascopeapp/MainApplication.kt` | In `getPackages()`, add `add(KioskModePackage())` so the native module is available to JS. |

### 3.2 AndroidManifest.xml

| File | Change |
|------|--------|
| `android/app/src/main/AndroidManifest.xml` | Add the `<receiver>` for `KioskDeviceAdminReceiver` (see 2.2). If you consolidate with the existing DeviceAdminReceiver, update `android:name` and optionally the `meta-data` resource. |

### 3.3 JavaScript

| File | Change |
|------|--------|
| `App.js` | (Optional) Import `KioskMode` util and, when appropriate (e.g. after auth check and if “start in kiosk” is enabled), call `KioskMode.startKioskMode()`. |
| `modals/SettingsMenu.js` | Import `KioskMode` (and `Platform`). Add a “Kiosk mode” row (Android only) that calls `KioskMode.startKioskMode()` / `KioskMode.stopKioskMode()` and shows success/error (e.g. Toast or inline message). |

---

## 4. Implementation Order

1. **Android native**
   - Add `KioskDeviceAdminReceiver.kt`.
   - Add `KioskModeModule.kt` (package `com.dermascopeapp`, use `KioskDeviceAdminReceiver` in `ComponentName`).
   - Add `KioskModePackage.kt`.
   - Register `KioskModePackage` in `MainApplication.kt`.
   - Update `AndroidManifest.xml` (receiver for `KioskDeviceAdminReceiver`; fix or add `DeviceAdminReceiver` if needed).
2. **JS API**
   - Add `utils/KioskMode.js` (or `services/KioskMode.js`) wrapping `NativeModules.KioskModeModule` with Android-only guards.
3. **UI and flow**
   - In `SettingsMenu.js`, add kiosk controls (Android only).
   - Optionally in `App.js`, add “start in kiosk” logic based on a stored or config flag.

---

## 5. Where Not to Change (or minimal touch)

- **CameraScreen.js**: No kiosk logic here; only settings entry point (Settings button already opens `SettingsMenu`).
- **WelcomeScreen / Auth**: No kiosk logic unless you explicitly want “auto-start kiosk after login” (then only `App.js` or a small hook).
- **iOS**: No changes in this plan; kiosk is Android-only. If later you add iOS “kiosk-like” behavior (e.g. Guided Access), that can be behind the same `KioskMode` util with `Platform.OS === 'ios'` handling.
- **Existing native modules** (`DermascopeModule`, `SystemPowerModule`, `AppUpdateModule`, etc.): No changes; only add a new package and module.

---

## 6. Summary Table

| Area | Action | Files |
|------|--------|--------|
| Native module | Add | `KioskModeModule.kt`, `KioskModePackage.kt`, `KioskDeviceAdminReceiver.kt` |
| Manifest | Modify | `AndroidManifest.xml` (receiver; fix DeviceAdminReceiver if needed) |
| App registration | Modify | `MainApplication.kt` (add `KioskModePackage()`) |
| JS API | Add | `utils/KioskMode.js` or `services/KioskMode.js` |
| Settings UI | Modify | `modals/SettingsMenu.js` (kiosk toggle/buttons, Android only) |
| App entry (optional) | Modify | `App.js` (optional auto-start kiosk) |

This keeps kiosk mode structured, optional, and confined to a small set of files.
