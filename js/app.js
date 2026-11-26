/**
 * VaultDrop Application Controller
 */

import {
  validateMediaFile,
  encryptToAhnu,
  decryptFromAhnu,
  inspectAhnuHeader,
} from './crypto-ahnu.js';
import { buildZipArchive } from './zip-utils.js';
import { initCursorRects } from './cursor-rects.js';
import {
  storageService,
  clampTtlMinutes,
  MAX_SHARE_AHNU_BYTES,
} from './storage-service.js';
import {
  formatBytes,
  formatCountdown,
  evaluatePasswordStrength,
  showToast,
  triggerBlobDownload,
  renderDecryptedMedia,
  getShareUrl,
  getShareIdFromLocation,
  categoryBadge,
} from './ui-components.js';

const state = {
  encryptFiles: [],
  encryptFile: null,
  encryptValidation: null,
  encryptPreviewUrl: null,
  preparedResult: null, // { isZip, ahnuBytes?, ahnuFilename?, metadata?, zipBytes?, zipFilename?, count? }
  ttlMinutes: 60,
  lastSharedAhnu: null, // { bytes, filename }

  decryptFile: null,
  decryptBytes: null,
  decryptHeader: null,
  decryptedOutput: null, // { metadata, fileBytes }
  cleanupDecryptViewer: null,

  sharedPayload: null,
  sharedDecrypted: null,
  cleanupSharedViewer: null,
  sharedTimerId: null,
  linksTimerId: null,

  authMode: 'signin',
};

/* -------------------------------------------------------------------------- */
/*  DOM Helpers                                                               */
/* -------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

function bindDropzone(dropzoneEl, inputEl, onFilesSelected) {
  dropzoneEl.addEventListener('click', () => inputEl.click());
  dropzoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputEl.click();
    }
  });
  dropzoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzoneEl.classList.add('dragover');
  });
  dropzoneEl.addEventListener('dragleave', () => {
    dropzoneEl.classList.remove('dragover');
  });
  dropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files?.length) {
      onFilesSelected(inputEl.multiple ? Array.from(files) : files[0]);
    }
  });
  inputEl.addEventListener('change', () => {
    const files = inputEl.files;
    if (files?.length) {
      onFilesSelected(inputEl.multiple ? Array.from(files) : files[0]);
    }
    inputEl.value = '';
  });
}

function setProgress(prefix, visible, stage = '', pct = 0) {
  const wrap = $(`${prefix}-progress-wrap`);
  if (!wrap) return;
  wrap.classList.toggle('hidden', !visible);
  if (visible) {
    $(`${prefix}-progress-stage`).textContent = stage;
    $(`${prefix}-progress-pct`).textContent = `${pct}%`;
    $(`${prefix}-progress-fill`).style.width = `${pct}%`;
  }
}

/* -------------------------------------------------------------------------- */
/*  Navigation & Modals                                                       */
/* -------------------------------------------------------------------------- */

