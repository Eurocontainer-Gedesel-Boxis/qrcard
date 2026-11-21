/* ==========================================================================
   Órbita libre 360° para el visor 3D.
   A diferencia de OrbitControls, el ángulo vertical no tiene límites: se
   puede pasar por encima y por debajo de la unidad sin saltos. El vector
   «arriba» de la cámara se calcula a partir de la propia posición esférica
   (es la tangente hacia el polo), de modo que no existe el volteo brusco
   que aparece en los polos con un «arriba» fijo.

   Posición:  p = target + r · (sinφ·sinθ, cosφ, sinφ·cosθ)
   Arriba:    u = (−cosφ·sinθ, sinφ, −cosφ·cosθ)
   ========================================================================== */
import { EventDispatcher, Vector3 } from 'three';

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class FreeOrbit extends EventDispatcher {
  constructor(camera, dom) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.target = new Vector3();
    this.theta = 0;
    this.phi = Math.PI / 2;
    this.radius = 20;

    this.minDistance = 4.5;
    this.maxDistance = 46;
    this.enableDamping = true;
    this.dampingFactor = 0.075;
    this.rotateSpeed = 0.75;
    this.zoomSpeed = 0.9;
    this.panSpeed = 0.7;
    this.autoRotate = false;
    this.autoRotateSpeed = TAU / 55; // rad/s (una vuelta cada ~55 s)

    this._dTheta = 0;
    this._dPhi = 0;
    this._rTarget = this.radius;
    this._pan = new Vector3();
    this._ptrs = new Map();
    this._mode = null; // 'rotate' | 'pan' | 'pinch'
    this._last = { x: 0, y: 0, d: 0 };
    this._right = new Vector3();
    this._up = new Vector3();
    this._moved = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onMenu = (e) => e.preventDefault();
    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointermove', this._onMove);
    dom.addEventListener('pointerup', this._onUp);
    dom.addEventListener('pointercancel', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('contextmenu', this._onMenu);
  }

  /* ---------------- Estado ---------------- */
  setState({ theta, phi, radius, target }) {
    if (target) this.target.copy(target);
    if (theta !== undefined) this.theta = theta;
    if (phi !== undefined) this.phi = phi;
    if (radius !== undefined) { this.radius = clamp(radius, this.minDistance, this.maxDistance); this._rTarget = this.radius; }
    this._dTheta = this._dPhi = 0;
    this._pan.set(0, 0, 0);
    this._apply();
  }
  getState() {
    return { tx: this.target.x, ty: this.target.y, tz: this.target.z, theta: this.theta, phi: this.phi, dist: this.radius };
  }
  setRadius(r) {
    this.radius = this._rTarget = clamp(r, this.minDistance, this.maxDistance);
  }
  get targetRadius() { return this._rTarget; }
  /** +1 con la unidad «de pie» en pantalla, −1 cuando se ha pasado por encima del polo */
  get upSign() {
    const s = Math.sin(this.phi);
    return s < 0 ? -1 : 1;
  }

  _apply() {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi), st = Math.sin(this.theta), ct = Math.cos(this.theta);
    const c = this.camera;
    c.position.set(this.target.x + this.radius * sp * st, this.target.y + this.radius * cp, this.target.z + this.radius * sp * ct);
    c.up.set(-cp * st, sp, -cp * ct);
    c.lookAt(this.target);
  }

  /* ---------------- Bucle ---------------- */
  update(dt = 1 / 60) {
    let changed = false;
    const f = this.enableDamping ? 1 - Math.pow(1 - this.dampingFactor, dt * 60) : 1;

    if (this.autoRotate && !this._mode) {
      this.theta -= this.autoRotateSpeed * dt * this.upSign;
      changed = true;
    }
    if (Math.abs(this._dTheta) > 1e-6 || Math.abs(this._dPhi) > 1e-6) {
      this.theta += this._dTheta * f;
      this.phi += this._dPhi * f;
      this._dTheta *= 1 - f;
      this._dPhi *= 1 - f;
      if (Math.abs(this._dTheta) < 1e-6) this._dTheta = 0;
      if (Math.abs(this._dPhi) < 1e-6) this._dPhi = 0;
      changed = true;
    }
    const dr = this._rTarget - this.radius;
    if (Math.abs(dr) > 1e-4) {
      this.radius += dr * (1 - Math.exp(-dt * 14));
      changed = true;
    }
    if (this._pan.lengthSq() > 1e-10) {
      this.target.addScaledVector(this._pan, f);
      this._pan.multiplyScalar(1 - f);
      changed = true;
    }
    this.theta = wrap(this.theta);
    this.phi = wrap(this.phi);
    if (changed) {
      this._apply();
      this.dispatchEvent({ type: 'change' });
    }
    return changed;
  }

  /* ---------------- Entradas ---------------- */
  _rotate(dx, dy) {
    const k = (TAU * this.rotateSpeed) / Math.max(1, this.dom.clientHeight);
    this._dTheta += -dx * k * this.upSign;
    this._dPhi += -dy * k;
    if (!this.enableDamping) this.update(1 / 60);
  }
  _panBy(dx, dy) {
    this._right.setFromMatrixColumn(this.camera.matrix, 0);
    this._up.setFromMatrixColumn(this.camera.matrix, 1);
    const fov = (this.camera.fov * Math.PI) / 180;
    const k = ((2 * this.radius * Math.tan(fov / 2)) / Math.max(1, this.dom.clientHeight)) * this.panSpeed;
    this._pan.addScaledVector(this._right, -dx * k).addScaledVector(this._up, dy * k);
  }
  _pair() {
    const [a, b] = [...this._ptrs.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  _onDown(e) {
    if (e.pointerType === 'mouse' && ![0, 1, 2].includes(e.button)) return;
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { this.dom.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
    if (this._ptrs.size === 1) {
      const wantsPan = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey);
      this._mode = wantsPan ? 'pan' : 'rotate';
      this._last.x = e.clientX; this._last.y = e.clientY;
      this.dispatchEvent({ type: 'start' });
    } else if (this._ptrs.size === 2) {
      this._mode = 'pinch';
      const p = this._pair();
      this._last = { x: p.x, y: p.y, d: p.d };
    }
  }
  _onMove(e) {
    const ptr = this._ptrs.get(e.pointerId);
    if (!ptr) return;
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (this._mode === 'rotate') {
      this._rotate(e.clientX - this._last.x, e.clientY - this._last.y);
      this._last.x = e.clientX; this._last.y = e.clientY;
    } else if (this._mode === 'pan') {
      this._panBy(e.clientX - this._last.x, e.clientY - this._last.y);
      this._last.x = e.clientX; this._last.y = e.clientY;
    } else if (this._mode === 'pinch' && this._ptrs.size >= 2) {
      const p = this._pair();
      if (this._last.d > 4 && p.d > 4) {
        this._rTarget = clamp(this._rTarget * (this._last.d / p.d), this.minDistance, this.maxDistance);
        this.dispatchEvent({ type: 'zoom' });
      }
      this._rotate(p.x - this._last.x, p.y - this._last.y);
      this._last = { x: p.x, y: p.y, d: p.d };
    }
  }
  _onUp(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    this._ptrs.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) { /* ya liberado */ }
    if (this._ptrs.size === 0) {
      this._mode = null;
      this.dispatchEvent({ type: 'end' });
    } else if (this._ptrs.size === 1) {
      const [p] = [...this._ptrs.values()];
      this._mode = 'rotate';
      this._last = { x: p.x, y: p.y, d: 0 };
    }
  }
  _onWheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const s = Math.pow(0.95, this.zoomSpeed * Math.abs(e.deltaY * unit * 0.01));
    this._rTarget = clamp(e.deltaY < 0 ? this._rTarget * s : this._rTarget / s, this.minDistance, this.maxDistance);
    this.dispatchEvent({ type: 'zoom' });
    this.dispatchEvent({ type: 'start' });
    this.dispatchEvent({ type: 'end' });
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onDown);
    d.removeEventListener('pointermove', this._onMove);
    d.removeEventListener('pointerup', this._onUp);
    d.removeEventListener('pointercancel', this._onUp);
    d.removeEventListener('wheel', this._onWheel);
    d.removeEventListener('contextmenu', this._onMenu);
  }
}
