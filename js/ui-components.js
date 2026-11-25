/**
 * VaultDrop UI Helpers, Formatters & Media Renderer
 */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val < 10 && exp > 0 ? val.toFixed(2) : val.toFixed(1)} ${units[exp]}`;
}

export function formatCountdown(expiresAtMs) {
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return 'Expired';
  const totalSec = Math.floor(diff / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function evaluatePasswordStrength(pw = '') {
  if (!pw) return { score: 0, label: 'Enter a password', color: 'var(--muted)' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (pw.length < 4) {
    return { score: 1, label: 'Too short (min 4 chars)', color: 'var(--danger)' };
  }
  if (score <= 2) return { score: 2, label: 'Weak', color: 'var(--warning)' };
  if (score === 3) return { score: 3, label: 'Fair', color: '#eab308' };
  if (score === 4) return { score: 4, label: 'Strong', color: 'var(--accent)' };
  return { score: 5, label: 'Vault-grade', color: 'var(--accent-bright)' };
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 3800);
}

export function triggerBlobDownload(bytes, mimeType, filename) {
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Render decrypted media bytes cleanly inside a target container element.
 * Handles Photos (.jpg, .jpeg, .png, .heic), Videos (.mp4, .mov, .mkv), Audio (.mp3).
 * Returns a cleanup function that revokes any created object URLs.
 */
export async function renderDecryptedMedia(container, { metadata, fileBytes }) {
  container.innerHTML = '';
  const urlsToRevoke = [];

  const ext = (metadata.ext || '').toLowerCase();
  const mime = metadata.mime || 'application/octet-stream';
  const category = metadata.category || 'photo';

  const blob = new Blob([fileBytes], { type: mime });
  const objectUrl = URL.createObjectURL(blob);
  urlsToRevoke.push(objectUrl);

  if (category === 'photo') {
    if (ext === '.heic') {
      // Try browser native first, or lazy-load heic2any if online, else clean fallback
      const note = document.createElement('div');
      note.className = 'preview-loading';
      note.textContent = 'Preparing HEIC preview...';
      container.appendChild(note);

      let previewUrl = null;
      if (typeof window.heic2any === 'function') {
        try {
          const converted = await window.heic2any({
            blob,
            toType: 'image/jpeg',
            quality: 0.9,
          });
          const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
          previewUrl = URL.createObjectURL(jpegBlob);
          urlsToRevoke.push(previewUrl);
        } catch {
          previewUrl = null;
        }
      }

      container.innerHTML = '';
      if (previewUrl) {
        const img = document.createElement('img');
        img.src = previewUrl;
        img.alt = metadata.name;
        img.className = 'media-preview-img';
        container.appendChild(img);
      } else {
        const img = document.createElement('img');
        img.src = objectUrl;
        img.alt = metadata.name;
        img.className = 'media-preview-img';
        img.onerror = () => {
          container.innerHTML = `
            <div class="media-fallback-card">
              <div class="fallback-icon">🖼️</div>
              <p><strong>HEIC Image Decrypted Successfully</strong></p>
              <p class="muted-text">Your browser does not natively render .heic inline. Click "Download Original File" below to view it on your device.</p>
            </div>`;
        };
        container.appendChild(img);
      }
    } else {
      const img = document.createElement('img');
      img.src = objectUrl;
      img.alt = metadata.name;
      img.className = 'media-preview-img';
      container.appendChild(img);
    }
  } else if (category === 'video') {
    const video = document.createElement('video');
    video.src = objectUrl;
    video.controls = true;
    video.playsInline = true;
    video.className = 'media-preview-video';
    video.onerror = () => {
      container.innerHTML = `
        <div class="media-fallback-card">
          <div class="fallback-icon">🎬</div>
          <p><strong>Video Decrypted (${ext.toUpperCase()})</strong></p>
          <p class="muted-text">This browser cannot decode ${ext} inline. Use "Download Original File" below to play it locally.</p>
        </div>`;
    };
    container.appendChild(video);
  } else if (category === 'audio') {
    const wrap = document.createElement('div');
    wrap.className = 'audio-player-card';
    wrap.innerHTML = `
      <div class="audio-art">🎵</div>
      <div class="audio-title"></div>
      <div class="audio-sub muted-text">Decrypted MP3 Audio Stream</div>
    `;
    wrap.querySelector('.audio-title').textContent = metadata.name;

    const audio = document.createElement('audio');
    audio.src = objectUrl;
    audio.controls = true;
    audio.className = 'media-preview-audio';
    wrap.appendChild(audio);
    container.appendChild(wrap);
  }

  return () => {
    for (const u of urlsToRevoke) {
      URL.revokeObjectURL(u);
    }
  };
}

export function getShareUrl(shareId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', shareId);
  return url.toString();
}

export function getShareIdFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('share');
  if (fromQuery) return fromQuery.trim();

  const hash = window.location.hash || '';
  const match = hash.match(/^#\/?share[=/]([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export function categoryBadge(category) {
  switch (category) {
    case 'photo':
      return { icon: '🖼️', label: 'Photo' };
    case 'video':
      return { icon: '🎬', label: 'Video' };
    case 'audio':
      return { icon: '🎵', label: 'Audio' };
    default:
      return { icon: '🔐', label: 'Media' };
  }
}
