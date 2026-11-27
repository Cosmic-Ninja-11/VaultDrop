# VaultDrop (`.ahnu` Encrypted Media Transfer)

VaultDrop is an open-source, zero-knowledge web platform for securely encrypting and sharing **photos, videos, and audio files** directly in the browser using the custom `.ahnu` encrypted container format.

## Features

- **Supported Media Formats**
  - **Photos:** `.jpg`, `.jpeg`, `.png`, `.heic`
  - **Videos:** `.mp4`, `.mov`, `.mkv`
  - **Audio:** `.mp3`
- **Custom `.ahnu` Encrypted File Format**
  - Converts your media into a password-protected `.ahnu` file using **Web Crypto API** (`PBKDF2-HMAC-SHA256` with 310,000 iterations + `AES-256-GCM`).
  - Zero-knowledge design: original filename, MIME type, and file bytes are all encrypted and authenticated inside the `.ahnu` container.
  - Can be opened and decrypted in the VaultDrop Web App (and designed to be cross-compatible with future Android & iOS native apps).
- **Self-Expiring Share Links (Max 24 Hours)**
  - Generate shareable links (`?share=<id>`) with custom expiration times from **5 minutes up to a strict 24-hour (1 day) maximum**.
  - Enforced both in the UI and in your local `.env`-managed Firestore security rules.
- **Decrypt & Preview**
  - Upload any `.ahnu` file (or open a shared link), enter the password, preview the decrypted photo/video/audio in-browser, and download the original file.
- **100% Static Stack for GitHub Pages**
  - Built with vanilla **HTML, CSS, and JavaScript (ES Modules)** — no build step required.
  - Backed by **Firebase Auth** (Email/Password, Google Sign-In, Anonymous Guest) and **Cloud Firestore** (chunked `.ahnu` storage).
  - Includes a built-in **Local Sandbox Mode** (IndexedDB) so you can test `.ahnu` encryption, decryption, and expiring links immediately before connecting Firebase.

---

## `.ahnu` Binary Format Specification (v1)

The `.ahnu` specification is intentionally simple so future **Android (Kotlin)** and **iOS (Swift)** apps can encrypt and decrypt files identically:

| Offset | Length | Field | Description |
| --- | --- | --- | --- |
| `0x00` | 4 bytes | Magic | ASCII `AHNU` (`0x41 0x48 0x4E 0x55`) |
| `0x04` | 1 byte | Version | `0x01` |
| `0x05` | 1 byte | Cipher Suite | `0x01` (`PBKDF2-HMAC-SHA256` + `AES-256-GCM`) |
| `0x06` | 4 bytes | Iterations | Big-endian `uint32` (default `310000`) |
| `0x0A` | 16 bytes | Salt | Cryptographically random salt |
| `0x1A` | 12 bytes | IV / Nonce | Cryptographically random 96-bit GCM IV |
| `0x26` | Variable | Encrypted Payload | `AES-256-GCM` ciphertext + 16-byte authentication tag |

Inside the decrypted plaintext payload:
```
[4 bytes uint32 BE: metaLength][UTF-8 JSON metadata][raw original media bytes]
```

---

## Firebase Setup (via `.env` — Never Committed)

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a project.
2. **Enable Authentication**:
   - Open **Authentication → Sign-in method**.
   - Enable **Email/Password**, **Google**, and (recommended for frictionless public uploads) **Anonymous**.
3. **Configure Local Environment (`.env`)**:
   - Copy `.env.example` to `.env` (already listed in `.gitignore`).
   - Fill in `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, and `FIRESTORE_RULES`.
   - Run the sync script to generate the gitignored `js/firebase-env.js` and `firestore.rules` locally:
     ```bash
     python scripts/sync_env.py
     ```
   - Publish the generated `firestore.rules` in **Firebase Console → Firestore Database → Rules**.
   - *(Recommended)* Create a Firestore composite index if prompted when viewing **My Links** (`shares` collection: `ownerUid ASC`, `createdAt DESC`), and optionally configure a Firestore TTL policy on `expiresAt` to auto-purge expired documents.

---

## Deploying to GitHub Pages (Secrets Stay Out of Git)

1. In your GitHub repository, open **Settings → Secrets and variables → Actions** and add:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
2. Enable **GitHub Pages** under **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) generates `js/firebase-env.js` at deploy time from your secrets without storing credentials in the repository.
   - Shared links use `?share=<id>` query parameters, so they work cleanly on GitHub Pages with zero 404 routing errors.

---

## Local Development & Testing

Serve the directory over any static HTTP server (required for ES Modules and Web Crypto):

```bash
python -m http.server 8080
# or
npx serve .
```

Run the `.ahnu` cryptography unit tests (Node.js 20+):

```bash
node --test tests/crypto-ahnu.test.mjs
```
