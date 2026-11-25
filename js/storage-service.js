/**
 * VaultDrop Storage & Authentication Service
 * ==========================================
 * Dual-mode architecture:
 *  1. Firebase Mode (Firebase Auth + Cloud Firestore chunked encrypted storage)
 *     - Supports Email/Password, Google Sign-In, and Guest (Anonymous) Auth
 *     - Enforces maximum 24-hour link expiration
 *     - Stores only zero-knowledge .ahnu encrypted bytes (chunked <= 600 KB raw / ~800 KB b64)
 *  2. Local Browser Sandbox Mode (IndexedDB fallback when Firebase is not yet configured)
 *     - Lets you test link generation, 24h expiry, and .ahnu decryption locally right away
 */

import {
  getActiveFirebaseConfig,
  saveRuntimeFirebaseConfig,
  clearRuntimeFirebaseConfig,
} from './firebase-config.js';
import { uint8ToBase64, base64ToUint8 } from './crypto-ahnu.js';

export const MAX_TTL_MINUTES = 24 * 60; // 1440 minutes (24 hours / 1 day max)
export const MIN_TTL_MINUTES = 5;
export const FIRESTORE_CHUNK_BYTES = 580 * 1024; // ~773 KB base64 -> safely under Firestore 1 MiB doc limit
export const MAX_SHARE_AHNU_BYTES = 12 * 1024 * 1024; // 12 MiB cap for Firestore link sharing

const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/11.0.2';

const IDB_NAME = 'vaultdrop_local_shares_v1';
const IDB_STORE = 'shares';

function generateShareId(len = 12) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rand = new Uint8Array(len);
  crypto.getRandomValues(rand);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[rand[i] % alphabet.length];
  }
  return out;
}

export function clampTtlMinutes(minutes) {
  const num = Number(minutes);
  if (!Number.isFinite(num)) return 60;
  return Math.min(MAX_TTL_MINUTES, Math.max(MIN_TTL_MINUTES, Math.round(num)));
}

/* -------------------------------------------------------------------------- */
/*  Local IndexedDB Sandbox (when Firebase is not configured yet)             */
/* -------------------------------------------------------------------------- */

function openLocalDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'shareId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(shareId) {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(shareId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll() {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(shareId) {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(shareId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* -------------------------------------------------------------------------- */
/*  Unified Storage & Auth Controller                                         */
/* -------------------------------------------------------------------------- */

class VaultStorageService {
  constructor() {
    this.mode = 'local'; // 'firebase' | 'local'
    this.configSource = 'none';
    this.app = null;
    this.auth = null;
    this.db = null;
    this.fbAuth = null;
    this.fbStore = null;
    this.currentUser = null;
    this.authListeners = new Set();
    this._unsubAuth = null;
  }

  async init() {
    const { config, source } = getActiveFirebaseConfig();
    this.configSource = source;

    if (!config) {
      this.mode = 'local';
      this.currentUser = {
        uid: 'local-browser-user',
        email: null,
        displayName: 'Local Sandbox',
        isAnonymous: true,
        isLocalSandbox: true,
      };
      this._notifyAuth();
      return { mode: this.mode, source };
    }

    try {
      const [fbApp, fbAuth, fbStore] = await Promise.all([
        import(`${FIREBASE_SDK_BASE}/firebase-app.js`),
        import(`${FIREBASE_SDK_BASE}/firebase-auth.js`),
        import(`${FIREBASE_SDK_BASE}/firebase-firestore.js`),
      ]);

      this.fbAuth = fbAuth;
      this.fbStore = fbStore;

      const existing = fbApp.getApps();
      if (existing.length > 0) {
        await fbApp.deleteApp(existing[0]);
      }

      this.app = fbApp.initializeApp(config);
      this.auth = fbAuth.getAuth(this.app);
      this.db = fbStore.getFirestore(this.app);
      this.mode = 'firebase';

      if (this._unsubAuth) this._unsubAuth();
      this._unsubAuth = fbAuth.onAuthStateChanged(this.auth, (user) => {
        this.currentUser = user
          ? {
              uid: user.uid,
              email: user.email,
              displayName:
                user.displayName ||
                (user.isAnonymous ? 'Guest User' : user.email?.split('@')[0]) ||
                'VaultDrop User',
              isAnonymous: user.isAnonymous,
              isLocalSandbox: false,
            }
          : null;
        this._notifyAuth();
      });

      return { mode: this.mode, source };
    } catch (err) {
      console.error('Firebase initialization failed, falling back to local mode:', err);
      this.mode = 'local';
      this.currentUser = {
        uid: 'local-browser-user',
        email: null,
        displayName: 'Local Sandbox',
        isAnonymous: true,
        isLocalSandbox: true,
      };
      this._notifyAuth();
      return { mode: this.mode, source: 'error', error: err.message };
    }
  }