function switchView(viewName) {
  const isShared = viewName === 'shared';
  $('hero-section')?.classList.toggle('hidden', isShared);
  $('mode-switcher-wrap')?.classList.toggle('hidden', isShared);

  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${viewName}`);
  });

  if (viewName === 'links') {
    refreshMyLinks();
  }
}

function openModal(id) {
  $(id)?.classList.remove('hidden');
}

function closeModal(id) {
  $(id)?.classList.add('hidden');
}

/* -------------------------------------------------------------------------- */
/*  View 1: Encrypt & Send                                                    */
/* -------------------------------------------------------------------------- */

function handleSelectEncryptFile(fileOrFiles) {
  const incoming = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const validFiles = [];
  let firstValidation = null;

  for (const f of incoming) {
    const v = validateMediaFile(f);
    if (!v.valid) {
      showToast(`${f.name}: ${v.error}`, 'error');
      continue;
    }
    if (!firstValidation) firstValidation = v;
    validFiles.push(f);
  }

  if (!validFiles.length) return;

  if (state.encryptPreviewUrl) {
    URL.revokeObjectURL(state.encryptPreviewUrl);
    state.encryptPreviewUrl = null;
  }

  state.encryptFiles = validFiles;
  state.encryptFile = validFiles[0];
  state.encryptValidation = firstValidation;
  state.preparedResult = null;
  state.lastSharedAhnu = null;
  $('share-result-card').classList.add('hidden');

  const previewEl = $('encrypt-mini-preview');
  const multiListEl = $('encrypt-multi-list');
  previewEl.innerHTML = '';
  previewEl.classList.add('hidden');
  multiListEl.innerHTML = '';
  multiListEl.classList.add('hidden');

  if (validFiles.length === 1) {
    const file = validFiles[0];
    const badge = categoryBadge(firstValidation.category);
    $('encrypt-file-icon').textContent = badge.icon;
    $('encrypt-file-name').textContent = file.name;
    $('encrypt-file-sub').textContent = `${badge.label} (${firstValidation.ext}) · ${formatBytes(file.size)}`;

    const url = URL.createObjectURL(file);
    state.encryptPreviewUrl = url;

    if (firstValidation.category === 'photo' && firstValidation.ext !== '.heic') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name;
      previewEl.appendChild(img);
      previewEl.classList.remove('hidden');
    } else if (firstValidation.category === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.muted = true;
      previewEl.appendChild(video);
      previewEl.classList.remove('hidden');
    } else if (firstValidation.category === 'audio') {
      const audio = document.createElement('audio');
      audio.src = url;
      audio.controls = true;
      previewEl.appendChild(audio);
      previewEl.classList.remove('hidden');
    }
  } else {
    const totalBytes = validFiles.reduce((sum, f) => sum + f.size, 0);
    $('encrypt-file-icon').textContent = '🗜️';
    $('encrypt-file-name').textContent = `${validFiles.length} files selected`;
    $('encrypt-file-sub').textContent = `${formatBytes(totalBytes)} · Will encrypt each to .ahnu & bundle as .zip`;
    for (const f of validFiles) {
      const chip = document.createElement('span');
      chip.className = 'multi-file-chip';
      chip.textContent = f.name;
      multiListEl.appendChild(chip);
    }
    multiListEl.classList.remove('hidden');
  }

  $('encrypt-file-card').classList.remove('hidden');
  $('encrypt-dropzone').classList.add('hidden');
  updateEncryptActionButtons();
}

function clearEncryptFile() {
  if (state.encryptPreviewUrl) {
    URL.revokeObjectURL(state.encryptPreviewUrl);
    state.encryptPreviewUrl = null;
  }
  state.encryptFiles = [];
  state.encryptFile = null;
  state.encryptValidation = null;
  state.preparedResult = null;
  $('encrypt-file-card').classList.add('hidden');
  $('encrypt-dropzone').classList.remove('hidden');
  $('encrypt-mini-preview').innerHTML = '';
  $('encrypt-multi-list').innerHTML = '';
  updateEncryptActionButtons();
}

function updateEncryptActionButtons() {
  const pw = $('encrypt-password').value;
  const confirmPw = $('encrypt-password-confirm').value;
  const strength = evaluatePasswordStrength(pw);

  const fill = $('encrypt-strength-fill');
  fill.style.width = `${(strength.score / 5) * 100}%`;
  fill.style.backgroundColor = strength.color;
  $('encrypt-strength-label').textContent = strength.label;
  $('encrypt-strength-label').style.color = strength.color;

  const matchHint = $('password-match-hint');
  if (matchHint) {
    if (!confirmPw) {
      matchHint.textContent = '';
      matchHint.className = 'match-hint';
    } else if (pw === confirmPw) {
      matchHint.textContent = 'Passwords match ✓';
      matchHint.className = 'match-hint ok';
    } else {
      matchHint.textContent = 'Does not match';
      matchHint.className = 'match-hint err';
    }
  }

  const ready = state.encryptFiles.length > 0 && pw.length >= 4 && pw === confirmPw;
  $('btn-encrypt-now').disabled = !ready;
}

function setTtlMinutes(minutes) {
  const clamped = clampTtlMinutes(minutes);
  state.ttlMinutes = clamped;
  const hours = Number((clamped / 60).toFixed(2));
  $('custom-ttl-hours').value = hours;
  const slider = $('ttl-range-slider');
  if (slider) slider.value = String(clamped);

  if (clamped < 60) {
    $('ttl-summary').textContent = `Expires in ${clamped} min`;
  } else if (clamped === 1440) {
    $('ttl-summary').textContent = 'Expires in 24 hours (Max limit)';
  } else {
    $('ttl-summary').textContent = `Expires in ${hours} hr${hours === 1 ? '' : 's'}`;
  }

  document.querySelectorAll('.ttl-pill').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.minutes) === clamped);
  });
}

function validateEncryptInputs() {
  if (!state.encryptFiles.length) {
    showToast('Please select a photo, video, or audio file first.', 'error');
    return null;
  }
  const pw = $('encrypt-password').value;
  const confirmPw = $('encrypt-password-confirm').value;
  if (pw.length < 4) {
    showToast('Password must be at least 4 characters.', 'error');
    return null;
  }
  if (pw !== confirmPw) {
    showToast('Passwords do not match.', 'error');
    return null;
  }
  return pw;
}

async function handleEncryptNow() {
  const pw = validateEncryptInputs();
  if (!pw) return;

  const btn = $('btn-encrypt-now');
  btn.disabled = true;

  try {
    if (state.encryptFiles.length === 1) {
      const file = state.encryptFiles[0];
      setProgress('encrypt', true, 'Encrypting into .ahnu format...', 10);
      const { ahnuBytes, ahnuFilename, metadata } = await encryptToAhnu(
        file,
        pw,
        (stage, pct) => setProgress('encrypt', true, stage, pct)
      );
      state.preparedResult = {
        isZip: false,
        ahnuBytes,
        ahnuFilename,
        metadata,
      };
      $('encrypt-result-modal-title').textContent = 'Encrypted & Ready';
      $('encrypt-result-modal-sub').textContent =
        'Your file is encrypted with AES-256-GCM. Download it or share via a 24h link:';
      $('popup-download-title').innerHTML =
        '1. Download Encrypted <code>.ahnu</code> File';
      $('popup-download-meta').textContent = formatBytes(ahnuBytes.length);
      $('btn-download-ahnu-label').textContent = `Download ${ahnuFilename}`;
      $('popup-share-section').classList.remove('hidden');
      $('share-result-card').classList.add('hidden');
      $('btn-create-share-link').disabled = false;
    } else {
      const entries = [];
      const total = state.encryptFiles.length;
      for (let i = 0; i < total; i++) {
        const file = state.encryptFiles[i];
        setProgress(
          'encrypt',
          true,
          `Encrypting ${i + 1} of ${total}: ${file.name}`,
          Math.round((i / total) * 85) + 5
        );
        const { ahnuBytes, ahnuFilename } = await encryptToAhnu(file, pw);
        entries.push({ name: ahnuFilename, bytes: ahnuBytes });
      }
      setProgress('encrypt', true, 'Creating .zip archive...', 94);
      const zipBytes = buildZipArchive(entries);
      const zipFilename = 'vaultdrop-encrypted.zip';
      state.preparedResult = {
        isZip: true,
        zipBytes,
        zipFilename,
        count: total,
      };
      $('encrypt-result-modal-title').textContent = `${total} Files Encrypted`;
      $('encrypt-result-modal-sub').textContent =
        'All files were converted to .ahnu and bundled into a single .zip archive:';
      $('popup-download-title').innerHTML =
        '1. Download Encrypted <code>.zip</code> Archive';
      $('popup-download-meta').textContent = `${total} .ahnu files · ${formatBytes(zipBytes.length)}`;
      $('btn-download-ahnu-label').textContent = `Download ${zipFilename}`;
      $('popup-share-section').classList.add('hidden');
    }

    setProgress('encrypt', true, 'Complete!', 100);
    openModal('modal-encrypt-result');
  } catch (err) {
    showToast(err.message || 'Encryption failed.', 'error');
  } finally {
    setTimeout(() => setProgress('encrypt', false), 600);
    updateEncryptActionButtons();
  }
}

function handleDownloadAhnu() {
  const res = state.preparedResult;
  if (!res) return;
  if (res.isZip) {
    triggerBlobDownload(res.zipBytes, 'application/zip', res.zipFilename);
    showToast(`Downloaded ${res.zipFilename}`, 'success');
  } else {
    triggerBlobDownload(res.ahnuBytes, 'application/octet-stream', res.ahnuFilename);
    showToast(`Downloaded ${res.ahnuFilename}`, 'success');
  }
}

async function handleCreateShareLink() {
  const resData = state.preparedResult;
  if (!resData || resData.isZip) return;

  if (
    storageService.mode === 'firebase' &&
    !storageService.currentUser
  ) {
    showToast('Sign in (or continue as Guest) to create a Firebase share link.', 'info');
    openModal('modal-auth');
    return;
  }

  if (resData.ahnuBytes.length > MAX_SHARE_AHNU_BYTES) {
    showToast(
      `File is too large for link sharing (max ~12 MB). Use "Download .ahnu File" instead.`,
      'error'
    );
    return;
  }

  const btn = $('btn-create-share-link');
  btn.disabled = true;
  const labelSpan = btn.querySelector('span');
  const prevLabel = labelSpan ? labelSpan.textContent : '';
  if (labelSpan) labelSpan.textContent = 'Uploading encrypted link...';
  $('share-result-card').classList.add('hidden');

  try {
    const res = await storageService.createShareLink({
      ahnuBytes: resData.ahnuBytes,
      category: resData.metadata.category,
      ttlMinutes: state.ttlMinutes,
      onProgress: (stage, pct) => {
        if (labelSpan) labelSpan.textContent = `${stage} (${pct}%)`;
      },
    });

    state.lastSharedAhnu = {
      bytes: resData.ahnuBytes,
      filename: resData.ahnuFilename,
    };

    const shareUrl = getShareUrl(res.shareId);
    $('share-result-url').value = shareUrl;
    $('btn-test-share-url').href = shareUrl;
    $('share-result-expiry').textContent = new Date(
      res.expiresAtMs
    ).toLocaleString();
    $('share-result-card').classList.remove('hidden');

    showToast('Encrypted share link created!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to create share link.', 'error');
  } finally {
    if (labelSpan) labelSpan.textContent = prevLabel || 'Generate Share Link';
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/*  View 2: Decrypt .ahnu                                                     */
/* -------------------------------------------------------------------------- */

async function handleSelectDecryptFile(file) {
  if (!file.name.toLowerCase().endsWith('.ahnu')) {
    showToast('Please select a valid .ahnu encrypted file.', 'error');
    return;
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = inspectAhnuHeader(bytes);
    state.decryptFile = file;
    state.decryptBytes = bytes;
    state.decryptHeader = header;

    $('decrypt-file-name').textContent = file.name;
    $('decrypt-file-sub').textContent = `AHNU v${header.version} · AES-256-GCM · ${header.iterations.toLocaleString()} PBKDF2 rounds · ${formatBytes(file.size)}`;
    $('decrypt-file-card').classList.remove('hidden');
    $('decrypt-dropzone').classList.add('hidden');
    updateDecryptButton();
  } catch (err) {
    showToast(err.message || 'Invalid .ahnu file.', 'error');
  }
}

function clearDecryptFile() {
  state.decryptFile = null;
  state.decryptBytes = null;
  state.decryptHeader = null;
  state.decryptedOutput = null;
  if (state.cleanupDecryptViewer) {
    state.cleanupDecryptViewer();
    state.cleanupDecryptViewer = null;
  }
  $('decrypt-file-card').classList.add('hidden');
  $('decrypt-dropzone').classList.remove('hidden');
  $('decrypt-result-panel').classList.add('hidden');
  $('decrypt-empty-state').classList.remove('hidden');
  $('decrypt-output-badge').textContent = 'Locked';
  updateDecryptButton();
}

function updateDecryptButton() {
  const ready =
    Boolean(state.decryptBytes) && $('decrypt-password').value.length > 0;
  $('btn-decrypt-file').disabled = !ready;
}

async function handleDecryptAhnu() {
  if (!state.decryptBytes) return;
  const pw = $('decrypt-password').value;
  if (!pw) {
    showToast('Enter the decryption password.', 'error');
    return;
  }

  $('btn-decrypt-file').disabled = true;
  try {
    setProgress('decrypt', true, 'Starting decryption...', 10);
    const result = await decryptFromAhnu(
      state.decryptBytes,
      pw,
      (stage, pct) => setProgress('decrypt', true, stage, pct)
    );

    if (state.cleanupDecryptViewer) {
      state.cleanupDecryptViewer();
      state.cleanupDecryptViewer = null;
    }

    state.decryptedOutput = result;
    const badge = categoryBadge(result.metadata.category);
    $('decrypted-orig-name').textContent = result.metadata.name;
    $('decrypted-orig-info').textContent = `${badge.label} (${result.metadata.ext}) · ${formatBytes(result.fileBytes.byteLength)}`;
    $('decrypt-output-badge').textContent = 'Unlocked';

    $('decrypt-empty-state').classList.add('hidden');
    $('decrypt-result-panel').classList.remove('hidden');

    state.cleanupDecryptViewer = await renderDecryptedMedia(
      $('decrypt-media-stage'),
      result
    );

    showToast('File decrypted successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Decryption failed.', 'error');
  } finally {
    setTimeout(() => setProgress('decrypt', false), 1000);
    updateDecryptButton();
  }
}

/* -------------------------------------------------------------------------- */
/*  View 3: My Vault Links                                                    */
/* -------------------------------------------------------------------------- */

async function refreshMyLinks() {
  const container = $('links-list-container');
  const authPrompt = $('links-auth-prompt');

  if (state.linksTimerId) {
    clearInterval(state.linksTimerId);
    state.linksTimerId = null;
  }

  if (storageService.mode === 'firebase' && !storageService.currentUser) {
    authPrompt.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }

  authPrompt.classList.add('hidden');
  container.innerHTML = '<div class="empty-box"><p>Loading your links...</p></div>';

  try {
    const items = await storageService.listMyShares();
    if (!items.length) {
      container.innerHTML = `
        <div class="empty-box">
          <p>No active shared links yet.</p>
          <p class="muted-text">Encrypt a photo, video, or audio file and click "Generate Share Link".</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    for (const item of items) {
      const badge = categoryBadge(item.category);
      const url = getShareUrl(item.shareId);
      const row = document.createElement('div');
      row.className = 'link-item';
      row.innerHTML = `
        <div class="link-item-left">
          <div class="file-badge-icon">${badge.icon}</div>
          <div>
            <div><strong>${badge.label} Vault</strong> · <code>${item.shareId}</code></div>
            <div class="link-item-meta">
              ${formatBytes(item.ahnuSize)} ·
              <span class="link-countdown" data-exp="${item.expiresAtMs}">
                ${item.expired ? 'Expired' : formatCountdown(item.expiresAtMs)}
              </span>
            </div>
          </div>
        </div>
        <div class="link-item-actions">
          <button type="button" class="btn btn-outline btn-xs btn-copy-item">Copy Link</button>
          <a href="${url}" class="btn btn-ghost btn-xs">Open</a>
          <button type="button" class="btn btn-danger btn-xs btn-revoke-item">Revoke</button>
        </div>
      `;

      row.querySelector('.btn-copy-item').addEventListener('click', async () => {
        await navigator.clipboard.writeText(url);
        showToast('Share link copied to clipboard.', 'success');
      });

      row.querySelector('.btn-revoke-item').addEventListener('click', async () => {
        try {
          await storageService.deleteShare(item.shareId);
          showToast('Vault link revoked and deleted.', 'success');
          refreshMyLinks();
        } catch (err) {
          showToast(err.message || 'Could not delete link.', 'error');
        }
      });

      container.appendChild(row);
    }

    state.linksTimerId = setInterval(() => {
      document.querySelectorAll('.link-countdown').forEach((el) => {
        const exp = Number(el.dataset.exp);
        el.textContent = formatCountdown(exp);
      });
    }, 1000);
  } catch (err) {
    container.innerHTML = `<div class="error-box"><p>${err.message}</p></div>`;
  }
}

