/**
 * Firebase Configuration for VaultDrop
 * =====================================
 * Credentials are loaded at runtime in this priority order:
 *  1. Browser localStorage override (set via the in-app "Firebase Setup" modal)
 *  2. Gitignored `js/firebase-env.js` generated from `.env` (via `python scripts/sync_env.py`)
 *     or from GitHub Repository Secrets during GitHub Pages deployment
 *  3. Fallback template below (keep placeholders only when committing to git)
 */

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
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

async function loadEnvModuleConfig() {
  try {
    const mod = await import('./firebase-env.js');
    if (isFirebaseConfigured(mod?.FIREBASE_CONFIG)) {
      return mod.FIREBASE_CONFIG;
    }
  } catch {
    // js/firebase-env.js is gitignored and optional before running sync_env.py
  }
  return null;
}

export async function getActiveFirebaseConfig() {
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

  const envConfig = await loadEnvModuleConfig();
  if (envConfig) {
    return { config: envConfig, source: 'env' };
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
