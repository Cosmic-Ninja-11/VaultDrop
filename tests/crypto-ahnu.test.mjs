import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import {
  validateMediaFile,
  encryptToAhnu,
  decryptFromAhnu,
  inspectAhnuHeader,
  uint8ToBase64,
  base64ToUint8,
} from '../js/crypto-ahnu.js';

test('validateMediaFile accepts all required photo, video, and audio extensions', () => {
  const validFiles = [
    { name: 'pic.jpg', category: 'photo' },
    { name: 'pic.JPEG', category: 'photo' },
    { name: 'pic.png', category: 'photo' },
    { name: 'iphone.heic', category: 'photo' },
    { name: 'clip.mp4', category: 'video' },
    { name: 'clip.mov', category: 'video' },
    { name: 'clip.mkv', category: 'video' },
    { name: 'song.mp3', category: 'audio' },
  ];

  for (const item of validFiles) {
    const res = validateMediaFile({ name: item.name, type: '' });
    assert.equal(res.valid, true, `Expected ${item.name} to be valid`);
    assert.equal(res.category, item.category);
  }

  const invalid = validateMediaFile({ name: 'malware.exe', type: '' });
  assert.equal(invalid.valid, false);
});

test('encryptToAhnu and decryptFromAhnu round-trip preserves exact bytes and metadata', async () => {
  const originalBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const { ahnuBytes, ahnuFilename, metadata } = await encryptToAhnu(
    { name: 'sunset.jpg', type: 'image/jpeg', bytes: originalBytes },
    'StrongVaultPass!23'
  );

  assert.equal(ahnuFilename, 'sunset.ahnu');
  assert.equal(metadata.category, 'photo');

  const header = inspectAhnuHeader(ahnuBytes);
  assert.equal(header.magic, 'AHNU');
  assert.equal(header.version, 1);

  const decrypted = await decryptFromAhnu(ahnuBytes, 'StrongVaultPass!23');
  assert.equal(decrypted.metadata.name, 'sunset.jpg');
  assert.equal(decrypted.metadata.ext, '.jpg');
  assert.deepEqual(decrypted.fileBytes, originalBytes);
});

test('decryptFromAhnu rejects wrong password and tampered .ahnu files', async () => {
  const originalBytes = new Uint8Array([10, 20, 30, 40, 50]);
  const { ahnuBytes } = await encryptToAhnu(
    { name: 'voice.mp3', type: 'audio/mpeg', bytes: originalBytes },
    'correct-password'
  );

  await assert.rejects(
    () => decryptFromAhnu(ahnuBytes, 'wrong-password'),
    /Decryption failed/
  );

  const tampered = new Uint8Array(ahnuBytes);
  tampered[tampered.length - 1] ^= 0xff;
  await assert.rejects(
    () => decryptFromAhnu(tampered, 'correct-password'),
    /Decryption failed/
  );
});

test('uint8ToBase64 and base64ToUint8 round-trip binary payloads cleanly', () => {
  const sample = new Uint8Array(1024);
  for (let i = 0; i < sample.length; i++) sample[i] = i & 0xff;
  const b64 = uint8ToBase64(sample);
  const decoded = base64ToUint8(b64);
  assert.deepEqual(decoded, sample);
});
