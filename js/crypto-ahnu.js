/**
 * VaultDrop .ahnu Binary Format & Web Crypto Engine
 * ==================================================
 * Specification v1 (compatible across Web, Android, and iOS):
 *
 * Byte Layout:
 *   [0..3]   Magic Bytes: "AHNU" (0x41, 0x48, 0x4E, 0x55)
 *   [4]      Format Version: 0x01 (uint8)
 *   [5]      Cipher Suite: 0x01 = PBKDF2-HMAC-SHA256 + AES-256-GCM (uint8)
 *   [6..9]   PBKDF2 Iterations (uint32 big-endian, default 310000)
 *   [10..25] Salt (16 random bytes)
 *   [26..37] IV / Nonce (12 random bytes)
 *   [38..]   AES-256-GCM Ciphertext + 16-byte Auth Tag
 *
 * Plaintext Payload inside AES-256-GCM:
 *   [0..3]         Metadata JSON byte length (uint32 big-endian)
 *   [4..4+metaLen] UTF-8 JSON metadata: { name, ext, mime, category, size, createdAt, format }
 *   [4+metaLen..]  Raw original media bytes
 *
 * Zero-Knowledge Guarantee:
 *   Original filename, extension, MIME type, and file contents are all encrypted
 *   inside AES-256-GCM. No plaintext file metadata leaks in the .ahnu header.
 */

export const AHNU_MAGIC = new Uint8Array([0x41, 0x48, 0x4e, 0x55]); // "AHNU"
export const AHNU_VERSION = 0x01;
export const AHNU_CIPHER_AES256_GCM_PBKDF2 = 0x01;
export const AHNU_DEFAULT_ITERATIONS = 310000;
export const AHNU_SALT_LENGTH = 16;
export const AHNU_IV_LENGTH = 12;
export const AHNU_HEADER_LENGTH = 38; // 4 + 1 + 1 + 4 + 16 + 12

export const SUPPORTED_MEDIA = {
  photo: {
    label: 'Photo',
    maxMb: 30,
    maxBytes: 30 * 1024 * 1024,
    extensions: ['.jpg', '.jpeg', '.png', '.heic'],
    mimes: ['image/jpeg', 'image/png', 'image/heic', 'image/heif'],
  },
  video: {
    label: 'Video',
    maxMb: 200,
    maxBytes: 200 * 1024 * 1024,
    extensions: ['.mp4', '.mov', '.mkv'],
    mimes: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/matroska'],
  },
  audio: {
    label: 'Audio',
    maxMb: 60,
    maxBytes: 60 * 1024 * 1024,
    extensions: ['.mp3'],
    mimes: ['audio/mpeg', 'audio/mp3'],
  },
};

export const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_MEDIA.photo.extensions,
  ...SUPPORTED_MEDIA.video.extensions,
  ...SUPPORTED_MEDIA.audio.extensions,
];

export const ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.heic,.mp4,.mov,.mkv,.mp3,image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime,video/x-matroska,audio/mpeg';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
};

function getCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'Web Crypto API is unavailable. Please run VaultDrop over HTTPS or localhost.'
    );
  }
  return c;
}

/**
 * Extract lowercase extension including leading dot.
 */
