# TODO List for CameraScreen Refactor

## Overview
Refactor CameraScreen.js to keep only camera preview, zoom, focus, exposure, capture, and gallery functionalities. Move polarization, contrast, and settings to their own modals. Ensure each file holds its own functionality without changing existing behaviors.

## Steps
1. **Create PolarizationModal.js**
   - Move polarization logic from usePolarization hook to a new modal.
   - Include vibration, sound, and polarization state management.
   - Add button in CameraScreen to open this modal.

2. **Create ContrastModal.js**
   - Move contrast functionality from Contrast.js and CameraWithContrastControl.js to a new modal.
   - Include exposure slider and contrast shader application.
   - Add button in CameraScreen to open this modal.

3. **Refactor CameraScreen.js**
   - Remove polarization button, logic, and related states.
   - Remove contrast slider and related states.
   - Keep settings modal button if needed, or remove if not.
   - Ensure camera preview, zoom, focus, exposure, capture, gallery remain.
   - Add buttons to open PolarizationModal and ContrastModal.
   - Separate zoom and focus from exposure in UI.

4. **Update Navigation/AppNavigator.js**
   - Ensure modals are properly integrated if needed.

5. **Test Refactored Components**
   - Verify camera preview works.
   - Test zoom, focus, exposure sliders.