/* -------------------------------------------------------------------------- */
/*  View 4: Shared Link Landing (?share=ID)                                   */
/* -------------------------------------------------------------------------- */

async function loadSharedLink(shareId) {
  switchView('shared');
  $('shared-loading-box').classList.remove('hidden');
  $('shared-error-box').classList.add('hidden');
  $('shared-unlock-box').classList.add('hidden');
  $('shared-decrypted-box').classList.add('hidden');
  $('shared-password').value = '';

  if (state.sharedTimerId) {
    clearInterval(state.sharedTimerId);
    state.sharedTimerId = null;
  }
  if (state.cleanupSharedViewer) {
    state.cleanupSharedViewer();
    state.cleanupSharedViewer = null;
  }

  try {
    const payload = await storageService.fetchShare(shareId, (msg) => {
      $('shared-loading-text').textContent = msg;
    });

    inspectAhnuHeader(payload.ahnuBytes);
    state.sharedPayload = payload;

    const badge = categoryBadge(payload.category);
    $('shared-category-icon').textContent = badge.icon;
    $('shared-sender-info').textContent = `Shared by ${payload.ownerLabel} · ${formatBytes(payload.ahnuSize)}`;
    $('shared-file-label').textContent = `Encrypted ${badge.label} (.ahnu)`;
    $('shared-file-sub').textContent = `AES-256-GCM · ${formatBytes(payload.ahnuSize)} · Valid until ${new Date(payload.expiresAtMs).toLocaleTimeString()}`;

    const updateTimer = () => {
      const text = formatCountdown(payload.expiresAtMs);
      $('shared-countdown-pill').textContent =
        text === 'Expired' ? 'Expired' : `Expires in ${text}`;
      if (text === 'Expired') {
        clearInterval(state.sharedTimerId);
        state.sharedTimerId = null;
        $('shared-unlock-box').classList.add('hidden');
        $('shared-decrypted-box').classList.add('hidden');
        $('shared-error-title').textContent = 'Link Expired';
        $('shared-error-msg').textContent =
          'This vault link exceeded its expiration window and is no longer accessible.';
        $('shared-error-box').classList.remove('hidden');
      }
    };
    updateTimer();
    state.sharedTimerId = setInterval(updateTimer, 1000);

    $('shared-loading-box').classList.add('hidden');
    $('shared-unlock-box').classList.remove('hidden');
  } catch (err) {
    $('shared-loading-box').classList.add('hidden');
    $('shared-countdown-pill').textContent = 'Unavailable';
    $('shared-error-title').textContent = 'Vault Link Unavailable';
    $('shared-error-msg').textContent = err.message;
    $('shared-error-box').classList.remove('hidden');
  }
}

