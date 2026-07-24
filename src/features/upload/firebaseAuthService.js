import { getAuth } from '@react-native-firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';

const auth = getAuth();

const firebaseAuthService = {
  /**
   * Sign in with email and password
   */
  signInWithEmailAndPassword: async (email, password) => {
    try {
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Store user info
      await AsyncStorage.setItem('userInfo', JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }));

      // Get Firebase ID token
      const idToken = await user.getIdToken();
      await AsyncStorage.setItem('firebaseIdToken', idToken);

      return user;
    } catch (error) {
      console.error('Firebase sign in error:', error);
      throw error;
    }
  },

  /**
   * Create a new user with email and password
   */
  createUserWithEmailAndPassword: async (email, password) => {
    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Store user info
      await AsyncStorage.setItem('userInfo', JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }));

      // Get Firebase ID token
      const idToken = await user.getIdToken();
      await AsyncStorage.setItem('firebaseIdToken', idToken);

      return user;
    } catch (error) {
      console.error('Firebase create user error:', error);
      throw error;
    }
  },

  /**
   * Sign in with Google using Firebase Auth
   */
  signInWithGoogle: async () => {
    try {
      // Check if device supports Google Play
      await GoogleSignin.hasPlayServices();

      // Get the user's ID token
      const signInResult = await GoogleSignin.signIn();

      // Handle cancellation for newer versions of the library (v13+)
      if (signInResult.type === 'cancelled') {
        const cancellationError = new Error('Sign in was cancelled');
        cancellationError.code = statusCodes.SIGN_IN_CANCELLED;
        throw cancellationError;
      }

      const idToken = signInResult.data?.idToken;

      if (!idToken) {
        throw new Error('Failed to get ID token from Google Sign-In. Please check your configuration.');
      }

      // Create a Google credential with the token
      // For modular API, we use the property from the auth instance's provider if possible, 
      // but commonly people still use the static GoogleAuthProvider if available.
      // In rnfirebase v15+, it's often imported separately or accessed via auth.GoogleAuthProvider.
      // Let's use the static one which is usually available on the default export or the getAuth return in some versions.
      // Actually, rnfirebase still provides the classes on the module.

      const { GoogleAuthProvider } = require('@react-native-firebase/auth');
      const googleCredential = GoogleAuthProvider.credential(idToken);

      // Sign in the user with the credential
      const userCredential = await auth.signInWithCredential(googleCredential);
      const user = userCredential.user;

      // Get Google access token for Drive API
      const tokens = await GoogleSignin.getTokens();

      // Store user info
      await AsyncStorage.setItem('userInfo', JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }));

      // Store Firebase ID token
      const firebaseIdToken = await user.getIdToken();
      await AsyncStorage.setItem('firebaseIdToken', firebaseIdToken);

      // Store Google access token for Drive API
      if (tokens.accessToken) {
        await AsyncStorage.setItem('accessToken', tokens.accessToken);
      }

      const refreshToken = tokens.refreshToken;
      if (refreshToken && typeof refreshToken === 'string') {
        await AsyncStorage.setItem('refreshToken', refreshToken);
      }

      return {
        user,
        accessToken: tokens.accessToken,
      };
    } catch (error) {
      console.error('Firebase Google sign in error:', error);
      throw error;
    }
  },

  /**
   * Sign out the current user.
   * Safe when nobody is signed in (startup / session clear) — no error thrown.
   */
  signOut: async () => {
    try {
      // Avoid [auth/no-current-user] when clearing session on cold start.
      if (auth.currentUser) {
        await auth.signOut();
      }
      try {
        await GoogleSignin.signOut();
      } catch (_) {
        // Not signed in with Google — ignore
      }
      await AsyncStorage.multiRemove(['userInfo', 'accessToken', 'refreshToken', 'firebaseIdToken']);
    } catch (error) {
      const code = error?.code || '';
      const msg = String(error?.message || error || '');
      if (code === 'auth/no-current-user' || /no-current-user|No user currently signed in/i.test(msg)) {
        await AsyncStorage.multiRemove(['userInfo', 'accessToken', 'refreshToken', 'firebaseIdToken']).catch(() => {});
        return;
      }
      console.error('Firebase sign out error:', error);
      throw error;
    }
  },

  /**
   * Get the current authenticated user
   */
  getCurrentUser: () => {
    return auth.currentUser;
  },

  /**
   * Listen to authentication state changes
   */
  onAuthStateChanged: (callback) => {
    return auth.onAuthStateChanged(callback);
  },

  /**
   * Get a valid Google access token, refreshing if necessary
   * This should be used instead of reading directly from AsyncStorage
   */
  getValidAccessToken: async () => {
    try {
      // Check if user is signed in with Firebase (which means they should have Google auth)
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.log('No Firebase user found, cannot get Google access token');
        return null;
      }

      // Check if the user signed in with Google provider
      const providerData = currentUser.providerData || [];
      const hasGoogleProvider = providerData.some(provider => provider.providerId === 'google.com');

      if (!hasGoogleProvider) {
        console.log('User did not sign in with Google, cannot get Google access token');
        return null;
      }

      // First, try to get tokens directly (this works even if isSignedIn is false in some cases)
      try {
        const tokens = await GoogleSignin.getTokens();
        if (tokens && tokens.accessToken) {
          console.log('Successfully retrieved access token from GoogleSignin (length:', tokens.accessToken.length, ')');
          // Update stored token
          await AsyncStorage.setItem('accessToken', tokens.accessToken);
          return tokens.accessToken;
        }
      } catch (tokenError) {
        console.log('Could not get tokens from GoogleSignin:', tokenError.message);
        console.log('Error code:', tokenError.code);

        // Check if user is signed in with Google
        try {
          const isSignedIn = await GoogleSignin.isSignedIn();
          console.log('GoogleSignin.isSignedIn():', isSignedIn);

          if (!isSignedIn) {
            console.log('User is not signed in with GoogleSignin. Attempting to restore previous sign-in...');

            // Try to restore previous sign-in silently
            try {
              const signInResult = await GoogleSignin.signInSilently();
              console.log('Silent sign-in result:', signInResult.type === 'success' ? 'success' : 'failed/cancelled');

              if (signInResult.type === 'success') {
                const restoredTokens = await GoogleSignin.getTokens();
                if (restoredTokens && restoredTokens.accessToken) {
                  console.log('Successfully restored sign-in and retrieved access token');
                  await AsyncStorage.setItem('accessToken', restoredTokens.accessToken);
                  return restoredTokens.accessToken;
                }
              }
            } catch (silentError) {
              console.log('Could not restore sign-in silently:', silentError.message);
              console.log('Silent sign-in error code:', silentError.code);
            }
          } else {
            // User is signed in but getTokens() failed, try again
            console.log('User is signed in, retrying getTokens()...');
            try {
              const retryTokens = await GoogleSignin.getTokens();
              if (retryTokens && retryTokens.accessToken) {
                console.log('Successfully retrieved access token on retry');
                await AsyncStorage.setItem('accessToken', retryTokens.accessToken);
                return retryTokens.accessToken;
              }
            } catch (retryError) {
              console.log('Retry also failed:', retryError.message);
            }
          }
        } catch (checkError) {
          console.log('Error checking sign-in status:', checkError.message);
        }
      }

      // Fallback: try to get from AsyncStorage (might be expired but worth trying)
      const storedToken = await AsyncStorage.getItem('accessToken');
      if (storedToken) {
        console.log('Using stored access token from AsyncStorage (may be expired, length:', storedToken.length, ')');
        return storedToken;
      }

      console.log('No access token available');
      return null;
    } catch (error) {
      console.error('Error getting valid access token:', error);
      console.error('Error stack:', error.stack);
      // Last resort: try to get from AsyncStorage
      try {
        const storedToken = await AsyncStorage.getItem('accessToken');
        return storedToken;
      } catch (storageError) {
        console.error('Error reading from AsyncStorage:', storageError);
        return null;
      }
    }
  },
};

export default firebaseAuthService;

