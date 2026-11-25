/**
 * Firebase Configuration for VaultDrop
 * =====================================
 * To enable public cross-device share links and Firebase Authentication on GitHub Pages:
 * 1. Create a free Firebase project at https://console.firebase.google.com/
 * 2. Enable Authentication (Email/Password, Google, and/or Anonymous)
 * 3. Create a Cloud Firestore database and deploy firestore.rules
 * 4. Replace the placeholder values below with your Web App's firebaseConfig
 *    (or configure it directly inside the app via "Firebase Setup" in the header).
 */

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

const STORAGE_KEY = 'vaultdrop_firebase_config_v1';

export function isFirebaseConfigured(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  return required.every(
    (k) =>
      typeof cfg[k] === 'string' &&
      cfg[k].trim().length > 0 &&
      !cfg[k].includes('YOUR_')
  );
}

export function getActiveFirebaseConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isFirebaseConfigured(parsed)) {
        return { config: parsed, source: 'localStorage' };
      }
    }
  } catch {
    // Ignore storage read errors
  }

  if (isFirebaseConfigured(DEFAULT_FIREBASE_CONFIG)) {
    return { config: DEFAULT_FIREBASE_CONFIG, source: 'file' };
  }

  return { config: null, source: 'none' };
}

export function saveRuntimeFirebaseConfig(cfg) {
  if (!isFirebaseConfigured(cfg)) {
    throw new Error(
      'Please provide valid apiKey, authDomain, projectId, and appId fields.'
    );
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearRuntimeFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
