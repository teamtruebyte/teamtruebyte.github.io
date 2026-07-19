/* Camera + compass + GPS capture.
 *
 * The compass logic here is the FIXED version proven on two Android phones
 * (see tools/pwa-prototype/compass-test.html and the HANDOFF notes):
 *   - PREFER the absolute (true-north) sensor. Many Android phones also fire the
 *     plain `deviceorientation` event with a relative/drifting heading; letting
 *     both through makes them fight and the dial flickers badly. Once an
 *     absolute reading arrives the relative stream is ignored entirely.
 *   - Low-pass filter on sin/cos so the 359°->0° wrap doesn't average to ~180°.
 *   - ~1° deadband so sub-degree jitter doesn't twitch the display.
 *
 * The burnt-in watermark matches _drawWatermark() in the mobile app's
 * photo_service.dart line-for-line, so app and PWA photos look the same.
 */
import { isSouth, compassLabel } from './config.js';

/* ── compass ─────────────────────────────────────────────────────────────── */

const SMOOTH = 0.10;
const angDiff = (a, b) => ((a - b) % 360 + 540) % 360 - 180;

export class Compass {
  constructor(onChange) {
    this.onChange = onChange;
    this.heading = null;
    this.source = '—';
    this.gotAbsolute = false;
    this._sin = null; this._cos = null; this._shown = null;
    this._onAbs = (e) => { this.gotAbsolute = true; this._handle(e); };
    this._onRel = (e) => { if (!this.gotAbsolute) this._handle(e); };
  }

  /** Must be called from a user gesture on iOS (permission prompt). */
  async start() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch { /* non-iOS throws; ignore */ }
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._onAbs, true);
    }
    window.addEventListener('deviceorientation', this._onRel, true);
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._onAbs, true);
    window.removeEventListener('deviceorientation', this._onRel, true);
  }

  _smooth(h) {
    const r = h * Math.PI / 180, s = Math.sin(r), c = Math.cos(r);
    if (this._sin == null) { this._sin = s; this._cos = c; }
    else { this._sin += SMOOTH * (s - this._sin); this._cos += SMOOTH * (c - this._cos); }
    const o = Math.atan2(this._sin, this._cos) * 180 / Math.PI;
    return o < 0 ? o + 360 : o;
  }

  _handle(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading; this.source = 'iOS compass';
    } else if (e.alpha != null) {
      h = 360 - e.alpha;
      this.source = e.absolute ? 'absolute (true north)' : 'relative (may drift)';
    }
    if (h == null) return;
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + screenAngle) % 360; if (h < 0) h += 360;
    this.heading = this._smooth(h);
    // Deadband: only report a change once the heading actually moves ~1°.
    if (this._shown == null || Math.abs(angDiff(this.heading, this._shown)) >= 1) {
      this._shown = this.heading;
      this.onChange?.(this.heading, this.source);
    }
  }
}

/* ── GPS ─────────────────────────────────────────────────────────────────── */

export class Geo {
  constructor(onChange) { this.onChange = onChange; this.pos = null; this._id = null; }
  start() {
    if (!navigator.geolocation) return;
    this._id = navigator.geolocation.watchPosition(
      (p) => {
        this.pos = {
          lat: +p.coords.latitude.toFixed(6),
          lng: +p.coords.longitude.toFixed(6),
          acc: Math.round(p.coords.accuracy),
        };
        this.onChange?.(this.pos);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }
  stop() { if (this._id != null) navigator.geolocation.clearWatch(this._id); }
}

/** One-shot position read, for the "Use my GPS" button on the Solar step. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No GPS support'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: +p.coords.latitude.toFixed(6),
        lng: +p.coords.longitude.toFixed(6),
        acc: Math.round(p.coords.accuracy),
      }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

/* ── watermark ───────────────────────────────────────────────────────────── */

const two = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()}  ` +
         `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Draws the same 2–3 line band the mobile app burns into every photo. */
function drawWatermark(ctx, w, h, pos, bearing, when) {
  const lines = [
    pos ? `Lat ${pos.lat.toFixed(6)}  Lng ${pos.lng.toFixed(6)}` : 'GPS unavailable',
    stamp(when),
  ];
  if (bearing != null) {
    lines.push(`Facing ${Math.round(bearing)}° ${compassLabel(bearing)}` +
               (isSouth(bearing) ? '  (SOUTH)' : ''));
  }

  const fs = Math.max(14, Math.round(w * 0.030));
  const lineH = Math.round(fs * 1.35);
  const pad = Math.round(fs * 0.6);
  const band = lines.length * lineH + pad;
  const top = h - band;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, top, w, band);
  // Accent strip on the left edge of the band (matches the app).
  ctx.fillStyle = '#f4a828';
  ctx.fillRect(0, top, Math.max(3, Math.round(w * 0.008)), band);

  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, pad * 2, top + pad / 2 + i * lineH));

  if (bearing != null && isSouth(bearing)) {
    const bw = fs * 8.2, bh = fs * 1.7;
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(pad, pad, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    ctx.fillText('SOUTH FACING', pad + fs * 0.5, pad + fs * 0.35);
  }
}

