/**
 * Interactive Floating & Cursor-Reactive Small Rectangles Canvas
 * Lightweight ambient background animation that reacts smoothly to mouse & touch movement.
 */

export function initCursorRects() {
  const canvas = document.getElementById('cursor-rects-canvas');
  if (!canvas) return;

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;

  const COLORS = [
    'rgba(16, 185, 129, 0.22)', // emerald
    'rgba(13, 148, 136, 0.18)', // teal
    'rgba(2, 132, 199, 0.15)',  // sky
    'rgba(100, 116, 139, 0.14)', // slate
  ];

  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, active: false };
  const ambientRects = [];
  const trailRects = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createAmbientRect() {
    const w = 8 + Math.random() * 14;
    const h = 6 + Math.random() * 10;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      w,
      h,
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.008,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      stroke: Math.random() > 0.45,
    };
  }

  function seedAmbient() {
    ambientRects.length = 0;
    const count = Math.min(44, Math.max(20, Math.floor((width * height) / 34000)));
    for (let i = 0; i < count; i++) {
      ambientRects.push(createAmbientRect());
    }
  }

  function spawnTrailRect(x, y, vx, vy) {
    if (trailRects.length > 36) trailRects.shift();
    const size = 6 + Math.random() * 10;
    trailRects.push({
      x: x + (Math.random() - 0.5) * 18,
      y: y + (Math.random() - 0.5) * 18,
      vx: vx * 0.15 + (Math.random() - 0.5) * 1.1,
      vy: vy * 0.15 + (Math.random() - 0.5) * 1.1,
      w: size,
      h: size * (0.65 + Math.random() * 0.5),
      angle: Math.random() * Math.PI,
      vAngle: (Math.random() - 0.5) * 0.06,
      life: 1,
      decay: 0.02 + Math.random() * 0.015,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }

  function drawRoundedRect(x, y, w, h, r, angle, fillStyle, isStroke, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const rad = Math.min(r, w / 2, h / 2);
    ctx.roundRect(-w / 2, -h / 2, w, h, rad);
    if (isStroke) {
      ctx.strokeStyle = fillStyle;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    } else {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    ctx.restore();
  }

  let lastSpawn = 0;
  function tick(now) {
    ctx.clearRect(0, 0, width, height);

    // Update & draw ambient floating rectangles that react to cursor
    for (const r of ambientRects) {
      if (pointer.active) {
        const dx = r.x - pointer.x;
        const dy = r.y - pointer.y;
        const distSq = dx * dx + dy * dy;
        const radius = 150;
        if (distSq < radius * radius && distSq > 1) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / radius) * 0.65;
          r.vx += (dx / dist) * force + pointer.vx * 0.015;
          r.vy += (dy / dist) * force + pointer.vy * 0.015;
          r.vAngle += force * 0.012;
        }
      }

      // Gentle damping back to calm drift
      r.vx *= 0.96;
      r.vy *= 0.96;
      r.vAngle *= 0.96;

      if (Math.abs(r.vx) < 0.12) r.vx += (Math.random() - 0.5) * 0.04;
      if (Math.abs(r.vy) < 0.12) r.vy += (Math.random() - 0.5) * 0.04;

      r.x += r.vx;
      r.y += r.vy;
      r.angle += r.vAngle;

      if (r.x < -30) r.x = width + 30;
      if (r.x > width + 30) r.x = -30;
      if (r.y < -30) r.y = height + 30;
      if (r.y > height + 30) r.y = -30;

      drawRoundedRect(r.x, r.y, r.w, r.h, 3, r.angle, r.color, r.stroke, 1);
    }

    // Update & draw cursor-trailing mini rectangles
    for (let i = trailRects.length - 1; i >= 0; i--) {
      const t = trailRects[i];
      t.x += t.vx;
      t.y += t.vy;
      t.vx *= 0.94;
      t.vy *= 0.94;
      t.angle += t.vAngle;
      t.life -= t.decay;
      if (t.life <= 0) {
        trailRects.splice(i, 1);
        continue;
      }
      drawRoundedRect(t.x, t.y, t.w, t.h, 2.5, t.angle, t.color, false, t.life);
    }

    if (pointer.active && now - lastSpawn > 28 && (Math.abs(pointer.vx) > 0.8 || Math.abs(pointer.vy) > 0.8)) {
      spawnTrailRect(pointer.x, pointer.y, pointer.vx, pointer.vy);
      lastSpawn = now;
    }

    pointer.vx *= 0.8;
    pointer.vy *= 0.8;

    requestAnimationFrame(tick);
  }

  function handlePointerMove(x, y) {
    if (pointer.active) {
      pointer.vx = x - pointer.x;
      pointer.vy = y - pointer.y;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  }

  window.addEventListener('mousemove', (e) => handlePointerMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (e.touches?.[0]) handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('mouseleave', () => {
    pointer.active = false;
  });
  window.addEventListener('resize', () => {
    resize();
    seedAmbient();
  });

  resize();
  seedAmbient();
  requestAnimationFrame(tick);
}