async function handleUnlockShared() {
  if (!state.sharedPayload) return;
  const pw = $('shared-password').value;
  if (!pw) {
    showToast('Please enter the password to unlock.', 'error');
    return;
  }

  const btn = $('btn-unlock-shared');
  btn.disabled = true;
  btn.textContent = 'Decrypting...';

  try {
    const result = await decryptFromAhnu(state.sharedPayload.ahnuBytes, pw);
    state.sharedDecrypted = result;

    if (state.cleanupSharedViewer) {
      state.cleanupSharedViewer();
      state.cleanupSharedViewer = null;
    }

    const badge = categoryBadge(result.metadata.category);
    $('shared-orig-name').textContent = result.metadata.name;
    $('shared-orig-info').textContent = `${badge.label} (${result.metadata.ext}) · ${formatBytes(result.fileBytes.byteLength)}`;

    $('shared-unlock-box').classList.add('hidden');
    $('shared-decrypted-box').classList.remove('hidden');

    state.cleanupSharedViewer = await renderDecryptedMedia(
      $('shared-media-stage'),
      result
    );
    showToast('Vault unlocked!', 'success');
  } catch (err) {
    showToast(err.message || 'Wrong password.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔓 Unlock & View Media';
  }
}

/* -------------------------------------------------------------------------- */
/*  Auth & Firebase Setup UI                                                  */
/* -------------------------------------------------------------------------- */

function syncAuthAndModeUI(user, mode) {
  const dot = $('storage-mode-dot');
  const label = $('storage-mode-label');
  const banner = $('mode-banner');
  const authBtn = $('btn-auth');

  if (mode === 'firebase') {
    dot.classList.add('online');
    label.textContent = 'Firebase';
    banner.classList.add('hidden');

    if (user) {
      authBtn.textContent = user.displayName || 'Account';
      $('auth-signed-in-view').classList.remove('hidden');
      $('auth-signed-out-view').classList.add('hidden');
      $('auth-user-name').textContent = user.displayName || 'VaultDrop User';
      $('auth-user-email').textContent =
        user.email || (user.isAnonymous ? 'Anonymous Guest Session' : user.uid);
    } else {
      authBtn.textContent = 'Sign In';
      $('auth-signed-in-view').classList.add('hidden');
      $('auth-signed-out-view').classList.remove('hidden');
    }
  } else {
    dot.classList.remove('online');
    label.textContent = 'Sandbox';
    banner.classList.remove('hidden');
    authBtn.textContent = 'Account';
    $('auth-signed-in-view').classList.add('hidden');
    $('auth-signed-out-view').classList.remove('hidden');
  }
}

function setAuthTabMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.authMode === mode);
  });
  $('auth-name-group').classList.toggle('hidden', mode !== 'signup');
  $('btn-auth-submit').textContent =
    mode === 'signup' ? 'Create Account' : 'Sign In with Email';
}

