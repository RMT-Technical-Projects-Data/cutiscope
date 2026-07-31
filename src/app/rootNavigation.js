import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';

/** Shared root nav ref — session logout can reset even from outside the tree. */
export const rootNavigationRef = createNavigationContainerRef();

export function resetToWelcomeScreen() {
  try {
    if (!rootNavigationRef.isReady()) {
      return false;
    }
    rootNavigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Welcome' }],
      })
    );
    return true;
  } catch (e) {
    console.warn('resetToWelcomeScreen failed:', e?.message || e);
    return false;
  }
}