/* ── full-screen capture ─────────────────────────────────────────────────── */

const MAX_DIM = 1600;   // keeps uploads ~200-400 KB; halves storage vs full-res
const QUALITY = 0.82;

/**
 * Opens the camera full-screen and resolves with a photo record, or null if the
 * surveyor backs out.
 *   { blob, lat, lng, bearingDeg, isSouthFacing, capturedAt, filename }
 */
export function capturePhoto({ title = 'Take photo', selfie = false, requireSouth = false } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'cam-overlay';
    el.innerHTML = `
      <div class="cam-top">
        <button class="cam-x" type="button" aria-label="Cancel">✕</button>
        <span class="cam-title"></span>
      </div>
      <div class="cam-stage">
        <video playsinline autoplay muted></video>
        <div class="dial" aria-hidden="true">
          <div class="pointer"></div>
          <div class="rose">
            <div class="tick n">N</div><div class="tick e">E</div>
            <div class="tick s">S</div><div class="tick w">W</div>
            <div class="needle"></div>
          </div>
        </div>
        <div class="cam-badge">Point south</div>
        <div class="cam-readout"><span class="hdg">–</span> · <span class="gps">GPS…</span></div>
      </div>
      <div class="cam-bottom">
        <p class="cam-hint"></p>
        <button class="cam-shot" type="button" aria-label="Capture"></button>
      </div>`;
    el.querySelector('.cam-title').textContent = title;
    if (requireSouth) {
      el.querySelector('.cam-hint').textContent =
        'Point the back of the phone SOUTH — the badge turns green.';
    }
    document.body.appendChild(el);

    const video = el.querySelector('video');
    const rose = el.querySelector('.rose');
    const badge = el.querySelector('.cam-badge');
    const hdgEl = el.querySelector('.hdg');
    const gpsEl = el.querySelector('.gps');

    let stream = null, southState = false;
    const geo = new Geo((p) => { gpsEl.textContent = `${p.lat}, ${p.lng} (±${p.acc}m)`; });
    const compass = new Compass((h) => {
      rose.style.transform = `rotate(${-h}deg)`;
      hdgEl.textContent = `${Math.round(h)}° ${compassLabel(h)}`;
      // Hysteresis so the badge doesn't flicker right at the 135/225 boundary.
      southState = southState ? (h >= 130 && h <= 230) : (h >= 135 && h <= 225);
      badge.textContent = southState ? 'SOUTH ✓' : 'Point south';
      badge.classList.toggle('ok', southState);
    });

    function cleanup() {
      compass.stop(); geo.stop();
      stream?.getTracks().forEach((t) => t.stop());
      el.remove();
    }
    function cancel() { cleanup(); resolve(null); }

    el.querySelector('.cam-x').addEventListener('click', cancel);

    el.querySelector('.cam-shot').addEventListener('click', () => {
      if (!video.videoWidth) return;
      const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      const when = new Date();
      const bearing = compass.heading;
      drawWatermark(ctx, w, h, geo.pos, bearing, when);

      canvas.toBlob((blob) => {
        cleanup();
        resolve({
          blob,
          lat: geo.pos?.lat ?? null,
          lng: geo.pos?.lng ?? null,
          bearingDeg: bearing == null ? null : Math.round(bearing * 10) / 10,
          isSouthFacing: isSouth(bearing),
          capturedAt: when.toISOString(),
          filename: `IMG_${when.getTime()}_${Math.floor(Math.random() * 1000)}.jpg`,
        });
      }, 'image/jpeg', QUALITY);
    });

    (async () => {
      await compass.start();
      geo.start();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: selfie ? 'user' : 'environment' },
                   width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        video.srcObject = stream;
      } catch (e) {
        cleanup();
        alert('Could not open the camera: ' + e.message);
        resolve(null);
      }
    })();
  });
}