  onAuthChange(cb) {
    this.authListeners.add(cb);
    cb(this.currentUser, this.mode);
    return () => this.authListeners.delete(cb);
  }

  _notifyAuth() {
    for (const cb of this.authListeners) {
      cb(this.currentUser, this.mode);
    }
  }

  async configureFirebase(configObj) {
    saveRuntimeFirebaseConfig(configObj);
    return this.init();
  }

  async resetFirebaseConfig() {
    clearRuntimeFirebaseConfig();
    if (this._unsubAuth) {
      this._unsubAuth();
      this._unsubAuth = null;
    }
    return this.init();
  }

  /* ------------------------------ Auth Methods ------------------------------ */

  async signInWithEmail(email, password) {
    this._requireFirebase();
    return this.fbAuth.signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUpWithEmail(email, password, displayName) {
    this._requireFirebase();
    const cred = await this.fbAuth.createUserWithEmailAndPassword(
      this.auth,
      email,
      password
    );
    if (displayName && cred.user) {
      await this.fbAuth.updateProfile(cred.user, { displayName });
      this.currentUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName,
        isAnonymous: false,
        isLocalSandbox: false,
      };
      this._notifyAuth();
    }
    return cred;
  }

  async signInWithGoogle() {
    this._requireFirebase();
    const provider = new this.fbAuth.GoogleAuthProvider();
    return this.fbAuth.signInWithPopup(this.auth, provider);
  }

  async signInAsGuest() {
    this._requireFirebase();
    return this.fbAuth.signInAnonymously(this.auth);
  }

  async signOut() {
    if (this.mode === 'firebase' && this.auth) {
      await this.fbAuth.signOut(this.auth);
    }
  }

  _requireFirebase() {
    if (this.mode !== 'firebase' || !this.auth) {
      throw new Error(
        'Firebase is not configured yet. Open Firebase Setup to connect your project.'
      );
    }
  }

  /* ---------------------------- Share Link CRUD ----------------------------- */

