// Canvas overlay: draws the skeleton and the progress ring that fills as the
// body approaches the camera.

import { CONNECTIONS, isVisible } from './landmarks.js';

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export class Overlay {
  constructor(canvas, ringHost) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ringHost = ringHost;
    this.ring = null;
    this.ringProgress = null;
    this.showSkeleton = true;
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  }

  /** Match the canvas size to its CSS box. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw one frame.
   * @param {object} frame   engine result
   * @param {object} signal  computed signals
   */
  draw(frame, signal) {
    this.resize();
    this.clear();
    if (!frame?.landmarks) {
      this.hideRing();
      return;
    }
    const map = this.mapper(frame);
    if (this.showSkeleton) this.drawSkeleton(frame.landmarks, map);
    if (signal?.anchor) {
      this.showRing(signal.anchor, map, signal.fill ?? 0);
    } else {
      this.hideRing();
    }
  }

  /** Maps normalised landmark coordinates to canvas pixels honouring object-fit: cover. */
  mapper(frame) {
    const video = frame.video ?? null;
    const vw = video?.videoWidth || frame.landmarks[0]?.x * 1000 || 640;
    const vh = video?.videoHeight || frame.landmarks[0]?.y * 1000 || 480;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = vw * scale;
    const sh = vh * scale;
    const ox = (cw - sw) / 2;
    const oy = (ch - sh) / 2;
    return (lm) => ({
      x: lm.x * sw + ox,
      y: lm.y * sh + oy,
    });
  }

  drawSkeleton(lms, map) {
    const ctx = this.ctx;
    ctx.lineWidth = 2.2 * this.dpr;
    ctx.strokeStyle = 'rgba(61, 220, 132, .85)';
    ctx.lineCap = 'round';

    for (const [a, b] of CONNECTIONS) {
      const la = lms[a];
      const lb = lms[b];
      if (!isVisible(la) || !isVisible(lb)) continue;
      const pa = map(la);
      const pb = map(lb);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    for (const lm of lms) {
      if (!isVisible(lm)) continue;
      const p = map(lm);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.arc(p.x, p.y, 2.6 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  showRing(anchor, map, fill) {
    if (!this.ring) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'ring');
      svg.setAttribute('viewBox', `0 0 ${RING_RADIUS * 2 + 16} ${RING_RADIUS * 2 + 16}`);
      svg.setAttribute('width', String(RING_RADIUS * 2 + 16));
      svg.setAttribute('height', String(RING_RADIUS * 2 + 16));

      const core = document.createElementNS(ns, 'circle');
      core.setAttribute('class', 'ring__core');
      core.setAttribute('cx', String(RING_RADIUS + 8));
      core.setAttribute('cy', String(RING_RADIUS + 8));
      core.setAttribute('r', String(RING_RADIUS - 6));

      const track = document.createElementNS(ns, 'circle');
      track.setAttribute('class', 'ring__track');
      track.setAttribute('cx', String(RING_RADIUS + 8));
      track.setAttribute('cy', String(RING_RADIUS + 8));
      track.setAttribute('r', String(RING_RADIUS));

      const progress = document.createElementNS(ns, 'circle');
      progress.setAttribute('class', 'ring__progress');
      progress.setAttribute('cx', String(RING_RADIUS + 8));
      progress.setAttribute('cy', String(RING_RADIUS + 8));
      progress.setAttribute('r', String(RING_RADIUS));
      progress.setAttribute('stroke-dasharray', `0 ${RING_CIRCUMFERENCE}`);

      svg.append(core, track, progress);
      this.ringHost.appendChild(svg);
      this.ring = svg;
      this.ringProgress = progress;
    }

    const p = map(anchor);
    this.ring.style.left = `${p.x / this.dpr}px`;
    this.ring.style.top = `${p.y / this.dpr}px`;
    this.ring.style.opacity = '1';

    const clamped = Math.max(0, Math.min(1, fill));
    this.ringProgress.setAttribute('stroke-dasharray', `${clamped * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`);
    this.ringProgress.style.stroke = clamped >= 0.72 ? 'var(--ring)' : clamped >= 0.4 ? 'var(--ring-mid)' : 'var(--ring-low)';
  }

  hideRing() {
    if (this.ring) this.ring.style.opacity = '0';
  }

  destroy() {
    this.ring?.remove();
    this.ring = null;
    this.ringProgress = null;
  }
}