export function getFileExtension(filename = '') {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

/**
 * Validate whether a File/filename belongs to the supported media formats.
 * Returns { valid, category, ext, mime, error }
 */
export function validateMediaFile(file) {
  if (!file || !file.name) {
    return { valid: false, error: 'No file selected.' };
  }
  const ext = getFileExtension(file.name);
  for (const [category, spec] of Object.entries(SUPPORTED_MEDIA)) {
    if (spec.extensions.includes(ext)) {
      if (Number.isFinite(file.size) && file.size > spec.maxBytes) {
        return {
          valid: false,
          error: `${spec.label} file exceeds the ${spec.maxMb} MB limit.`,
        };
      }
      const mime = file.type || MIME_BY_EXT[ext] || 'application/octet-stream';
      return {
        valid: true,
        category,
        categoryLabel: spec.label,
        ext,
        mime,
      };
    }
  }
  return {
    valid: false,
    error: `Unsupported file format "${ext || 'unknown'}". Accepted formats: Photos (.jpg, .jpeg, .png, .heic), Videos (.mp4, .mov, .mkv), Audio (.mp3).`,
  };
}

/**
 * Derive an AES-256-GCM CryptoKey from a UTF-8 password and salt using PBKDF2-SHA256.
 */
async function deriveAesKey(password, salt, iterations, usages) {
  const cryptoApi = getCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/**
 * Inspect a .ahnu file buffer without decrypting it.
 * Verifies magic bytes, version, cipher suite, and minimum size.
 */
export function inspectAhnuHeader(bufferLike) {
  const bytes =
    bufferLike instanceof Uint8Array
      ? bufferLike
      : new Uint8Array(bufferLike);

  if (bytes.byteLength < AHNU_HEADER_LENGTH + 20) {
    throw new Error('Invalid .ahnu file: file is too small or corrupted.');
  }

  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== AHNU_MAGIC[i]) {
      throw new Error('Invalid file signature: this is not a valid .ahnu encrypted file.');
    }
  }

  const version = bytes[4];
  if (version !== AHNU_VERSION) {
    throw new Error(`Unsupported .ahnu format version (${version}).`);
  }

  const cipherSuite = bytes[5];
  if (cipherSuite !== AHNU_CIPHER_AES256_GCM_PBKDF2) {
    throw new Error(`Unsupported .ahnu cipher suite (${cipherSuite}).`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(6, false);
  if (iterations < 10000 || iterations > 5000000) {
    throw new Error('Invalid .ahnu key derivation parameter.');
  }

  const salt = bytes.slice(10, 26);
  const iv = bytes.slice(26, 38);
  const ciphertextLength = bytes.byteLength - AHNU_HEADER_LENGTH;

  return {
    magic: 'AHNU',
    version,
    cipherSuite,
    iterations,
    salt,
    iv,
    totalBytes: bytes.byteLength,
    ciphertextLength,
  };
}

/**
 * Encrypt a validated media File (or { name, type, bytes }) into a .ahnu Uint8Array.
 *
 * @param {File|{name:string,type?:string,bytes:Uint8Array}} input
 * @param {string} password
 * @param {(stage:string, pct:number)=>void} [onProgress]
 * @returns {Promise<{ ahnuBytes: Uint8Array, ahnuFilename: string, metadata: object }>}
 */
export async function encryptToAhnu(input, password, onProgress) {
  if (!password || password.length < 4) {
    throw new Error('Please set a password of at least 4 characters.');
  }

  const validation = validateMediaFile({ name: input.name, type: input.type });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  onProgress?.('Reading media file...', 15);
  let rawBytes;
  if (input.bytes instanceof Uint8Array) {
    rawBytes = input.bytes;
  } else if (typeof input.arrayBuffer === 'function') {
    rawBytes = new Uint8Array(await input.arrayBuffer());
  } else {
    throw new Error('Unable to read input file bytes.');
  }

  const metadata = {
    name: input.name,
    ext: validation.ext,
    mime: validation.mime,
    category: validation.category,
    size: rawBytes.byteLength,
    createdAt: new Date().toISOString(),
    format: 'ahnu-v1',
  };

  const enc = new TextEncoder();
  const metaBytes = enc.encode(JSON.stringify(metadata));

  // Pack [4-byte metaLength][metaBytes][rawBytes]
  const payload = new Uint8Array(4 + metaBytes.byteLength + rawBytes.byteLength);
  const payloadView = new DataView(payload.buffer);
  payloadView.setUint32(0, metaBytes.byteLength, false);
  payload.set(metaBytes, 4);
  payload.set(rawBytes, 4 + metaBytes.byteLength);

  onProgress?.('Deriving 256-bit encryption key (PBKDF2)...', 40);
  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(AHNU_SALT_LENGTH));
  const iv = cryptoApi.getRandomValues(new Uint8Array(AHNU_IV_LENGTH));
  const key = await deriveAesKey(
    password,
    salt,
    AHNU_DEFAULT_ITERATIONS,
    ['encrypt']
  );

  onProgress?.('Encrypting payload with AES-256-GCM...', 75);
  const cipherBuffer = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    payload
  );
  const cipherBytes = new Uint8Array(cipherBuffer);

  // Assemble .ahnu binary container
  const ahnuBytes = new Uint8Array(AHNU_HEADER_LENGTH + cipherBytes.byteLength);
  ahnuBytes.set(AHNU_MAGIC, 0);
  ahnuBytes[4] = AHNU_VERSION;
  ahnuBytes[5] = AHNU_CIPHER_AES256_GCM_PBKDF2;
  const headerView = new DataView(ahnuBytes.buffer);
  headerView.setUint32(6, AHNU_DEFAULT_ITERATIONS, false);
  ahnuBytes.set(salt, 10);
  ahnuBytes.set(iv, 26);
  ahnuBytes.set(cipherBytes, AHNU_HEADER_LENGTH);

  const baseName = input.name.replace(/\.[^.]+$/, '') || 'vaultdrop-media';
  const ahnuFilename = `${baseName}.ahnu`;

  onProgress?.('Encrypted .ahnu container ready.', 100);
  return { ahnuBytes, ahnuFilename, metadata };
}