  /**
   * Store an encrypted .ahnu payload with a strict <= 24 hour expiration.
   * @param {object} params
   * @param {Uint8Array} params.ahnuBytes
   * @param {string} params.category - 'photo' | 'video' | 'audio'
   * @param {number} params.ttlMinutes - 5..1440
   * @param {(stage:string, pct:number)=>void} [params.onProgress]
   */
  async createShareLink({ ahnuBytes, category, ttlMinutes, onProgress }) {
    if (!(ahnuBytes instanceof Uint8Array) || ahnuBytes.byteLength === 0) {
      throw new Error('Encrypted .ahnu payload is empty.');
    }

    if (ahnuBytes.byteLength > MAX_SHARE_AHNU_BYTES) {
      const mb = (MAX_SHARE_AHNU_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Encrypted file exceeds the ${mb} MB limit for link sharing. Use "Download .ahnu File" for large videos.`
      );
    }

    const safeTtl = clampTtlMinutes(ttlMinutes);
    const shareId = generateShareId(12);
    const createdMs = Date.now();
    const expiresMs = createdMs + safeTtl * 60 * 1000;

    if (this.mode === 'local') {
      onProgress?.('Saving encrypted .ahnu to local browser vault...', 60);
      await idbPut({
        shareId,
        ownerUid: 'local-browser-user',
        ownerLabel: 'Local Sandbox',
        category,
        ahnuSize: ahnuBytes.byteLength,
        ttlMinutes: safeTtl,
        createdAtMs: createdMs,
        expiresAtMs: expiresMs,
        ahnuBase64: uint8ToBase64(ahnuBytes),
      });
      onProgress?.('Share link ready!', 100);
      return {
        shareId,
        expiresAtMs: expiresMs,
        ttlMinutes: safeTtl,
        mode: 'local',
      };
    }

    // Firebase Mode
    if (!this.auth.currentUser) {
      throw new Error(
        'Please sign in (or continue as Guest) to create a shared vault link.'
      );
    }

    const {
      doc,
      collection,
      writeBatch,
      Timestamp,
    } = this.fbStore;

    const totalChunks = Math.ceil(ahnuBytes.byteLength / FIRESTORE_CHUNK_BYTES);
    const shareRef = doc(this.db, 'shares', shareId);

    onProgress?.(`Preparing ${totalChunks} encrypted chunk(s)...`, 15);

    const createdTs = Timestamp.fromMillis(createdMs);
    const expiresTs = Timestamp.fromMillis(expiresMs);

    // Firestore writeBatch limit is 500 ops; 12MB / 580KB = max 22 ops, so single batch works cleanly
    const batch = writeBatch(this.db);
    batch.set(shareRef, {
      shareId,
      ownerUid: this.auth.currentUser.uid,
      ownerLabel:
        this.currentUser?.displayName ||
        this.auth.currentUser.email ||
        'Anonymous Vault',
      category,
      ahnuSize: ahnuBytes.byteLength,
      chunkCount: totalChunks,
      ttlMinutes: safeTtl,
      createdAt: createdTs,
      expiresAt: expiresTs,
    });

    for (let i = 0; i < totalChunks; i++) {
      const start = i * FIRESTORE_CHUNK_BYTES;
      const end = Math.min(start + FIRESTORE_CHUNK_BYTES, ahnuBytes.byteLength);
      const slice = ahnuBytes.subarray(start, end);
      const chunkRef = doc(collection(shareRef, 'chunks'), String(i).padStart(4, '0'));
      batch.set(chunkRef, {
        index: i,
        data: uint8ToBase64(slice),
      });
      const pct = 20 + Math.round(((i + 1) / totalChunks) * 55);
      onProgress?.(`Packaging chunk ${i + 1} of ${totalChunks}...`, pct);
    }

    onProgress?.('Uploading encrypted .ahnu to Firestore...', 85);
    await batch.commit();
    onProgress?.('Share link active!', 100);

    return {
      shareId,
      expiresAtMs: expiresMs,
      ttlMinutes: safeTtl,
      mode: 'firebase',
    };
  }

  /**
   * Retrieve encrypted .ahnu metadata & bytes for a share link.
   * Rejects expired links (> expiresAtMs).
   */
  async fetchShare(shareId, onProgress) {
    if (!shareId || typeof shareId !== 'string') {
      throw new Error('Missing share link ID.');
    }

    if (this.mode === 'local') {
      onProgress?.('Loading encrypted link from local vault...', 40);
      const record = await idbGet(shareId);
      if (!record) {
        throw new Error(
          'Vault link not found. Note: Local Sandbox links only exist in the browser that created them — configure Firebase for cross-device links.'
        );
      }
      if (Date.now() >= record.expiresAtMs) {
        await idbDelete(shareId).catch(() => {});
        throw new Error(
          'This vault link has expired (max 24h validity reached) and was automatically purged.'
        );
      }
      onProgress?.('Encrypted .ahnu payload loaded.', 100);
      return {
        shareId: record.shareId,
        category: record.category,
        ahnuSize: record.ahnuSize,
        ownerLabel: record.ownerLabel,
        createdAtMs: record.createdAtMs,
        expiresAtMs: record.expiresAtMs,
        ahnuBytes: base64ToUint8(record.ahnuBase64),
        mode: 'local',
      };
    }

    const { doc, getDoc, collection, getDocs, query, orderBy } = this.fbStore;
    onProgress?.('Checking vault link status...', 20);
    const shareRef = doc(this.db, 'shares', shareId);
    const snap = await getDoc(shareRef);

    if (!snap.exists()) {
      throw new Error('Vault link not found or it has been revoked/expired.');
    }

    const meta = snap.data();
    const expiresAtMs = meta.expiresAt?.toMillis ? meta.expiresAt.toMillis() : 0;
    const createdAtMs = meta.createdAt?.toMillis ? meta.createdAt.toMillis() : 0;

    if (!expiresAtMs || Date.now() >= expiresAtMs) {
      throw new Error(
        'This vault link has expired (max 24h validity reached) and is no longer accessible.'
      );
    }

    onProgress?.(`Downloading ${meta.chunkCount} encrypted chunk(s)...`, 45);
    const chunksQuery = query(
      collection(shareRef, 'chunks'),
      orderBy('index', 'asc')
    );
    const chunkSnaps = await getDocs(chunksQuery);

    if (chunkSnaps.empty || chunkSnaps.size !== meta.chunkCount) {
      throw new Error('Encrypted payload is incomplete or unavailable.');
    }

    const parts = [];
    let totalLen = 0;
    chunkSnaps.forEach((docSnap) => {
      const chunkBytes = base64ToUint8(docSnap.data().data);
      parts.push(chunkBytes);
      totalLen += chunkBytes.byteLength;
    });

    const ahnuBytes = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      ahnuBytes.set(part, offset);
      offset += part.byteLength;
    }

    onProgress?.('Encrypted .ahnu container ready to unlock.', 100);
    return {
      shareId: meta.shareId,
      category: meta.category,
      ahnuSize: meta.ahnuSize,
      ownerLabel: meta.ownerLabel || 'VaultDrop Sender',
      createdAtMs,
      expiresAtMs,
      ahnuBytes,
      mode: 'firebase',
    };
  }

  /**
   * List share links created by the currently authenticated user (or local sandbox).
   */
  async listMyShares() {
    if (this.mode === 'local') {
      const all = await idbGetAll();
      return all
        .map((r) => ({
          shareId: r.shareId,
          category: r.category,
          ahnuSize: r.ahnuSize,
          ttlMinutes: r.ttlMinutes,
          createdAtMs: r.createdAtMs,
          expiresAtMs: r.expiresAtMs,
          expired: Date.now() >= r.expiresAtMs,
          mode: 'local',
        }))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
    }

    if (!this.auth?.currentUser) return [];

    const { collection, query, where, orderBy, getDocs } = this.fbStore;
    const q = query(
      collection(this.db, 'shares'),
      where('ownerUid', '==', this.auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    const snaps = await getDocs(q);
    const now = Date.now();
    const list = [];
    snaps.forEach((d) => {
      const data = d.data();
      const expiresAtMs = data.expiresAt?.toMillis
        ? data.expiresAt.toMillis()
        : 0;
      const createdAtMs = data.createdAt?.toMillis
        ? data.createdAt.toMillis()
        : 0;
      list.push({
        shareId: data.shareId || d.id,
        category: data.category,
        ahnuSize: data.ahnuSize,
        ttlMinutes: data.ttlMinutes,
        createdAtMs,
        expiresAtMs,
        expired: now >= expiresAtMs,
        mode: 'firebase',
      });
    });
    return list;
  }

  /**
   * Revoke / permanently delete a shared link and all its encrypted chunks.
   */
  async deleteShare(shareId) {
    if (this.mode === 'local') {
      await idbDelete(shareId);
      return;
    }

    if (!this.auth?.currentUser) {
      throw new Error('Sign in required to revoke a link.');
    }

    const { doc, collection, getDocs, writeBatch } = this.fbStore;
    const shareRef = doc(this.db, 'shares', shareId);
    const chunkSnaps = await getDocs(collection(shareRef, 'chunks'));

    const batch = writeBatch(this.db);
    chunkSnaps.forEach((c) => batch.delete(c.ref));
    batch.delete(shareRef);
    await batch.commit();
  }
}

export const storageService = new VaultStorageService();