/* -------------------------------------------------------------------------- */
/*  Bootstrap                                                                 */
/* -------------------------------------------------------------------------- */

async function init() {
  // Navigation tabs
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.location.search.includes('share=')) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('share');
        window.history.replaceState({}, '', cleanUrl.toString());
      }
      switchView(btn.dataset.view);
    });
  });

  // Brand home link resets shared query param cleanly
  $('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = '';
    cleanUrl.hash = '';
    window.history.replaceState({}, '', cleanUrl.toString());
    switchView('encrypt');
  });

  // Return home buttons from shared view
  ['btn-shared-go-home', 'btn-shared-back-home'].forEach((id) => {
    $(id).addEventListener('click', () => {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = '';
      cleanUrl.hash = '';
      window.history.replaceState({}, '', cleanUrl.toString());
      switchView('encrypt');
    });
  });

  // Password visibility toggles
  document.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.togglePw);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('revealed', show);
    });
  });

  // Modal open/close
  $('btn-open-spec').addEventListener('click', () => openModal('modal-spec'));
  $('btn-open-firebase-setup').addEventListener('click', () =>
    openModal('modal-firebase')
  );
  $('btn-banner-setup').addEventListener('click', () =>
    openModal('modal-firebase')
  );
  $('btn-auth').addEventListener('click', () => {
    if (storageService.mode !== 'firebase') {
      showToast(
        'Connect your Firebase project first to enable Firebase Auth.',
        'info'
      );
      openModal('modal-firebase');
      return;
    }
    openModal('modal-auth');
  });
  $('btn-links-signin').addEventListener('click', () => openModal('modal-auth'));

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  // Encrypt dropzone & inputs
  bindDropzone(
    $('encrypt-dropzone'),
    $('encrypt-file-input'),
    handleSelectEncryptFile
  );
  $('btn-clear-encrypt-file').addEventListener('click', clearEncryptFile);
  $('encrypt-password').addEventListener('input', updateEncryptActionButtons);
  $('encrypt-password-confirm').addEventListener(
    'input',
    updateEncryptActionButtons
  );

  // TTL presets, slider & custom input (strictly capped at 24 hours)
  document.querySelectorAll('.ttl-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      setTtlMinutes(Number(pill.dataset.minutes));
    });
  });
  $('ttl-range-slider')?.addEventListener('input', (e) => {
    setTtlMinutes(Number(e.target.value));
  });
  $('custom-ttl-hours').addEventListener('input', (e) => {
    const hrs = Number(e.target.value);
    if (!Number.isFinite(hrs) || hrs <= 0) return;
    if (hrs > 24) {
      showToast('Maximum link expiration time is 24 hours (1 day).', 'info');
    }
    setTtlMinutes(Math.min(24, hrs) * 60);
  });

  $('btn-encrypt-now').addEventListener('click', handleEncryptNow);
  $('btn-download-ahnu').addEventListener('click', handleDownloadAhnu);
  $('btn-create-share-link').addEventListener('click', handleCreateShareLink);

  $('btn-copy-share-url').addEventListener('click', async () => {
    const url = $('share-result-url').value;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    const btn = $('btn-copy-share-url');
    const prev = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => {
      btn.textContent = prev;
    }, 1600);
    showToast('Share link copied!', 'success');
  });

  $('btn-native-share')?.addEventListener('click', async () => {
    const url = $('share-result-url').value;
    if (!url) return;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'VaultDrop Encrypted Media',
          text: 'Open this encrypted VaultDrop link (ask me for the password separately):',
          url,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(url);
    showToast('Share link copied to clipboard!', 'success');
  });

  $('btn-download-shared-ahnu').addEventListener('click', () => {
    if (!state.lastSharedAhnu) return;
    triggerBlobDownload(
      state.lastSharedAhnu.bytes,
      'application/octet-stream',
      state.lastSharedAhnu.filename
    );
  });

  // Decrypt dropzone & inputs
  bindDropzone(
    $('decrypt-dropzone'),
    $('decrypt-file-input'),
    handleSelectDecryptFile
  );
  $('btn-clear-decrypt-file').addEventListener('click', clearDecryptFile);
  $('decrypt-password').addEventListener('input', updateDecryptButton);
  $('decrypt-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('btn-decrypt-file').disabled) {
      handleDecryptAhnu();
    }
  });
  $('btn-decrypt-file').addEventListener('click', handleDecryptAhnu);
  $('btn-download-decrypted').addEventListener('click', () => {
    if (!state.decryptedOutput) return;
    triggerBlobDownload(
      state.decryptedOutput.fileBytes,
      state.decryptedOutput.metadata.mime,
      state.decryptedOutput.metadata.name
    );
  });

  // My Links
  $('btn-refresh-links').addEventListener('click', refreshMyLinks);

  // Shared View actions
  $('btn-unlock-shared').addEventListener('click', handleUnlockShared);
  $('shared-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUnlockShared();
  });
  $('btn-download-raw-ahnu').addEventListener('click', () => {
    if (!state.sharedPayload) return;
    triggerBlobDownload(
      state.sharedPayload.ahnuBytes,
      'application/octet-stream',
      `vault-${state.sharedPayload.shareId}.ahnu`
    );
  });
  $('btn-download-shared-original').addEventListener('click', () => {
    if (!state.sharedDecrypted) return;
    triggerBlobDownload(
      state.sharedDecrypted.fileBytes,
      state.sharedDecrypted.metadata.mime,
      state.sharedDecrypted.metadata.name
    );
  });

  // Auth modal controls
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => setAuthTabMode(tab.dataset.authMode));
  });

  $('auth-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const displayName = $('auth-display-name').value.trim();
    try {
      if (state.authMode === 'signup') {
        await storageService.signUpWithEmail(email, password, displayName);
        showToast('Account created and signed in!', 'success');
      } else {
        await storageService.signInWithEmail(email, password);
        showToast('Signed in!', 'success');
      }
      closeModal('modal-auth');
    } catch (err) {
      showToast(err.message || 'Authentication failed.', 'error');
    }
  });

  $('btn-google-signin').addEventListener('click', async () => {
    try {
      await storageService.signInWithGoogle();
      closeModal('modal-auth');
      showToast('Signed in with Google!', 'success');
    } catch (err) {
      showToast(err.message || 'Google Sign-In failed.', 'error');
    }
  });

  $('btn-guest-signin').addEventListener('click', async () => {
    try {
      await storageService.signInAsGuest();
      closeModal('modal-auth');
      showToast('Signed in as Guest!', 'success');
    } catch (err) {
      showToast(err.message || 'Anonymous Sign-In failed (enable it in Firebase Console).', 'error');
    }
  });

  $('btn-sign-out').addEventListener('click', async () => {
    await storageService.signOut();
    closeModal('modal-auth');
    showToast('Signed out.', 'info');
  });

  // Firebase config modal
  $('firebase-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const raw = $('firebase-config-json').value.trim();
      const parsed = JSON.parse(raw);
      await storageService.configureFirebase(parsed);
      closeModal('modal-firebase');
      showToast('Firebase connected!', 'success');
    } catch (err) {
      showToast(err.message || 'Invalid Firebase JSON config.', 'error');
    }
  });

  $('btn-reset-firebase').addEventListener('click', async () => {
    await storageService.resetFirebaseConfig();
    closeModal('modal-firebase');
    showToast('Switched back to Local Sandbox Mode.', 'info');
  });

  // Subscribe to Auth + Storage Mode changes
  storageService.onAuthChange((user, mode) => {
    syncAuthAndModeUI(user, mode);
    if ($('view-links').classList.contains('active')) {
      refreshMyLinks();
    }
  });

  await storageService.init();
  initCursorRects();
  setTtlMinutes(60);

  // Check if opened via a ?share=ID link
  const shareId = getShareIdFromLocation();
  if (shareId) {
    loadSharedLink(shareId);
  }
}

init();