/**
 * Decrypt a .ahnu binary buffer using the provided password.
 *
 * @param {ArrayBuffer|Uint8Array} bufferLike
 * @param {string} password
 * @param {(stage:string, pct:number)=>void} [onProgress]
 * @returns {Promise<{ metadata: object, fileBytes: Uint8Array, header: object }>}
 */
export async function decryptFromAhnu(bufferLike, password, onProgress) {
  if (!password) {
    throw new Error('Please enter the decryption password.');
  }

  const bytes =
    bufferLike instanceof Uint8Array
      ? bufferLike
      : new Uint8Array(bufferLike);

  onProgress?.('Verifying .ahnu container header...', 15);
  const header = inspectAhnuHeader(bytes);
  const ciphertext = bytes.slice(AHNU_HEADER_LENGTH);

  onProgress?.('Deriving decryption key (PBKDF2)...', 45);
  const key = await deriveAesKey(
    password,
    header.salt,
    header.iterations,
    ['decrypt']
  );

  onProgress?.('Decrypting and authenticating AES-256-GCM payload...', 75);
  const cryptoApi = getCrypto();
  let plainBuffer;
  try {
    plainBuffer = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: header.iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error(
      'Decryption failed: incorrect password or the .ahnu file was tampered with.'
    );
  }

  const plainBytes = new Uint8Array(plainBuffer);
  if (plainBytes.byteLength < 4) {
    throw new Error('Corrupted .ahnu payload.');
  }

  const view = new DataView(plainBytes.buffer, plainBytes.byteOffset, plainBytes.byteLength);
  const metaLen = view.getUint32(0, false);
  if (metaLen === 0 || 4 + metaLen > plainBytes.byteLength) {
    throw new Error('Corrupted .ahnu metadata header.');
  }

  const dec = new TextDecoder();
  const metadata = JSON.parse(dec.decode(plainBytes.slice(4, 4 + metaLen)));
  const fileBytes = plainBytes.slice(4 + metaLen);

  onProgress?.('Decryption complete.', 100);
  return { metadata, fileBytes, header };
}

/**
 * Compute base64 encoding for chunked Firestore storage.
 */
export function uint8ToBase64(bytes) {
  const CHUNK = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/**
 * Decode base64 back into Uint8Array.
 */
export function base64ToUint8(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
